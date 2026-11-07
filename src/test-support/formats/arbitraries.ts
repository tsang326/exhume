// fast-check arbitraries for the format fixtures (test-only).
// NOT exported from ./index.ts. They only PRODUCE inputs: no converter calls, no timed().

import * as fc from 'fast-check';

import { PCX_MAX_PADDING } from './pcx-encoder';
import type { DbfFieldSpec, DbfTable } from './dbase-writer';
import type { PcxMode, PcxSource } from './pcx-encoder';
import type { WsParagraph, WsSpan, WsStyle } from './wordstar-writer';

/** Deterministic mulberry32 expansion of (seed, length) into bytes. */
export function expandContent(seed: number, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let a = seed >>> 0;
  for (let i = 0; i < length; i++) {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    out[i] = ((t ^ (t >>> 14)) >>> 0) & 0xff;
  }
  return out;
}

export interface ContentSpec {
  seed: number;
  length: number;
}

/** `{ seed, length }` for large inputs; expand with `expandContent`. */
export function contentSpecArb(minLength: number, maxLength: number): fc.Arbitrary<ContentSpec> {
  return fc.record({
    seed: fc.integer({ min: 0, max: 0xffffffff }),
    length: fc.integer({ min: minLength, max: maxLength }),
  });
}

const asciiBytes = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));

// ---------------------------------------------------------------------------
// RGBA images
// ---------------------------------------------------------------------------

export interface RgbaFixture {
  width: number;
  height: number;
  rgba: Uint8Array;
}

/** RGBA image with sides 1..maxWidth by 1..maxHeight, content expanded from a seed. */
export function rgbaImageArb(maxWidth = 64, maxHeight = 64): fc.Arbitrary<RgbaFixture> {
  return fc
    .record({
      width: fc.integer({ min: 1, max: maxWidth }),
      height: fc.integer({ min: 1, max: maxHeight }),
      seed: fc.integer({ min: 0, max: 0xffffffff }),
      flat: fc.boolean(),
    })
    .map(({ width, height, seed, flat }) => {
      const rgba = expandContent(seed, width * height * 4);
      // Flat images give long runs and repeated bytes.
      if (flat) for (let i = 4; i < rgba.length; i++) rgba[i] = rgba[i % 4] as number;
      return { width, height, rgba };
    });
}

/** Up to 300 by 100, for stored-block boundary checks. */
export const rgbaBlockImageArb: fc.Arbitrary<RgbaFixture> = rgbaImageArb(300, 100);

// ---------------------------------------------------------------------------
// WordStar
// ---------------------------------------------------------------------------

const STYLES: WsStyle[] = ['bold', 'underline', 'italic'];
const wsCharArb = fc.constantFrom(...'abcxyzABCXYZ019 .,;:!?-_*#<>[]()`~\\|'.split(''));

export const wsSpanArb: fc.Arbitrary<WsSpan> = fc.record({
  text: fc.array(wsCharArb, { minLength: 0, maxLength: 20 }).map((c) => c.join('')),
  styles: fc.subarray(STYLES),
});

export const wsParagraphArb: fc.Arbitrary<WsParagraph> = fc.record(
  {
    spans: fc.array(wsSpanArb, { minLength: 0, maxLength: 5 }),
    wrapAt: fc.integer({ min: 1, max: 80 }),
  },
  { requiredKeys: ['spans'] },
);

export const wsParagraphsArb: fc.Arbitrary<WsParagraph[]> = fc.array(wsParagraphArb, {
  minLength: 0,
  maxLength: 12,
});

// ---------------------------------------------------------------------------
// dBase
// ---------------------------------------------------------------------------

const padRight = (s: string, n: number): string => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length));
const padLeft = (s: string, n: number): string => (s.length >= n ? s.slice(-n) : ' '.repeat(n - s.length) + s);

const fieldNameArb = fc.integer({ min: 0, max: 9999 }).map((n) => `F${n}`);

const dateOkArb = fc
  .record({
    y: fc.integer({ min: 1, max: 9999 }),
    m: fc.integer({ min: 1, max: 12 }),
    d: fc.integer({ min: 1, max: 28 }),
  })
  .map(({ y, m, d }) => `${String(y).padStart(4, '0')}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`);

const dateBadArb = fc.constantFrom('20240230', '20231301', '00000101', '2024-1-1', 'ABCDEFGH', '20240001', '1999023 ', '19000229');

const numberOkArb = fc
  .record({ neg: fc.boolean(), int: fc.integer({ min: 0, max: 99999 }), frac: fc.option(fc.integer({ min: 0, max: 99 }), { nil: undefined }) })
  .map(({ neg, int, frac }) => `${neg ? '-' : ''}${int}${frac === undefined ? '' : `.${String(frac).padStart(2, '0')}`}`);

const numberBadArb = fc.constantFrom('1.2.3', '--5', '1e5', 'abc', '12-', '+', '.', '- 5', '1 2', '0x10');

const logicalOkArb = fc.constantFrom('T', 't', 'Y', 'y', 'F', 'f', 'N', 'n', '?', ' ');
const logicalBadArb = fc.constantFrom('X', '1', '0', 'Z', '*', '-');

const textArb = fc.array(fc.constantFrom(...'abcXYZ 019,"\n.;-'.split('')), { minLength: 0, maxLength: 12 }).map((c) => c.join(''));
const formulaTextArb = fc
  .tuple(fc.constantFrom('=', '+', '-', '@'), textArb)
  .map(([p, t]) => p + t);

type FieldKind = 'C' | 'N' | 'D' | 'L';

function cellArb(kind: FieldKind, length: number, repair: boolean): fc.Arbitrary<Uint8Array> {
  let text: fc.Arbitrary<string>;
  switch (kind) {
    case 'C':
      text = repair ? fc.oneof(formulaTextArb, textArb) : textArb;
      break;
    case 'N':
      text = (repair ? fc.oneof(numberBadArb, numberOkArb) : numberOkArb).map((s) => padLeft(s, length));
      break;
    case 'D':
      text = repair ? fc.oneof(dateBadArb, dateOkArb) : dateOkArb;
      break;
    default:
      text = repair ? fc.oneof(logicalBadArb, logicalOkArb) : logicalOkArb;
  }
  return text.map((s) => asciiBytes(padRight(s, length)));
}

function tableArb(repair: boolean, maxRecords: number): fc.Arbitrary<DbfTable> {
  const fieldArb: fc.Arbitrary<DbfFieldSpec> = fc
    .tuple(fieldNameArb, fc.constantFrom<FieldKind>('C', 'N', 'D', 'L'), fc.integer({ min: 8, max: 20 }))
    .map(([name, type, len]) => ({
      name,
      type,
      length: type === 'D' ? 8 : type === 'L' ? 1 : len,
      decimals: type === 'N' ? 2 : 0,
    }));
  return fc.array(fieldArb, { minLength: 1, maxLength: 6 }).chain((fields) =>
    fc
      .array(
        fc.record({
          deleted: fc.boolean(),
          values: fc.tuple(
            ...fields.map((f) => cellArb(f.type as FieldKind, f.length, repair)),
          ) as unknown as fc.Arbitrary<Uint8Array[]>,
        }),
        { minLength: 0, maxLength: maxRecords },
      )
      .map((records) => ({ fields, records })),
  );
}

/** Tables whose cells are all valid for their field type. */
export const dbfCleanTableArb: fc.Arbitrary<DbfTable> = tableArb(false, 20);

/** Tables mixing invalid numbers, dates and logicals with formula-prefix text. */
export const dbfNeedsRepairTableArb: fc.Arbitrary<DbfTable> = tableArb(true, 20);

export const dbfTableArb: fc.Arbitrary<DbfTable> = fc.oneof(dbfCleanTableArb, dbfNeedsRepairTableArb);

// ---------------------------------------------------------------------------
// PCX
// ---------------------------------------------------------------------------

const PCX_MODES: PcxMode[] = ['mono', 'planar16', 'packed16', 'indexed256', 'rgb24'];
const MODE_COLOURS: Record<PcxMode, number> = { mono: 2, planar16: 16, packed16: 16, indexed256: 256, rgb24: 0 };
const MODE_PALETTE: Record<PcxMode, number> = { mono: 48, planar16: 48, packed16: 48, indexed256: 768, rgb24: 0 };

/** PCX sources of 1..maxSide pixels per side in all five modes. */
export function pcxSourceArb(maxSide = 64): fc.Arbitrary<PcxSource> {
  return fc
    .record({
      mode: fc.constantFrom(...PCX_MODES),
      width: fc.integer({ min: 1, max: maxSide }),
      height: fc.integer({ min: 1, max: maxSide }),
      seed: fc.integer({ min: 0, max: 0xffffffff }),
      padding: fc.integer({ min: 0, max: PCX_MAX_PADDING }),
      version: fc.constantFrom(3, 5),
      flat: fc.boolean(),
      explicitPalette: fc.boolean(),
    })
    .map(({ mode, width, height, seed, padding, version, flat, explicitPalette }): PcxSource => {
      const pixels = width * height;
      const source: PcxSource = { mode, width, height, version, padding };
      const raw = expandContent(seed, pixels * (mode === 'rgb24' ? 3 : 1));
      if (flat) for (let i = 1; i < raw.length; i++) if (i % 7 !== 0) raw[i] = raw[i - 1] as number;
      if (mode === 'rgb24') {
        source.rgb = raw;
      } else {
        const colours = MODE_COLOURS[mode];
        for (let i = 0; i < raw.length; i++) raw[i] = (raw[i] as number) % colours;
        source.indices = raw;
        if (explicitPalette) source.palette = expandContent(seed ^ 0x5bd1e995, MODE_PALETTE[mode]);
      }
      return source;
    });
}

export const pcxSourceSmallArb: fc.Arbitrary<PcxSource> = pcxSourceArb(64);

// ---------------------------------------------------------------------------
// Plain text
// ---------------------------------------------------------------------------

const PLAIN_TEXT_TOKENS: number[][] = [
  [0x0d, 0x0a], [0x0d], [0x0a], [0x09], [0x0c], [0x20], [0x1a], [0x00], [0x01], [0x1f], [0x7f],
  [0x80], [0xc4], [0xe9], [0xff], [0x41, 0x42, 0x43], [0x68, 0x65, 0x6c, 0x6c, 0x6f],
];

/** Small DOS-style text files: printable ASCII, line endings, tabs, high CP437 bytes, and the odd control or EOF byte. */
export const plainTextBytesArb: fc.Arbitrary<Uint8Array> = fc
  .array(
    fc.oneof(
      { weight: 4, arbitrary: fc.integer({ min: 0x20, max: 0x7e }).map((n) => [n]) },
      { weight: 3, arbitrary: fc.constantFrom(...PLAIN_TEXT_TOKENS) },
      { weight: 1, arbitrary: fc.integer({ min: 0, max: 255 }).map((n) => [n]) },
    ),
    { minLength: 0, maxLength: 300 },
  )
  .map((tokens) => Uint8Array.from(tokens.flat()));
