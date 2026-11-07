import { describe, expect, it } from 'vitest';
import { timed } from '../../test-support/timed';
import { decodePng, encodePcx } from '../../test-support/formats';
import { CONVERT_TIME_BUDGET_MS, MAX_CONVERT_INPUT_BYTES, MAX_PNG_BYTES } from './limits';
import { convertPcx } from './pcx';

// Largest accepted PCX images: 2048x2048, 4096x1024 and 1024x4096 (4,194,304 pixels each).
// Fixtures are built outside the timer; only the convertPcx call is timed.

const SIZES: Array<[number, number]> = [
  [2048, 2048],
  [4096, 1024],
  [1024, 4096],
];

/** Flat 64 by 64 colour blocks: low entropy, but not trivial. */
function rgbAt(x: number, y: number): [number, number, number] {
  const bx = x >> 6;
  const by = y >> 6;
  return [(bx * 37 + by * 11) & 255, (by * 53 + bx) & 255, (bx * 7 + by * 29) & 255];
}

function indexAt(x: number, y: number): number {
  return ((x >> 6) + (y >> 6) * 5) & 255;
}

function buildRgb(width: number, height: number): Uint8Array {
  const rgb = new Uint8Array(width * height * 3);
  let o = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = rgbAt(x, y);
      rgb[o++] = r;
      rgb[o++] = g;
      rgb[o++] = b;
    }
  }
  return rgb;
}

function buildIndices(width: number, height: number): Uint8Array {
  const idx = new Uint8Array(width * height);
  let o = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) idx[o++] = indexAt(x, y);
  return idx;
}

function spots(width: number, height: number): Array<[number, number]> {
  return [
    [0, 0],
    [width - 1, 0],
    [63, 63],
    [64, 64],
    [width >> 1, height >> 1],
    [width - 1, height - 1],
  ];
}

function run(mode: 'rgb24' | 'indexed256', width: number, height: number): void {
  const file =
    mode === 'rgb24'
      ? encodePcx({ mode, width, height, rgb: buildRgb(width, height) })
      : encodePcx({ mode, width, height, indices: buildIndices(width, height) });
  expect(file.length).toBeLessThanOrEqual(MAX_CONVERT_INPUT_BYTES);

  let elapsed = 0;
  const result = timed(() => {
    const t0 = performance.now();
    const r = convertPcx(file);
    elapsed = performance.now() - t0;
    return r;
  }, CONVERT_TIME_BUDGET_MS);
  console.info(
    `convertPcx ${mode} ${width}x${height}: ${elapsed.toFixed(1)} ms (input ${file.length} bytes)`,
  );

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.warnings).toEqual([]);
  expect(result.mime).toBe('image/png');
  expect(result.output.length).toBeLessThanOrEqual(MAX_PNG_BYTES);
  const png = result.output as Uint8Array;
  if (width === 1024 && height === 4096) expect(png.length).toBe(MAX_PNG_BYTES);

  const decoded = decodePng(png);
  expect(decoded.width).toBe(width);
  expect(decoded.height).toBe(height);
  for (const [x, y] of spots(width, height)) {
    const at = (y * width + x) * 4;
    const expected = mode === 'rgb24' ? rgbAt(x, y) : [indexAt(x, y), indexAt(x, y), indexAt(x, y)];
    expect(Array.from(decoded.rgba.subarray(at, at + 4))).toEqual([...expected, 255]);
  }
}

describe('largest accepted PCX images convert within the time budget', () => {
  for (const [w, h] of SIZES) {
    it(`24-bit ${w}x${h}`, () => run('rgb24', w, h), 60_000);
  }
  for (const [w, h] of SIZES) {
    it(`8-bit indexed ${w}x${h}`, () => run('indexed256', w, h), 60_000);
  }
});
