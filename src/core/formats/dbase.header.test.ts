import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import { numRuns } from '../../test-support/runs';
import { writeDbf } from '../../test-support/formats';
import { dbfTableArb } from '../../test-support/formats/arbitraries';
import { fuzzedHeaderArb } from '../../test-support/formats/hostile';
import { dbfHeaderOracle, expectedFieldName } from '../../test-support/formats/oracles';
import { parseDbfHeader } from './dbase-header';
import { fill, TEMPLATES } from './templates';
import { ConversionWarningCode } from './types';
import { makeWarningCollector } from './warnings';

// Feature: format-resurrection, Property 16: dBase header acceptance matches the oracle
// **Validates: Requirements 6.3, 6.5, 6.6**

const KNOWN = 'CDFLMN';

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Runs the parser and compares everything against the independent oracle. */
function check(input: Uint8Array): boolean {
  const before = input.slice();
  const collector = makeWarningCollector();
  let result;
  try {
    result = parseDbfHeader(input, collector);
  } catch {
    return false;
  }
  if (!sameBytes(input, before)) return false;
  const verdict = dbfHeaderOracle(input);

  if (result.ok !== verdict.accepted) return false;
  if (!result.ok) {
    if (verdict.accepted) return false;
    const expected =
      verdict.kind === 'version'
        ? fill(TEMPLATES.errDbfVersion, verdict.version)
        : fill(TEMPLATES.errDbfInvalid, verdict.condition);
    if (result.error !== expected) return false;
    if (input.length < 32 && (verdict.kind !== 'invalid' || verdict.condition !== 2)) return false;
    return true;
  }
  if (!verdict.accepted) return false;

  const h = result.header;
  if (h.fields.length !== verdict.fieldCount) return false;
  if (h.headerLength !== verdict.headerLength || h.recordLength !== verdict.recordLength) return false;

  let sum = 0;
  const unknownIdx: number[] = [];
  for (let k = 0; k < verdict.fieldCount; k++) {
    const d = 32 + 32 * k;
    const f = h.fields[k];
    sum += input[d + 16];
    if (f.length !== input[d + 16]) return false;
    if (f.name !== expectedFieldName(input.subarray(d, d + 11))) return false;
    const letter = String.fromCharCode(input[d + 11]);
    const known = KNOWN.includes(letter);
    if (f.type !== (known ? letter : 'C')) return false;
    if (!known) unknownIdx.push(k + 1);
  }
  if (h.fieldLengthSum !== sum) return false;

  const unknownWarnings = collector.list().filter((w) => w.code === ConversionWarningCode.FieldTypeUnknown);
  if (unknownIdx.length <= 99) {
    if (unknownWarnings.length !== unknownIdx.length) return false;
    for (let i = 0; i < unknownIdx.length; i++) {
      if (unknownWarnings[i].message !== fill(TEMPLATES.fieldTypeUnknown, unknownIdx[i])) return false;
    }
  } else if (unknownWarnings.length < 1) {
    return false;
  }
  return true;
}

// --- generators ------------------------------------------------------------

const validArb: fc.Arbitrary<Uint8Array> = dbfTableArb.map((t) => writeDbf(t));

const lengthValues = [0, 31, 32, 64, 65, 4129, 4130, 65535];

type Mutator = (b: Uint8Array) => Uint8Array;

function setU16(b: Uint8Array, at: number, v: number): void {
  if (b.length > at + 1) {
    b[at] = v & 0xff;
    b[at + 1] = (v >> 8) & 0xff;
  }
}

const mutatorArb: fc.Arbitrary<Mutator> = fc.oneof(
  fc.constantFrom(0x00, 0x02, 0x03, 0x04, 0x30, 0x83, 0x8b, 0xf5, 0xff).map((v): Mutator => (b) => {
    if (b.length > 0) b[0] = v;
    return b;
  }),
  fc.constantFrom(...lengthValues).map((v): Mutator => (b) => {
    setU16(b, 8, v);
    return b;
  }),
  fc.constantFrom(-1, 1).map((delta): Mutator => (b) => {
    setU16(b, 8, Math.max(0, b.length + delta) & 0xffff);
    return b;
  }),
  fc.integer({ min: 0, max: 0xffff }).map((v): Mutator => (b) => {
    setU16(b, 10, v);
    return b;
  }),
  fc.tuple(fc.integer({ min: 0, max: 3 }), fc.constantFrom(0, 1, 255, 256, 257)).map(([k, v]): Mutator => (b) => {
    const at = 32 + 32 * k + 16;
    if (at < b.length) b[at] = v & 0xff; // 256 wraps to 0
    return b;
  }),
  // missing terminator
  fc.constant<Mutator>((b) => {
    if (b.length > 8) {
      const hl = b[8] | (b[9] << 8);
      if (hl >= 1 && hl <= b.length) b[hl - 1] = 0x00;
    }
    return b;
  }),
  // terminator one position early or late
  fc.constantFrom(-1, 1, 31, -31).map((delta): Mutator => (b) => {
    if (b.length > 8) {
      const hl = b[8] | (b[9] << 8);
      const from = hl - 1;
      const to = from + delta;
      if (from >= 0 && from < b.length && to >= 0 && to < b.length) {
        b[from] = 0x20;
        b[to] = 0x0d;
      }
    }
    return b;
  }),
  // unknown or odd type letters
  fc.tuple(fc.integer({ min: 0, max: 3 }), fc.integer({ min: 0, max: 255 })).map(([k, v]): Mutator => (b) => {
    const at = 32 + 32 * k + 11;
    if (at < b.length) b[at] = v;
    return b;
  }),
);

const fuzzedValidArb: fc.Arbitrary<Uint8Array> = fc
  .tuple(validArb, fc.array(mutatorArb, { minLength: 1, maxLength: 3 }))
  .map(([bytes, ms]: [Uint8Array, Mutator[]]) => {
    let acc: Uint8Array = bytes.slice();
    for (const m of ms) acc = m(acc);
    return acc;
  });

/** Hand-built headers with n descriptors, around the 128-field limit. */
const manyFieldsArb: fc.Arbitrary<Uint8Array> = fc
  .tuple(
    fc.integer({ min: 125, max: 140 }),
    fc.constantFrom(-1, 0, 1),
    fc.integer({ min: 1, max: 3 }),
    fc.boolean(),
  )
  .map(([n, termShift, fieldLen, exactRecord]) => {
    const hl = 32 + 32 * n + 1;
    const b = new Uint8Array(hl + 4);
    b[0] = 0x03;
    b[8] = hl & 0xff;
    b[9] = (hl >> 8) & 0xff;
    const rl = exactRecord ? 1 + n * fieldLen : 0xffff;
    b[10] = rl & 0xff;
    b[11] = (rl >> 8) & 0xff;
    for (let k = 0; k < n; k++) {
      b[32 + 32 * k] = 0x41 + (k % 26);
      b[32 + 32 * k + 11] = 0x43;
      b[32 + 32 * k + 16] = fieldLen;
    }
    b[hl - 1 + termShift] = 0x0d;
    return b;
  });

const randomBytesArb: fc.Arbitrary<Uint8Array> = fc.oneof(
  fc.uint8Array({ minLength: 0, maxLength: 200 }),
  fc.integer({ min: 0, max: 40 }).chain((n) => fc.uint8Array({ minLength: n, maxLength: n })),
);

/** Valid-looking header with random descriptors, so acceptance is common. */
const noisyHeaderArb: fc.Arbitrary<Uint8Array> = fc
  .tuple(fc.integer({ min: 1, max: 4 }), fc.uint8Array({ minLength: 160, maxLength: 160 }), fc.boolean())
  .map(([n, noise, longRecord]) => {
    const hl = 32 + 32 * n + 1;
    const b = new Uint8Array(Math.max(hl, 160));
    b.set(noise.subarray(0, b.length));
    b[0] = 0x03;
    b[8] = hl & 0xff;
    b[9] = 0;
    const rl = longRecord ? 0xffff : noise[10] | (noise[11] << 8);
    b[10] = rl & 0xff;
    b[11] = rl >> 8;
    for (let k = 0; k < n; k++) {
      const len = 1 + (noise[32 + k] % 20);
      b[32 + 32 * k + 16] = len;
      if (b[32 + 32 * k] === 0x0d) b[32 + 32 * k] = 0x41;
    }
    b[hl - 1] = 0x0d;
    return b;
  });

const opts = { numRuns: numRuns(200) };

describe('dBase header acceptance matches the oracle', () => {
  it('accepts writeDbf output and agrees with the oracle', () => {
    fc.assert(
      fc.property(validArb, (b) => dbfHeaderOracle(b).accepted && check(b)),
      opts,
    );
  });

  it('agrees with the oracle on fuzzed valid headers', () => {
    fc.assert(fc.property(fuzzedValidArb, check), opts);
  });

  it('agrees with the oracle around the 128-field limit', () => {
    fc.assert(fc.property(manyFieldsArb, check), opts);
  });

  it('agrees with the oracle on random bytes of 0 to 200 bytes', () => {
    fc.assert(fc.property(randomBytesArb, check), opts);
  });

  it('agrees with the oracle on noisy but plausible headers', () => {
    fc.assert(fc.property(noisyHeaderArb, check), opts);
  });

  it('agrees with the oracle on fuzzed headers from the hostile generator', () => {
    fc.assert(fc.property(fuzzedHeaderArb('dbase'), (h) => check(h.bytes)), opts);
  });

  it('rejects every length 0..31 with condition 2', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 31 }).chain((n) => fc.uint8Array({ minLength: n, maxLength: n })),
        (b) => {
          const r = parseDbfHeader(b, makeWarningCollector());
          return !r.ok && r.error === fill(TEMPLATES.errDbfInvalid, 2) && check(b);
        },
      ),
      opts,
    );
  });

  it('reports the version error before any other condition', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 255 }).filter((v) => v !== 0x03 && v !== 0x83),
        fc.constantFrom(0, 31, 64, 4130, 65535),
        fc.uint8Array({ minLength: 32, maxLength: 100 }),
        (version, hl, rest) => {
          const b = rest.slice();
          b[0] = version;
          setU16(b, 8, hl);
          const r = parseDbfHeader(b, makeWarningCollector());
          return !r.ok && r.error === fill(TEMPLATES.errDbfVersion, version);
        },
      ),
      opts,
    );
  });

  it('never throws and never modifies the input for 0..300 bytes', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.uint8Array({ minLength: 0, maxLength: 300 }),
          fc.uint8Array({ minLength: 0, maxLength: 300 }).map((b) => {
            if (b.length > 0) b[0] = 0x03;
            return b;
          }),
        ),
        (b) => {
          const before = b.slice();
          try {
            parseDbfHeader(b, makeWarningCollector());
          } catch {
            return false;
          }
          return sameBytes(b, before);
        },
      ),
      opts,
    );
  });
});
