import { describe, it } from 'vitest';
import fc from 'fast-check';
import {
  convertAuto,
  convertDBase,
  convertPcx,
  convertWordStar,
  detectFormat,
  encodePng,
} from './index';
import type { ConversionResult, ConversionWarning } from './index';
import { dbfTableArb, pcxSourceArb, rgbaImageArb, wsParagraphsArb } from '../../test-support/formats/arbitraries';
import { writeDbf } from '../../test-support/formats/dbase-writer';
import { hostileInputArb } from '../../test-support/formats/hostile';
import type { HostileFormat } from '../../test-support/formats/hostile';
import { checkResultInvariants } from '../../test-support/formats/invariants';
import { encodePcx } from '../../test-support/formats/pcx-encoder';
import { writeWordStar } from '../../test-support/formats/wordstar-writer';
import { numRuns } from '../../test-support/runs';

// ---------------------------------------------------------------------------
// Shared helpers (Property 3 appends below and reuses these)
// ---------------------------------------------------------------------------

/** Cap for the fast runs; a couple of explicit runs below use the full generator range. */
const FAST_CAP = 200_000;

type Converter = (input: Uint8Array) => ConversionResult;
type Expected = { mime: string; extension: string };

const WORDSTAR: Expected = { mime: 'text/markdown', extension: '.md' };
const DBASE: Expected = { mime: 'text/csv', extension: '.csv' };
const PCX: Expected = { mime: 'image/png', extension: '.png' };

/** Throws a plain Error naming the converter and joining the violations. */
function assertContract(name: string, result: unknown, expected: Expected | null): void {
  const violations = checkResultInvariants(result);
  const r = result as { ok?: unknown; mime?: unknown; extension?: unknown };
  if (expected !== null && r.ok === true) {
    if (r.mime !== expected.mime) violations.push(`mime ${String(r.mime)} should be ${expected.mime}`);
    if (r.extension !== expected.extension) {
      violations.push(`extension ${String(r.extension)} should be ${expected.extension}`);
    }
  }
  if (violations.length > 0) throw new Error(`${name}: ${violations.join('; ')}`);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function sameWarnings(a: ConversionWarning[], b: ConversionWarning[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]?.code !== b[i]?.code || a[i]?.message !== b[i]?.message) return false;
  }
  return true;
}

function sameResult(a: ConversionResult, b: ConversionResult): boolean {
  if (a.ok !== b.ok || !sameWarnings(a.warnings, b.warnings)) return false;
  if (!a.ok || !b.ok) return !a.ok && !b.ok && a.error === b.error;
  if (a.mime !== b.mime || a.extension !== b.extension) return false;
  if (typeof a.output === 'string' || typeof b.output === 'string') return a.output === b.output;
  return sameBytes(a.output, b.output);
}

function capped(bytes: Uint8Array, cap: number): Uint8Array {
  return bytes.length > cap ? bytes.subarray(0, cap) : bytes;
}

const wsFixtureArb = wsParagraphsArb.map((p) => writeWordStar(p));
const dbfFixtureArb = dbfTableArb.map((t) => writeDbf(t));
const pcxFixtureArb = pcxSourceArb(24).map((s) => encodePcx(s));

/** Hostile bytes for one format, truncated to `cap`. */
function hostileBytesArb(format: HostileFormat, cap: number): fc.Arbitrary<Uint8Array> {
  return hostileInputArb(format).map((h) => capped(h.bytes, cap));
}

interface ConverterCase {
  name: string;
  format: HostileFormat;
  convert: Converter;
  expected: Expected;
  fixture: fc.Arbitrary<Uint8Array>;
}

const CASES: ConverterCase[] = [
  { name: 'convertWordStar', format: 'wordstar', convert: convertWordStar, expected: WORDSTAR, fixture: wsFixtureArb },
  { name: 'convertDBase', format: 'dbase', convert: convertDBase, expected: DBASE, fixture: dbfFixtureArb },
  { name: 'convertPcx', format: 'pcx', convert: convertPcx, expected: PCX, fixture: pcxFixtureArb },
];

/** What detection says, mapped to the converter that convertAuto must agree with. */
function converterFor(input: Uint8Array): Converter | null {
  switch (detectFormat(input).format) {
    case 'wordstar':
      return convertWordStar;
    case 'dbase':
      return convertDBase;
    case 'pcx':
      return convertPcx;
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Property 1
// ---------------------------------------------------------------------------

/**
 * Feature: format-resurrection, Property 1: Result contract
 *
 * **Validates: Requirements 1.4, 1.5, 1.13, 1.14, 8.7, 10.14, 12.7, 14.7, 14.8**
 */
describe('Property 1: result contract', () => {
  for (const c of CASES) {
    it(`${c.name} satisfies the contract on hostile input`, () => {
      fc.assert(
        fc.property(hostileBytesArb(c.format, FAST_CAP), (bytes) => {
          assertContract(c.name, c.convert(bytes), c.expected);
        }),
        { numRuns: numRuns(100) },
      );
    });

    it(`${c.name} satisfies the contract on valid fixtures`, () => {
      fc.assert(
        fc.property(c.fixture, (bytes) => {
          assertContract(c.name, c.convert(bytes), c.expected);
        }),
        { numRuns: numRuns(100) },
      );
    });

    it(`${c.name} satisfies the contract on full-size hostile input`, () => {
      fc.assert(
        fc.property(hostileBytesArb(c.format, Number.MAX_SAFE_INTEGER), (bytes) => {
          assertContract(c.name, c.convert(bytes), c.expected);
        }),
        { numRuns: numRuns(10) },
      );
    });
  }

  it('valid fixtures convert with ok:true and the expected mime and extension', () => {
    for (const c of CASES) {
      fc.assert(
        fc.property(c.fixture, (bytes) => {
          const r = c.convert(bytes);
          if (!r.ok) throw new Error(`${c.name}: valid fixture failed with "${r.error}"`);
          assertContract(c.name, r, c.expected);
        }),
        { numRuns: numRuns(50) },
      );
    }
  });

  it('encodePng satisfies the contract on valid images', () => {
    fc.assert(
      fc.property(rgbaImageArb(), (img) => {
        const r = encodePng(img);
        if (!r.ok) throw new Error(`encodePng: valid image failed with "${r.error}"`);
        assertContract('encodePng', r, PCX);
      }),
      { numRuns: numRuns(100) },
    );
  });

  it('encodePng satisfies the contract on invalid shapes', () => {
    const invalidArb: fc.Arbitrary<unknown> = fc.oneof(
      fc.constant(null),
      fc.constant(undefined),
      fc.string(),
      fc.double(),
      fc.record({
        width: fc.oneof(fc.integer({ min: -5, max: 70000 }), fc.double(), fc.string()),
        height: fc.oneof(fc.integer({ min: -5, max: 70000 }), fc.double(), fc.string()),
        rgba: fc.oneof(fc.uint8Array({ maxLength: 32 }), fc.string(), fc.constant(null)),
      }),
      rgbaImageArb(8, 8).map((img) => ({ ...img, rgba: img.rgba.subarray(1) })),
    );
    fc.assert(
      fc.property(invalidArb, (input) => {
        assertContract('encodePng', encodePng(input as Parameters<typeof encodePng>[0]), PCX);
      }),
      { numRuns: numRuns(100) },
    );
  });

  it('convertAuto satisfies the contract and matches the detected format converter', () => {
    const autoInputArb = fc.oneof(
      hostileBytesArb('auto', FAST_CAP),
      wsFixtureArb,
      dbfFixtureArb,
      pcxFixtureArb,
    );
    fc.assert(
      fc.property(autoInputArb, (bytes) => {
        const auto = convertAuto(bytes);
        assertContract('convertAuto', auto, null);
        const direct = converterFor(bytes);
        if (direct === null) {
          if (auto.ok) throw new Error('convertAuto: succeeded although the format is unknown');
          if (auto.warnings.length !== 0) throw new Error('convertAuto: unknown format carries warnings');
          return;
        }
        if (!sameResult(auto, direct(bytes))) {
          throw new Error('convertAuto: result differs from the detected format converter');
        }
      }),
      { numRuns: numRuns(100) },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3
// ---------------------------------------------------------------------------

/** A Buffer view with a non-zero byteOffset inside a larger allocation. */
function pooledView(bytes: Uint8Array): Uint8Array {
  const pad = Buffer.alloc(13, 0xaa);
  const slab = Buffer.concat([pad, Buffer.from(bytes), pad]);
  const view = slab.subarray(pad.length, pad.length + bytes.length);
  if (bytes.length > 0 && view.byteOffset === 0) throw new Error('pooledView: offset expected');
  return view;
}

/** True when `out` shares memory with `input`. */
function sharesMemory(out: Uint8Array, input: Uint8Array): boolean {
  if (out.buffer !== input.buffer) return false;
  const aStart = out.byteOffset;
  const aEnd = aStart + out.byteLength;
  const bStart = input.byteOffset;
  const bEnd = bStart + input.byteLength;
  return aStart < bEnd && bStart < aEnd;
}

/** Runs `fn` on `bytes` and checks it left them unchanged and the result does not alias them. */
function checkCall<T>(name: string, bytes: Uint8Array, fn: (b: Uint8Array) => T): T {
  const before = Uint8Array.from(bytes);
  const result = fn(bytes);
  if (!sameBytes(before, bytes)) throw new Error(`${name}: input bytes were modified`);
  const out = (result as { output?: unknown }).output;
  if (out instanceof Uint8Array && sharesMemory(out, bytes)) {
    throw new Error(`${name}: output aliases the input`);
  }
  return result;
}

function checkDeterminism(
  name: string,
  convert: Converter,
  bytes: Uint8Array,
  other: Uint8Array,
): void {
  const first = checkCall(name, bytes, convert);
  // Interleave with other conversions to catch hidden state, clock or random use.
  convertWordStar(other);
  const second = checkCall(name, bytes, convert);
  convertDBase(other);
  convertPcx(other);
  convertAuto(other);
  const third = checkCall(name, bytes, convert);
  if (!sameResult(first, second) || !sameResult(first, third)) {
    throw new Error(`${name}: results differ between identical calls`);
  }
  const copy = checkCall(name, Buffer.from(bytes), convert);
  if (!sameResult(first, copy)) throw new Error(`${name}: Buffer copy result differs from Uint8Array`);
  const view = checkCall(name, pooledView(bytes), convert);
  if (!sameResult(first, view)) throw new Error(`${name}: pooled Buffer view result differs from Uint8Array`);
}

function checkDetect(bytes: Uint8Array, other: Uint8Array): void {
  const before = Uint8Array.from(bytes);
  const first = detectFormat(bytes);
  detectFormat(other);
  const second = detectFormat(bytes);
  convertAuto(other);
  const third = detectFormat(bytes);
  const copy = detectFormat(Buffer.from(bytes));
  const view = detectFormat(pooledView(bytes));
  if (!sameBytes(before, bytes)) throw new Error('detectFormat: input bytes were modified');
  const same = (x: unknown, y: unknown) => JSON.stringify(x) === JSON.stringify(y);
  if (!same(first, second) || !same(first, third)) throw new Error('detectFormat: results differ between calls');
  if (!same(first, copy)) throw new Error('detectFormat: Buffer copy result differs');
  if (!same(first, view)) throw new Error('detectFormat: pooled Buffer view result differs');
}

const ALL_CONVERTERS: { name: string; convert: Converter }[] = [
  ...CASES.map((c) => ({ name: c.name, convert: c.convert })),
  { name: 'convertAuto', convert: convertAuto },
];

/**
 * Feature: format-resurrection, Property 3: Determinism and Buffer equivalence
 *
 * **Validates: Requirements 1.10, 1.11, 11.11**
 */
describe('Property 3: determinism and Buffer equivalence', () => {
  const otherArb = fc.oneof(hostileBytesArb('auto', 4096), wsFixtureArb, dbfFixtureArb, pcxFixtureArb);

  for (const c of ALL_CONVERTERS) {
    const hostileArb =
      c.name === 'convertAuto'
        ? hostileBytesArb('auto', FAST_CAP)
        : hostileBytesArb(CASES.find((x) => x.name === c.name)!.format, FAST_CAP);
    const fixtureArb =
      c.name === 'convertAuto'
        ? fc.oneof(wsFixtureArb, dbfFixtureArb, pcxFixtureArb)
        : CASES.find((x) => x.name === c.name)!.fixture;

    it(`${c.name} is deterministic and Buffer-equivalent on hostile input`, () => {
      fc.assert(
        fc.property(hostileArb, otherArb, (bytes, other) => {
          checkDeterminism(c.name, c.convert, bytes, other);
        }),
        { numRuns: numRuns(50) },
      );
    });

    it(`${c.name} is deterministic and Buffer-equivalent on valid fixtures`, () => {
      fc.assert(
        fc.property(fixtureArb, otherArb, (bytes, other) => {
          checkDeterminism(c.name, c.convert, bytes, other);
        }),
        { numRuns: numRuns(50) },
      );
    });
  }

  for (const c of CASES) {
    it(`${c.name} is deterministic on full-size hostile input`, () => {
      fc.assert(
        fc.property(hostileBytesArb(c.format, Number.MAX_SAFE_INTEGER), otherArb, (bytes, other) => {
          checkDeterminism(c.name, c.convert, bytes, other);
        }),
        { numRuns: numRuns(5) },
      );
    });
  }

  it('detectFormat is deterministic and Buffer-equivalent', () => {
    const inputArb = fc.oneof(
      hostileBytesArb('auto', FAST_CAP),
      hostileBytesArb('wordstar', FAST_CAP),
      hostileBytesArb('dbase', FAST_CAP),
      hostileBytesArb('pcx', FAST_CAP),
      wsFixtureArb,
      dbfFixtureArb,
      pcxFixtureArb,
    );
    fc.assert(
      fc.property(inputArb, otherArb, (bytes, other) => {
        checkDetect(bytes, other);
      }),
      { numRuns: numRuns(100) },
    );
  });

  it('PNG output from convertPcx does not share the input buffer', () => {
    fc.assert(
      fc.property(pcxFixtureArb, (bytes) => {
        const pooled = pooledView(bytes);
        const r = convertPcx(pooled);
        if (!r.ok || typeof r.output === 'string') throw new Error('convertPcx: valid fixture did not give bytes');
        if (r.output.buffer === pooled.buffer) throw new Error('convertPcx: output.buffer is the input buffer');
        if (sharesMemory(r.output, pooled)) throw new Error('convertPcx: output is a view of the input');
      }),
      { numRuns: numRuns(50) },
    );
  });

  it('encodePng gives identical bytes for identical images and leaves rgba unchanged', () => {
    fc.assert(
      fc.property(rgbaImageArb(), otherArb, (img, other) => {
        const before = Uint8Array.from(img.rgba);
        const a = encodePng(img);
        convertPcx(other);
        const b = encodePng({ width: img.width, height: img.height, rgba: Uint8Array.from(img.rgba) });
        const c = encodePng(img);
        if (!sameBytes(before, img.rgba)) throw new Error('encodePng: rgba was modified');
        if (!sameResult(a, b) || !sameResult(a, c)) throw new Error('encodePng: results differ for identical images');
        if (a.ok && typeof a.output !== 'string') {
          if (sharesMemory(a.output, img.rgba)) throw new Error('encodePng: output aliases rgba');
          if (a.output === (c as { output: unknown }).output) throw new Error('encodePng: output object reused');
        }
      }),
      { numRuns: numRuns(100) },
    );
  });
});
