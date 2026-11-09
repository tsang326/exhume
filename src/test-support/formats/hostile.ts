// Hostile-input generators for the format converters (test-only).
// NOT exported from ./index.ts.
//
// These arbitraries only PRODUCE inputs. They never call a converter and never use timed().
// Families per format: random bytes with planted prefixes, grammar-aware bytes,
// mutated fixture files (exactly one mutation per run) and fuzzed headers
// drawn from boundary values.

import * as fc from 'fast-check';

import { expandContent, dbfTableArb, pcxSourceArb, plainTextBytesArb, wsParagraphsArb } from './arbitraries';
import { writeDbf } from './dbase-writer';
import { encodePcx } from './pcx-encoder';
import { writeWordStar } from './wordstar-writer';

export type HostileFormat = 'wordstar' | 'dbase' | 'pcx' | 'text' | 'auto';

export interface HostileInput {
  format: HostileFormat;
  family: string;
  bytes: Uint8Array;
}

const RANDOM_MAX_LENGTH = 2_097_152;

const randomLengthArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 6, arbitrary: fc.integer({ min: 0, max: 512 }) },
  { weight: 3, arbitrary: fc.integer({ min: 0, max: 8192 }) },
  { weight: 1, arbitrary: fc.integer({ min: 0, max: RANDOM_MAX_LENGTH }) },
);

/** Boundary values for 16-bit header fields. */
const U16_BOUNDARY = [0, 1, 2, 31, 32, 33, 127, 128, 255, 256, 4095, 4096, 32767, 32768, 65534, 65535];
/** Boundary values for 32-bit header fields. */
const U32_BOUNDARY = [0, 1, 65535, 65536, 16777215, 2147483647, 2147483648, 4294967294, 4294967295];

const u16Arb = fc.constantFrom(...U16_BOUNDARY);
const u32Arb = fc.constantFrom(...U32_BOUNDARY);

function setU16(b: Uint8Array, offset: number, v: number): void {
  if (offset + 2 > b.length) return;
  b[offset] = v & 0xff;
  b[offset + 1] = (v >>> 8) & 0xff;
}

function setU32(b: Uint8Array, offset: number, v: number): void {
  if (offset + 4 > b.length) return;
  setU16(b, offset, v & 0xffff);
  setU16(b, offset + 2, (v >>> 16) & 0xffff);
}

// ---------------------------------------------------------------------------
// Valid fixture files (small)
// ---------------------------------------------------------------------------

const wsFileArb: fc.Arbitrary<Uint8Array> = wsParagraphsArb.map((p) => writeWordStar(p));
const dbfFileArb: fc.Arbitrary<Uint8Array> = dbfTableArb.map((t) => writeDbf(t));
const pcxFileArb: fc.Arbitrary<Uint8Array> = pcxSourceArb(24).map((s) => encodePcx(s));

const FIXTURE_BY_FORMAT: Record<Exclude<HostileFormat, 'auto'>, fc.Arbitrary<Uint8Array>> = {
  wordstar: wsFileArb,
  dbase: dbfFileArb,
  pcx: pcxFileArb,
  text: plainTextBytesArb,
};

const anyFixtureArb: fc.Arbitrary<Uint8Array> = fc.oneof(wsFileArb, dbfFileArb, pcxFileArb, plainTextBytesArb);

function fixtureFor(format: HostileFormat): fc.Arbitrary<Uint8Array> {
  return format === 'auto' ? anyFixtureArb : FIXTURE_BY_FORMAT[format];
}

// ---------------------------------------------------------------------------
// (a) random bytes with planted prefixes
// ---------------------------------------------------------------------------

const PREFIXES: Record<HostileFormat, number[][]> = {
  wordstar: [[], [0x8d, 0x0a], [0x0d, 0x0a], [0x02], [0x1a], [0x2e, 0x50, 0x41, 0x0d, 0x0a], [0x2e, 0x2e]],
  dbase: [[], [0x03], [0x03, 0x7c, 1, 1], [0x83], [0x8b], [0xf5], [0x30]],
  pcx: [[], [0x0a], [0x0a, 5, 1, 8], [0x0a, 3, 1, 1], [0x0a, 5, 1, 4]],
  text: [[], [0x1a], [0x0d], [0x0d, 0x0a], [0x00], [0x7f], [0x68, 0x69, 0x0d, 0x0a]],
  auto: [[], [0x0a, 5, 1, 8], [0x03, 0x7c, 1, 1], [0x2e, 0x50, 0x41], [0x68, 0x69, 0x0d, 0x0a]],
};

export function randomBytesArb(format: HostileFormat): fc.Arbitrary<HostileInput> {
  return fc
    .record({
      seed: fc.integer({ min: 0, max: 0xffffffff }),
      length: randomLengthArb,
      prefix: fc.constantFrom(...PREFIXES[format]),
    })
    .map(({ seed, length, prefix }): HostileInput => {
      const bytes = expandContent(seed, length);
      bytes.set(prefix.slice(0, length), 0);
      return { format, family: 'random-bytes', bytes };
    });
}

// ---------------------------------------------------------------------------
// (b) grammar-aware bytes
// ---------------------------------------------------------------------------

const WS_TOKENS: number[][] = [
  [0x02], [0x13], [0x19], [0x0d, 0x0a], [0x0d], [0x0a], [0x8d, 0x0a], [0x8d], [0x0d, 0x8a], [0x09],
  [0x00], [0x1f], [0x1a], [0x7f], [0x01], [0x2e, 0x50, 0x41, 0x0d, 0x0a], [0x2e, 0x2e, 0x20, 0x78, 0x0d, 0x0a],
  [0x2e, 0x35, 0x0d, 0x0a], [0x2a], [0x5f], [0x5c], [0x3c], [0x23, 0x20], [0x31, 0x2e, 0x20],
  [0xe1], [0xff], [0x41, 0x42, 0xc3], [0x20], [0x20, 0x20],
  [0xa0], [0x1f, 0x8d, 0x0a], [0x4d, 0x5a],
];

// MZ/ZM only vetoes at offset 0, so it is also offered as a sequence prefix (exercises the MZ veto).
const WS_PREFIXES: number[][] = [[], [], [], [0x4d, 0x5a], [0x5a, 0x4d]];

const wsGrammarArb: fc.Arbitrary<Uint8Array> = fc
  .tuple(
    fc.constantFrom(...WS_PREFIXES),
    fc.array(fc.oneof(fc.constantFrom(...WS_TOKENS), fc.integer({ min: 0, max: 255 }).map((n) => [n])), {
      minLength: 0,
      maxLength: 400,
    }),
  )
  .map(([prefix, tokens]) => Uint8Array.from([...prefix, ...tokens.flat()]));

const DBF_FIELD_TYPES = 'CNFDLMXcnfdlm?0'.split('').map((c) => c.charCodeAt(0));

/** A header plus descriptors with arbitrary (not necessarily consistent) lengths, then arbitrary record bytes. */
const dbfGrammarArb: fc.Arbitrary<Uint8Array> = fc
  .record({
    version: fc.constantFrom(0x03, 0x83, 0x8b, 0xf5, 0x30, 0x02, 0x00),
    fieldCount: fc.integer({ min: 0, max: 8 }),
    fields: fc.array(
      fc.record({
        type: fc.constantFrom(...DBF_FIELD_TYPES),
        length: fc.oneof(fc.integer({ min: 0, max: 40 }), fc.constantFrom(254, 255)),
        decimals: fc.integer({ min: 0, max: 255 }),
        name: fc.integer({ min: 0, max: 0xffffffff }),
      }),
      { minLength: 8, maxLength: 8 },
    ),
    terminator: fc.constantFrom(0x0d, 0x0d, 0x0d, 0x00),
    recordCount: fc.oneof(fc.integer({ min: 0, max: 6 }), u32Arb),
    skewHeader: fc.integer({ min: -4, max: 4 }),
    skewRecord: fc.integer({ min: -2, max: 2 }),
    seed: fc.integer({ min: 0, max: 0xffffffff }),
    tail: fc.integer({ min: 0, max: 300 }),
  })
  .map((g) => {
    const fields = g.fields.slice(0, g.fieldCount);
    const headerLength = 32 + 32 * fields.length + 1;
    const recordLength = 1 + fields.reduce((n, f) => n + f.length, 0);
    const tail = expandContent(g.seed, g.tail);
    const out = new Uint8Array(headerLength + tail.length);
    out[0] = g.version;
    setU32(out, 4, g.recordCount);
    setU16(out, 8, Math.max(0, headerLength + g.skewHeader));
    setU16(out, 10, Math.max(0, recordLength + g.skewRecord));
    fields.forEach((f, i) => {
      const base = 32 + 32 * i;
      const name = expandContent(f.name, 10);
      for (let k = 0; k < 10; k++) out[base + k] = 0x41 + ((name[k] as number) % 26);
      out[base + 11] = f.type;
      out[base + 16] = f.length;
      out[base + 17] = f.decimals;
    });
    out[headerLength - 1] = g.terminator;
    out.set(tail, headerLength);
    return out;
  });

/** Header fields in plausible shape, with RLE-heavy or random data after. */
const pcxGrammarArb: fc.Arbitrary<Uint8Array> = fc
  .record({
    version: fc.constantFrom(0, 2, 3, 4, 5),
    encoding: fc.constantFrom(1, 1, 1, 0, 2),
    bits: fc.constantFrom(1, 2, 4, 8, 8, 16),
    planes: fc.constantFrom(1, 1, 3, 4, 2),
    width: fc.integer({ min: 0, max: 40 }),
    height: fc.integer({ min: 0, max: 40 }),
    bytesPerLine: fc.integer({ min: 0, max: 80 }),
    seed: fc.integer({ min: 0, max: 0xffffffff }),
    dataLength: fc.integer({ min: 0, max: 400 }),
    runs: fc.boolean(),
    trailer: fc.boolean(),
  })
  .map((g) => {
    const data = expandContent(g.seed, g.dataLength);
    if (g.runs) for (let i = 0; i < data.length; i += 2) data[i] = 0xc0 | ((data[i] as number) & 0x3f);
    const trailerLen = g.trailer ? 769 : 0;
    const out = new Uint8Array(128 + data.length + trailerLen);
    out[0] = 0x0a;
    out[1] = g.version;
    out[2] = g.encoding;
    out[3] = g.bits;
    setU16(out, 8, Math.max(0, g.width - 1));
    setU16(out, 10, Math.max(0, g.height - 1));
    out[65] = g.planes;
    setU16(out, 66, g.bytesPerLine);
    out.set(expandContent(g.seed ^ 0x1234567, 48), 16);
    out.set(data, 128);
    if (g.trailer) out[128 + data.length] = 0x0c;
    return out;
  });

const TEXT_TOKENS: number[][] = [
  [0x0d, 0x0a], [0x0d], [0x0a], [0x0a, 0x0d], [0x09], [0x0c], [0x1a], [0x00], [0x01], [0x1b], [0x1f],
  [0x7f], [0x80], [0xc4], [0xdb], [0xe1], [0xff], [0x20], [0x20, 0x20], [0x41, 0x42, 0x43],
  [0x2e, 0x50, 0x41], [0x68, 0x65, 0x6c, 0x6c, 0x6f],
];

/** Text-like bytes: printable runs, every kind of line ending, EOF, NUL, DEL, control and high bytes. */
const textGrammarArb: fc.Arbitrary<Uint8Array> = fc
  .array(
    fc.oneof(
      fc.constantFrom(...TEXT_TOKENS),
      fc.integer({ min: 0x20, max: 0x7e }).map((n) => [n]),
      fc.integer({ min: 0, max: 255 }).map((n) => [n]),
    ),
    { minLength: 0, maxLength: 400 },
  )
  .map((tokens) => Uint8Array.from(tokens.flat()));

export function grammarBytesArb(format: HostileFormat): fc.Arbitrary<HostileInput> {
  const bytes: fc.Arbitrary<Uint8Array> =
    format === 'wordstar'
      ? wsGrammarArb
      : format === 'dbase'
        ? dbfGrammarArb
        : format === 'pcx'
          ? pcxGrammarArb
          : format === 'text'
            ? textGrammarArb
            : fc.oneof(wsGrammarArb, dbfGrammarArb, pcxGrammarArb, textGrammarArb);
  return bytes.map((b): HostileInput => ({ format, family: 'grammar', bytes: b }));
}

// ---------------------------------------------------------------------------
// (c) mutated fixture files: exactly one mutation per run
// ---------------------------------------------------------------------------

const mutationArb = fc.oneof(
  fc.record({
    kind: fc.constant('bytes' as const),
    writes: fc.array(
      fc.record({ pos: fc.integer({ min: 0, max: 0x7fffffff }), value: fc.integer({ min: 0, max: 255 }) }),
      { minLength: 1, maxLength: 64 },
    ),
  }),
  fc.record({
    kind: fc.constant('truncate' as const),
    pos: fc.integer({ min: 0, max: 0x7fffffff }),
  }),
);

export function mutatedFixtureArb(format: HostileFormat): fc.Arbitrary<HostileInput> {
  return fc.tuple(fixtureFor(format), mutationArb).map(([fixture, mutation]): HostileInput => {
    if (fixture.length === 0) return { format, family: 'mutated', bytes: fixture.slice() };
    if (mutation.kind === 'truncate') {
      // Truncation to a random length 0..len-1.
      return { format, family: 'mutated', bytes: fixture.slice(0, mutation.pos % fixture.length) };
    }
    const bytes = fixture.slice();
    for (const w of mutation.writes) bytes[w.pos % bytes.length] = w.value;
    return { format, family: 'mutated', bytes };
  });
}

// ---------------------------------------------------------------------------
// (d) fuzzed headers drawn from boundary values
// ---------------------------------------------------------------------------

type HeaderPatch = (b: Uint8Array) => void;

const pcxPatchArb: fc.Arbitrary<HeaderPatch> = fc.oneof(
  fc.tuple(u16Arb, u16Arb).map(([w, h]): HeaderPatch => (b) => {
    setU16(b, 4, 0);
    setU16(b, 6, 0);
    setU16(b, 8, w);
    setU16(b, 10, h);
  }),
  u16Arb.map((v): HeaderPatch => (b) => setU16(b, 66, v)),
  fc.tuple(fc.constantFrom(0, 1, 2, 4, 8, 16, 255), fc.constantFrom(0, 1, 2, 3, 4, 5, 255)).map(
    ([bits, planes]): HeaderPatch =>
      (b) => {
        if (b.length > 65) {
          b[3] = bits;
          b[65] = planes;
        }
      },
  ),
  fc.tuple(u16Arb, u16Arb, u16Arb).map(([w, h, bpl]): HeaderPatch => (b) => {
    setU16(b, 8, w);
    setU16(b, 10, h);
    setU16(b, 66, bpl);
  }),
);

const dbfPatchArb: fc.Arbitrary<HeaderPatch> = fc.oneof(
  u32Arb.map((v): HeaderPatch => (b) => setU32(b, 4, v)),
  u16Arb.map((v): HeaderPatch => (b) => setU16(b, 8, v)),
  u16Arb.map((v): HeaderPatch => (b) => setU16(b, 10, v)),
  fc.tuple(u32Arb, u16Arb, u16Arb).map(([n, hl, rl]): HeaderPatch => (b) => {
    setU32(b, 4, n);
    setU16(b, 8, hl);
    setU16(b, 10, rl);
  }),
  fc.constantFrom(0x00, 0x02, 0x03, 0x30, 0x83, 0x8b, 0xf5, 0xff).map((v): HeaderPatch => (b) => {
    if (b.length > 0) b[0] = v;
  }),
);

const wsPatchArb: fc.Arbitrary<HeaderPatch> = fc
  .array(fc.record({ pos: fc.integer({ min: 0, max: 15 }), value: fc.constantFrom(0x00, 0x02, 0x0d, 0x1a, 0x2e, 0x7f, 0x8d, 0xff) }), {
    minLength: 1,
    maxLength: 4,
  })
  .map((ws): HeaderPatch => (b) => {
    for (const w of ws) if (w.pos < b.length) b[w.pos] = w.value;
  });

/** Text has no header: patch up to 4 of the first 16 bytes with EOF, CR, LF, NUL, DEL, tab and high bytes. */
const textPatchArb: fc.Arbitrary<HeaderPatch> = fc
  .array(
    fc.record({
      pos: fc.integer({ min: 0, max: 15 }),
      value: fc.constantFrom(0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x1a, 0x20, 0x7f, 0x80, 0xff),
    }),
    { minLength: 1, maxLength: 4 },
  )
  .map((ws): HeaderPatch => (b) => {
    for (const w of ws) if (w.pos < b.length) b[w.pos] = w.value;
  });

/** Valid fixtures with header fields replaced by boundary values (PCX 65,535 sides, dBase count 4,294,967,295, ...). */
export function fuzzedHeaderArb(format: HostileFormat): fc.Arbitrary<HostileInput> {
  const patched = (
    fixture: fc.Arbitrary<Uint8Array>,
    patch: fc.Arbitrary<HeaderPatch>,
  ): fc.Arbitrary<Uint8Array> =>
    fc.tuple(fixture, patch).map(([f, p]) => {
      const b = f.slice();
      p(b);
      return b;
    });
  const bytes: fc.Arbitrary<Uint8Array> =
    format === 'wordstar'
      ? patched(wsFileArb, wsPatchArb)
      : format === 'dbase'
        ? patched(dbfFileArb, dbfPatchArb)
        : format === 'pcx'
          ? patched(pcxFileArb, pcxPatchArb)
          : format === 'text'
            ? patched(plainTextBytesArb, textPatchArb)
            : fc.oneof(
                patched(wsFileArb, wsPatchArb),
                patched(dbfFileArb, dbfPatchArb),
                patched(pcxFileArb, pcxPatchArb),
                patched(plainTextBytesArb, textPatchArb),
              );
  return bytes.map((b): HostileInput => ({ format, family: 'fuzzed-header', bytes: b }));
}

// ---------------------------------------------------------------------------
// All families
// ---------------------------------------------------------------------------

/** Mixed hostile inputs for one format; the 2 MiB random family is a small minority. */
export function hostileInputArb(format: HostileFormat): fc.Arbitrary<HostileInput> {
  return fc.oneof(
    { weight: 3, arbitrary: randomBytesArb(format) },
    { weight: 4, arbitrary: grammarBytesArb(format) },
    { weight: 4, arbitrary: mutatedFixtureArb(format) },
    { weight: 4, arbitrary: fuzzedHeaderArb(format) },
  );
}
