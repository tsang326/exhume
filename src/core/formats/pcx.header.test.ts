import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import { numRuns } from '../../test-support/runs';
import { encodePcx } from '../../test-support/formats';
import { pcxSourceArb } from '../../test-support/formats/arbitraries';
import { fuzzedHeaderArb } from '../../test-support/formats/hostile';
import { pcxHeaderOracle } from '../../test-support/formats/oracles';
import { parsePcxHeader } from './pcx-header';
import { fill, TEMPLATES } from './templates';
import { ConversionWarningCode } from './types';
import { makeWarningCollector } from './warnings';

// Feature: format-resurrection, Property 26: PCX header acceptance matches the oracle
// **Validates: Requirements 9.1, 9.2, 9.4, 9.5, 9.6, 9.7, 10.15**

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function setU16(b: Uint8Array, at: number, v: number): void {
  b[at] = v & 0xff;
  b[at + 1] = (v >> 8) & 0xff;
}

function limitWarnings(c: ReturnType<typeof makeWarningCollector>): number {
  return c.list().filter((w) => w.code === ConversionWarningCode.LimitExceeded).length;
}

/** Runs the parser and compares everything against the independent oracle. */
function check(input: Uint8Array): boolean {
  const before = input.slice();
  const collector = makeWarningCollector();
  let result;
  try {
    result = parsePcxHeader(input, collector);
  } catch {
    return false;
  }
  if (!sameBytes(input, before)) return false;
  const v = pcxHeaderOracle(input);

  if (result.ok !== v.accepted) return false;
  if (!v.accepted) {
    if (result.ok) return false;
    let expected: string;
    if (v.kind === 'short') expected = fill(TEMPLATES.errPcxShort, v.numbers[0]);
    else if (v.kind === 'large') expected = fill(TEMPLATES.errPcxLarge, v.numbers[0], v.numbers[1]);
    else if (v.kind === 'format') expected = fill(TEMPLATES.errPcxFormat, v.numbers[0], v.numbers[1]);
    else expected = fill(TEMPLATES.errPcxInvalid, v.numbers[0]);
    if (result.error !== expected) return false;
    if (input.length < 128 && v.kind !== 'short') return false;

    // Limit warning exactly when a limit caused the failure.
    const bpl = input.length >= 68 ? input[66] + input[67] * 256 : 0;
    const limitCaused = v.condition === 6 || v.condition === 7 || v.condition === 10 || (v.condition === 9 && bpl > 4096);
    const n = limitWarnings(collector);
    if (limitCaused ? n < 1 || result.limit === undefined : n !== 0) return false;
    return true;
  }

  if (!result.ok) return false;
  const h = result.header;
  if (h.width !== v.width || h.height !== v.height) return false;
  if (h.bytesPerLine !== v.bytesPerLine || h.planes !== v.planes || h.bitsPerPixel !== v.bitsPerPixel) return false;
  return limitWarnings(collector) === 0;
}

// --- generators ------------------------------------------------------------

const validArb: fc.Arbitrary<Uint8Array> = pcxSourceArb(64).map((s) => encodePcx(s));

const U16_BOUNDS = [0, 1, 2, 4095, 4096, 4097, 65534, 65535];
const sizeValues = [1, 2, 2047, 2048, 2049, 4095, 4096, 4097, 65535, 65536];
const u16Arb = fc.oneof(fc.constantFrom(...U16_BOUNDS), fc.integer({ min: 0, max: 65535 }));
const byteArb = fc.oneof(fc.constantFrom(0, 1, 2, 3, 4, 5, 6, 8, 10, 255), fc.integer({ min: 0, max: 255 }));
const COMBOS: Array<[number, number]> = [[1, 1], [1, 4], [4, 1], [8, 1], [8, 3]];

const fuzzedValidArb: fc.Arbitrary<Uint8Array> = fc
  .record({
    base: validArb,
    manufacturer: fc.option(byteArb, { nil: undefined }),
    version: fc.option(fc.integer({ min: 0, max: 255 }), { nil: undefined }),
    encoding: fc.option(byteArb, { nil: undefined }),
    bpp: fc.option(byteArb, { nil: undefined }),
    planes: fc.option(byteArb, { nil: undefined }),
    coords: fc.option(fc.tuple(u16Arb, u16Arb, u16Arb, u16Arb), { nil: undefined }),
    size: fc.option(
      fc.tuple(fc.constantFrom(...sizeValues), fc.constantFrom(...sizeValues), fc.integer({ min: 0, max: 1 }), fc.integer({ min: 0, max: 1 })),
      { nil: undefined },
    ),
    bplMode: fc.constantFrom('keep', 'below', 'at', 'above', 'bound', 'random', 'decoded'),
    bplBound: fc.constantFrom(4096, 4097, 65535, 0, 1),
    bplRandom: fc.integer({ min: 0, max: 65535 }),
    decodedDelta: fc.integer({ min: -1, max: 2 }),
    combo: fc.option(fc.constantFrom(...COMBOS), { nil: undefined }),
    truncate: fc.option(fc.integer({ min: 0, max: 127 }), { nil: undefined }),
  })
  .map((r) => {
    const b = r.base.slice(0, Math.max(128, 0));
    if (r.manufacturer !== undefined) b[0] = r.manufacturer;
    if (r.version !== undefined) b[1] = r.version;
    if (r.encoding !== undefined) b[2] = r.encoding;
    if (r.combo !== undefined) {
      b[3] = r.combo[0];
      b[65] = r.combo[1];
    }
    if (r.bpp !== undefined) b[3] = r.bpp;
    if (r.planes !== undefined) b[65] = r.planes;
    if (r.coords !== undefined) {
      setU16(b, 4, r.coords[0]);
      setU16(b, 6, r.coords[1]);
      setU16(b, 8, r.coords[2]);
      setU16(b, 10, r.coords[3]);
    }
    if (r.size !== undefined) {
      const [w, h, xmin, ymin] = r.size;
      setU16(b, 4, xmin);
      setU16(b, 6, ymin);
      setU16(b, 8, Math.min(65535, xmin + w - 1));
      setU16(b, 10, Math.min(65535, ymin + h - 1));
    }
    const width = (b[8] + b[9] * 256) - (b[4] + b[5] * 256) + 1;
    const height = (b[10] + b[11] * 256) - (b[6] + b[7] * 256) + 1;
    const row = Math.ceil((Math.max(width, 0) * b[3]) / 8);
    switch (r.bplMode) {
      case 'below':
        setU16(b, 66, Math.max(0, row - 1));
        break;
      case 'at':
        setU16(b, 66, Math.min(65535, row));
        break;
      case 'above':
        setU16(b, 66, Math.min(65535, row + 1));
        break;
      case 'bound':
        setU16(b, 66, r.bplBound);
        break;
      case 'random':
        setU16(b, 66, r.bplRandom);
        break;
      case 'decoded': {
        const denom = Math.max(1, b[65] * Math.max(height, 1));
        setU16(b, 66, Math.max(0, Math.min(65535, Math.floor(16777216 / denom) + r.decodedDelta)));
        break;
      }
      default:
        break;
    }
    return r.truncate !== undefined ? b.slice(0, r.truncate) : b;
  });

/** Valid-looking magic with random remaining bytes and small coordinates, so acceptance is common. */
const noisyArb: fc.Arbitrary<Uint8Array> = fc
  .tuple(
    fc.uint8Array({ minLength: 128, maxLength: 128 }),
    fc.constantFrom(...COMBOS),
    fc.integer({ min: 1, max: 5000 }),
    fc.integer({ min: 1, max: 5000 }),
    fc.integer({ min: 0, max: 8192 }),
  )
  .map(([noise, [bpp, planes], w, h, bpl]) => {
    const b = noise.slice();
    b[0] = 0x0a;
    b[1] = [0, 2, 3, 4, 5][noise[1] % 5];
    b[2] = 1;
    b[3] = bpp;
    b[65] = planes;
    setU16(b, 4, 0);
    setU16(b, 6, 0);
    setU16(b, 8, w - 1);
    setU16(b, 10, h - 1);
    setU16(b, 66, bpl);
    return b;
  });

const randomBytesArb: fc.Arbitrary<Uint8Array> = fc.oneof(
  fc.uint8Array({ minLength: 0, maxLength: 140 }),
  fc.integer({ min: 0, max: 140 }).chain((n) => fc.uint8Array({ minLength: n, maxLength: n })),
  fc.uint8Array({ minLength: 141, maxLength: 600 }),
);

const opts = { numRuns: numRuns(200) };

describe('PCX header acceptance matches the oracle', () => {
  it('accepts encodePcx output and agrees with the oracle', () => {
    fc.assert(
      fc.property(validArb, (b) => pcxHeaderOracle(b).accepted && check(b)),
      opts,
    );
  });

  it('accepts only the 128-byte header of encodePcx output', () => {
    fc.assert(
      fc.property(validArb, (b) => check(b.slice(0, 128))),
      opts,
    );
  });

  it('agrees with the oracle on fuzzed fields and boundary values', () => {
    fc.assert(fc.property(fuzzedValidArb, check), { numRuns: numRuns(500) });
  });

  it('agrees with the oracle on noisy headers with valid magic', () => {
    fc.assert(fc.property(noisyArb, check), { numRuns: numRuns(500) });
  });

  it('agrees with the oracle on random bytes of every length', () => {
    fc.assert(fc.property(randomBytesArb, check), opts);
  });

  it('agrees with the oracle on fuzzed headers from the hostile generator', () => {
    fc.assert(fc.property(fuzzedHeaderArb('pcx'), (h) => check(h.bytes)), opts);
  });

  it('rejects any bytes under 128 as short without reading further', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 127 }).chain((n) => fc.uint8Array({ minLength: n, maxLength: n })),
        (b) => {
          const r = parsePcxHeader(b, makeWarningCollector());
          return !r.ok && r.error === fill(TEMPLATES.errPcxShort, b.length) && check(b);
        },
      ),
      opts,
    );
  });

  it('reports only the lowest failed condition when several fail', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 128, maxLength: 128 }),
        fc.integer({ min: 2, max: 5 }),
        (noise, keep) => {
          // Start from a header that violates every condition, then repair 2..keep-1.
          const b = noise.slice();
          b[0] = 0x0b;
          b[1] = 1;
          b[2] = 0;
          setU16(b, 4, 10);
          setU16(b, 8, 5);
          const r = parsePcxHeader(b, makeWarningCollector());
          if (r.ok || r.error !== fill(TEMPLATES.errPcxInvalid, 2)) return false;
          b[0] = 0x0a;
          const r3 = parsePcxHeader(b, makeWarningCollector());
          if (r3.ok || r3.error !== fill(TEMPLATES.errPcxInvalid, 3)) return false;
          b[1] = 5;
          const r4 = parsePcxHeader(b, makeWarningCollector());
          if (r4.ok || r4.error !== fill(TEMPLATES.errPcxInvalid, 4)) return false;
          b[2] = 1;
          const r5 = parsePcxHeader(b, makeWarningCollector());
          return keep > 0 && !r5.ok && r5.error === fill(TEMPLATES.errPcxInvalid, 5) && check(b);
        },
      ),
      opts,
    );
  });

  it('never lets DPI or screen-size bytes change the verdict', () => {
    const mutated = fc.tuple(
      fc.oneof(validArb, fuzzedValidArb, noisyArb),
      fc.uint8Array({ minLength: 8, maxLength: 8 }),
    );
    fc.assert(
      fc.property(mutated, ([b, rnd]) => {
        if (b.length < 128) return true;
        const m = b.slice();
        for (let i = 0; i < 4; i++) {
          m[12 + i] = rnd[i];
          m[70 + i] = rnd[4 + i];
        }
        const r1 = parsePcxHeader(b, makeWarningCollector());
        const r2 = parsePcxHeader(m, makeWarningCollector());
        return JSON.stringify(r1) === JSON.stringify(r2) && pcxHeaderOracle(b).accepted === pcxHeaderOracle(m).accepted;
      }),
      opts,
    );
  });

  it('never throws and never modifies the input', () => {
    fc.assert(
      fc.property(fc.oneof(randomBytesArb, fuzzedValidArb, noisyArb), (b) => {
        const before = b.slice();
        try {
          parsePcxHeader(b, makeWarningCollector());
        } catch {
          return false;
        }
        return sameBytes(b, before);
      }),
      opts,
    );
  });
});
