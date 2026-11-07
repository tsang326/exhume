import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import { numRuns } from '../../test-support/runs';
import { pcxSourceArb, expandContent } from '../../test-support/formats/arbitraries';
import { checkResultInvariants } from '../../test-support/formats/invariants';
import { decodePng, encodePcx } from '../../test-support/formats';
import type { PcxSource } from '../../test-support/formats/pcx-encoder';
import { convertPcx } from './pcx';
import { TEMPLATES, fill } from './templates';

// Fixed 16-colour EGA palette, written out independently of the converter (version 3 files).
const EGA = [
  0x000000, 0x0000aa, 0x00aa00, 0x00aaaa, 0xaa0000, 0xaa00aa, 0xaa5500, 0xaaaaaa,
  0x555555, 0x5555ff, 0x55ff55, 0x55ffff, 0xff5555, 0xff55ff, 0xffff55, 0xffffff,
];

/** Expected RGBA computed from the source description alone. */
function expectedRgba(src: PcxSource): Uint8Array {
  const n = src.width * src.height;
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    let r = 0;
    let g = 0;
    let b = 0;
    if (src.mode === 'rgb24') {
      const rgb = src.rgb as Uint8Array;
      r = rgb[i * 3] as number;
      g = rgb[i * 3 + 1] as number;
      b = rgb[i * 3 + 2] as number;
    } else {
      const v = (src.indices as Uint8Array)[i] as number;
      if (src.mode === 'mono') {
        r = g = b = v === 0 ? 0 : 255;
      } else if (src.mode === 'indexed256') {
        if (src.palette !== undefined) {
          r = src.palette[v * 3] as number;
          g = src.palette[v * 3 + 1] as number;
          b = src.palette[v * 3 + 2] as number;
        } else {
          r = g = b = v; // encoder default: entry i is (i, i, i)
        }
      } else if (src.version === 3) {
        const c = EGA[v] as number;
        r = (c >> 16) & 255;
        g = (c >> 8) & 255;
        b = c & 255;
      } else if (src.palette !== undefined) {
        r = src.palette[v * 3] as number;
        g = src.palette[v * 3 + 1] as number;
        b = src.palette[v * 3 + 2] as number;
      } // encoder default header palette is 48 zero bytes: black
    }
    out[i * 4] = r;
    out[i * 4 + 1] = g;
    out[i * 4 + 2] = b;
    out[i * 4 + 3] = 255;
  }
  return out;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** True when the conversion succeeds cleanly and the decoded PNG equals the expectation. */
function matches(file: Uint8Array, src: PcxSource, expected: Uint8Array): boolean {
  const result = convertPcx(file);
  if (!result.ok) return false;
  if (result.warnings.length !== 0) return false;
  if (checkResultInvariants(result).length !== 0) return false;
  const png = decodePng(result.output);
  return png.width === src.width && png.height === src.height && sameBytes(png.rgba, expected);
}

/** Single-colour images with even widths and enough rows that 63-byte runs span scanlines. */
const flatSourceArb: fc.Arbitrary<PcxSource> = fc
  .record({
    mode: fc.constantFrom('mono', 'indexed256', 'rgb24', 'packed16', 'planar16'),
    halfWidth: fc.integer({ min: 1, max: 16 }),
    height: fc.integer({ min: 16, max: 64 }),
    value: fc.integer({ min: 0, max: 255 }),
    seed: fc.integer({ min: 0, max: 0xffffffff }),
    version: fc.constantFrom(3, 5),
    explicitPalette: fc.boolean(),
  })
  .map(({ mode, halfWidth, height, value, seed, version, explicitPalette }): PcxSource => {
    const width = halfWidth * 2;
    const n = width * height;
    const src: PcxSource = { mode, width, height, version };
    if (mode === 'rgb24') {
      const rgb = new Uint8Array(n * 3);
      for (let i = 0; i < n; i++) rgb.set([value, 255 - value, value >> 1], i * 3);
      src.rgb = rgb;
    } else {
      const colours = mode === 'mono' ? 2 : mode === 'indexed256' ? 256 : 16;
      src.indices = new Uint8Array(n).fill(value % colours);
      if (explicitPalette) src.palette = expandContent(seed, mode === 'indexed256' ? 768 : 48);
    }
    return src;
  });

describe('convertPcx round trip', () => {
  // Feature: format-resurrection, Property 28: PCX to PNG round trip
  it('decodes to the pixels described by the source, with no warnings', () => {
    // **Validates: Requirements 9.9, 10.6, 10.7, 10.8, 10.11, 10.13, 10.16, 13.3**
    fc.assert(
      fc.property(pcxSourceArb(64), (src) => matches(encodePcx(src), src, expectedRgba(src))),
      { numRuns: numRuns(100) },
    );
  });

  it('keeps runs that cross scanlines intact on single-colour images', () => {
    // **Validates: Requirements 10.6, 10.7, 10.8, 10.11, 10.13, 10.16**
    fc.assert(
      fc.property(flatSourceArb, (src) => matches(encodePcx(src), src, expectedRgba(src))),
      { numRuns: numRuns(100) },
    );
  });

  it('ignores DPI and screen-size header bytes', () => {
    // **Validates: Requirements 9.9, 10.16**
    fc.assert(
      fc.property(
        pcxSourceArb(64),
        fc.uint8Array({ minLength: 4, maxLength: 4 }),
        fc.uint8Array({ minLength: 4, maxLength: 4 }),
        (src, dpi, screen) => {
          const file = encodePcx(src);
          file.set(dpi, 12);
          file.set(screen, 70);
          return matches(file, src, expectedRgba(src));
        },
      ),
      { numRuns: numRuns(100) },
    );
  });

  it('ignores padding bytes in each plane', () => {
    // **Validates: Requirements 10.6, 10.7, 10.8, 10.11, 10.13**
    fc.assert(
      fc.property(pcxSourceArb(64), (src) => {
        const expected = expectedRgba(src);
        const unpadded = { ...src, padding: 0 };
        return matches(encodePcx(unpadded), unpadded, expected) && matches(encodePcx(src), src, expected);
      }),
      { numRuns: numRuns(100) },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 29: palette selection and truncation
// ---------------------------------------------------------------------------

const MISSING = 'pcx-palette-missing';
const TRUNCATED = 'pcx-data-truncated';

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** Pixels of a decoded PNG compared with expected RGBA over the given row range. */
function rowsEqual(actual: Uint8Array, expected: Uint8Array, width: number, from: number, to: number): boolean {
  const row = width * 4;
  for (let i = from * row; i < to * row; i++) if (actual[i] !== expected[i]) return false;
  return true;
}

/** Small 256-colour source with a full random trailer palette. */
const indexed256Arb: fc.Arbitrary<PcxSource> = fc
  .record({
    width: fc.integer({ min: 1, max: 16 }),
    height: fc.integer({ min: 1, max: 16 }),
    seed: fc.integer({ min: 0, max: 0xffffffff }),
    version: fc.constantFrom(0, 2, 3, 4, 5),
  })
  .map(({ width, height, seed, version }): PcxSource => ({
    mode: 'indexed256',
    width,
    height,
    version,
    indices: expandContent(seed, width * height),
    palette: expandContent(seed + 1, 768),
  }));

/** Gives every palette-bearing mode an explicit random palette. */
function withPalette(src: PcxSource, seed: number): PcxSource {
  if (src.mode === 'indexed256') return { ...src, palette: expandContent(seed, 768) };
  if (src.mode === 'planar16' || src.mode === 'packed16') return { ...src, palette: expandContent(seed, 48) };
  return src;
}

describe('convertPcx palette selection and truncation', () => {
  // Feature: format-resurrection, Property 29: Palette selection
  it('uses the 769-byte trailer palette of 256-colour images', () => {
    // **Validates: Requirements 10.4**
    fc.assert(
      fc.property(indexed256Arb, (src) => matches(encodePcx(src), src, expectedRgba(src))),
      { numRuns: numRuns(100) },
    );
  });

  it('falls back to grayscale with one palette-missing warning when the trailer is unusable', () => {
    // **Validates: Requirements 10.9**
    fc.assert(
      fc.property(
        indexed256Arb,
        fc.constantFrom('drop', 'marker'),
        fc.integer({ min: 1, max: 769 }),
        (src, variant, dropped) => {
          const full = encodePcx(src);
          let file: Uint8Array;
          if (variant === 'drop') {
            file = full.slice(0, full.length - dropped);
          } else {
            file = full.slice();
            file[full.length - 769] = 0x0c + dropped; // 0x0d..0x30e wraps harmlessly, never 0x0c
            if (file[full.length - 769] === 0x0c) return true;
          }
          const trailerStart = file.length - 769;
          if (trailerStart >= 128 && file[trailerStart] === 0x0c) return true; // data byte looks like a marker
          const result = convertPcx(file);
          if (!result.ok) return false;
          if (checkResultInvariants(result).length !== 0) return false;
          if (result.warnings.length !== 1) return false;
          const w = result.warnings[0];
          if (w === undefined || w.code !== MISSING || w.message !== TEMPLATES.pcxPaletteMissing) return false;
          const png = decodePng(result.output);
          const gray = { ...src, palette: undefined };
          return png.width === src.width && png.height === src.height && sameBytes(png.rgba, expectedRgba(gray));
        },
      ),
      { numRuns: numRuns(100) },
    );
  });

  it('bounds the RLE stream at a trailer the stream would otherwise overlap', () => {
    // **Validates: Requirements 10.4, 10.9**
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 8 }),
        fc.integer({ min: 0, max: 0xffffffff }),
        fc.integer({ min: 0, max: 15 }),
        (height, seed, kSeed) => {
          const width = 2;
          const total = width * height; // one plane, bytesPerLine 2
          const k = kSeed % total; // literal bytes before the trailer; the stream needs total
          const header = encodePcx({
            mode: 'indexed256',
            width,
            height,
            indices: new Uint8Array(total),
          }).slice(0, 128);
          const literals = expandContent(seed, k).map((b) => b % 0xc0);
          const palette = expandContent(seed + 1, 768);
          const trailer = concatBytes(Uint8Array.of(0x0c), palette);
          const file = concatBytes(header, literals, trailer);

          const result = convertPcx(file);
          if (!result.ok) return false;
          if (checkResultInvariants(result).length !== 0) return false;
          const completeRows = Math.floor(k / width);
          if (result.warnings.length !== 1) return false;
          const w = result.warnings[0];
          if (w === undefined || w.code !== TRUNCATED) return false;
          if (w.message !== fill(TEMPLATES.pcxDataTruncated, completeRows)) return false;

          const indices = new Uint8Array(total);
          indices.set(literals, 0);
          const expected = expectedRgba({ mode: 'indexed256', width, height, indices, palette });
          const png = decodePng(result.output);
          return png.width === width && png.height === height && sameBytes(png.rgba, expected);
        },
      ),
      { numRuns: numRuns(100) },
    );
  });

  it('uses the fixed EGA palette for version 3 16-colour files and the header palette otherwise', () => {
    // **Validates: Requirements 10.10, 10.12**
    fc.assert(
      fc.property(
        pcxSourceArb(32),
        fc.constantFrom(0, 2, 3, 4, 5),
        fc.integer({ min: 0, max: 0xffffffff }),
        (src0, version, seed) => {
          const src = { ...withPalette(src0, seed), version };
          return matches(encodePcx(src), src, expectedRgba(src));
        },
      ),
      { numRuns: numRuns(100) },
    );
  });

  it('zero-fills truncated pixel data and reports the complete rows', () => {
    // **Validates: Requirements 10.4, 10.5, 10.9, 10.10**
    fc.assert(
      fc.property(
        pcxSourceArb(32),
        fc.integer({ min: 0, max: 0x3fffffff }),
        fc.boolean(),
        fc.integer({ min: 0, max: 0xffffffff }),
        (src0, cutSeed, dropTrailer, palSeed) => {
          const src = withPalette(src0, palSeed);
          const full = encodePcx(src);
          const is256 = src.mode === 'indexed256';
          const dataEnd = is256 ? full.length - 769 : full.length;
          const cut = 128 + (cutSeed % (dataEnd - 128 + 1));
          const file =
            is256 && !dropTrailer ? concatBytes(full.slice(0, cut), full.slice(dataEnd)) : full.slice(0, cut);
          if (is256 && dropTrailer) {
            const ts = file.length - 769;
            if (ts >= 128 && file[ts] === 0x0c) return true; // data byte looks like a marker
          }

          // Independent reference decode of the bytes before `cut`.
          const planes = file[65] as number;
          const stride = planes * ((file[66] as number) + (file[67] as number) * 256);
          const total = stride * src.height;
          let filled = 0;
          for (let p = 128; filled < total && p < cut; ) {
            const b = file[p++] as number;
            if (b >= 0xc0) {
              if (p >= cut) break;
              p++;
              filled = Math.min(filled + (b & 0x3f), total);
            } else {
              filled++;
            }
          }
          const truncated = filled < total;
          const completeRows = Math.floor(filled / stride);

          const result = convertPcx(file);
          if (!result.ok) return false;
          if (checkResultInvariants(result).length !== 0) return false;
          const codes = result.warnings.map((w) => w.code).sort();
          const wantCodes: string[] = [];
          if (truncated) wantCodes.push(TRUNCATED);
          if (is256 && dropTrailer) wantCodes.push(MISSING);
          if (codes.join() !== wantCodes.sort().join()) return false;
          if (truncated) {
            if (completeRows < 0 || completeRows > src.height - 1) return false;
            const w = result.warnings.find((x) => x.code === TRUNCATED);
            if (w === undefined || w.message !== fill(TEMPLATES.pcxDataTruncated, completeRows)) return false;
          }

          const effective: PcxSource = is256 && dropTrailer ? { ...src, palette: undefined } : src;
          const zeroed: PcxSource =
            src.mode === 'rgb24'
              ? { ...effective, rgb: new Uint8Array(src.width * src.height * 3) }
              : { ...effective, indices: new Uint8Array(src.width * src.height) };
          const wantRows = expectedRgba(effective);
          const wantZero = expectedRgba(zeroed);
          const png = decodePng(result.output);
          if (png.width !== src.width || png.height !== src.height) return false;
          if (!rowsEqual(png.rgba, wantRows, src.width, 0, completeRows)) return false;
          const firstEmpty = Math.ceil(filled / stride);
          return rowsEqual(png.rgba, wantZero, src.width, firstEmpty, src.height);
        },
      ),
      { numRuns: numRuns(100) },
    );
  });

  it('counts a lone final run byte as truncation', () => {
    // **Validates: Requirements 10.5**
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 0, max: 5 }),
        fc.integer({ min: 0xc0, max: 0xff }),
        (height, kSeed, run) => {
          const k = kSeed % height; // complete literal rows before the lone run byte
          const header = encodePcx({
            mode: 'mono',
            width: 8,
            height,
            indices: new Uint8Array(8 * height),
          }).slice(0, 128);
          const file = concatBytes(header, new Uint8Array(k * 2).fill(0x55), Uint8Array.of(run));
          const result = convertPcx(file);
          if (!result.ok || result.warnings.length !== 1) return false;
          const w = result.warnings[0];
          return w !== undefined && w.code === TRUNCATED && w.message === fill(TEMPLATES.pcxDataTruncated, k);
        },
      ),
      { numRuns: numRuns(100) },
    );
  });
});
