// Independent recompute of MAX_PNG_BYTES. Every constant is a literal here on
// purpose: nothing below is derived from limits.ts except the values under test.
// Validates: Requirements 1.17, 11.9, 11.16, 11.17, 14.16

import { describe, expect, it } from 'vitest';
import { timed } from '../../test-support/timed';
import { encodePng } from './index';
import { CONVERT_TIME_BUDGET_MS, MAX_PNG_BYTES, pngBytesForFiltered } from './limits';

const PIXEL_CAP = 4_194_304;
const DIM_CAP = 4_096;
const BLOCK = 65_535;
const SIGNATURE = 8;
const CHUNK = 12; // length + type + CRC
const IHDR_DATA = 13;
const BLOCK_OVERHEAD = 5;
const ZLIB = 6;

/** First-principles PNG size for a filtered (scanline + filter byte) length. */
function pngSize(filtered: number): number {
  return (
    SIGNATURE +
    (CHUNK + IHDR_DATA) +
    (CHUNK + ZLIB + filtered + BLOCK_OVERHEAD * Math.ceil(filtered / BLOCK)) +
    CHUNK
  );
}

function shapeSize(width: number, height: number): number {
  return pngSize(height * (1 + 4 * width));
}

function image(width: number, height: number) {
  return { width, height, rgba: new Uint8Array(width * height * 4) };
}

describe('MAX_PNG_BYTES independent recompute', () => {
  it('worst case over every accepted shape is 16,782,660 and equals MAX_PNG_BYTES', () => {
    // Per height, size grows with width, so the best width is the largest allowed.
    let best = 0;
    let bestShape = '';
    for (let h = 1; h <= DIM_CAP; h++) {
      const w = Math.min(DIM_CAP, Math.floor(PIXEL_CAP / h));
      const s = shapeSize(w, h);
      if (s > best) {
        best = s;
        bestShape = `${w}x${h}`;
      }
    }
    expect(best).toBe(16_782_660);
    expect(bestShape).toBe('1024x4096');

    // Exhaustive cross-check over every (w, h) with w*h <= cap.
    let exhaustive = 0;
    for (let h = 1; h <= DIM_CAP; h++) {
      const maxW = Math.min(DIM_CAP, Math.floor(PIXEL_CAP / h));
      for (let w = 1; w <= maxW; w++) {
        const s = shapeSize(w, h);
        if (s > exhaustive) exhaustive = s;
      }
    }
    expect(exhaustive).toBe(best);
    expect(MAX_PNG_BYTES).toBe(16_782_660);
    expect(MAX_PNG_BYTES).toBe(best);
  });

  it('pngBytesForFiltered agrees with the test formula', () => {
    const worst = 4_096 * (1 + 4 * 1_024);
    for (const f of [1, 2, 65_534, 65_535, 65_536, 131_070, 131_071, worst]) {
      expect(pngBytesForFiltered(f)).toBe(pngSize(f));
    }
  });

  it('encodes 1024x4096 to exactly MAX_PNG_BYTES', () => {
    const img = image(1024, 4096);
    const r = timed(() => encodePng(img), CONVERT_TIME_BUDGET_MS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.output.length).toBe(MAX_PNG_BYTES);
    expect(r.output.length).toBe(shapeSize(1024, 4096));
  });

  it.each([
    [4096, 1024],
    [2048, 2048],
  ])('encodes %ix%i within MAX_PNG_BYTES at the first-principles size', (w, h) => {
    const img = image(w, h);
    const r = timed(() => encodePng(img), CONVERT_TIME_BUDGET_MS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.output.length).toBeLessThanOrEqual(MAX_PNG_BYTES);
    expect(r.output.length).toBe(shapeSize(w, h));
  });
});
