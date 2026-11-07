// Example tests for convertPcx (Requirements 9.3, 10.6, 10.7, 10.8, 10.11, 10.12, 14.10).

import { describe, expect, it } from 'vitest';
import { decodePng, encodePcx } from '../../test-support/formats';
import { checkResultInvariants } from '../../test-support/formats/invariants';
import { convertPcx } from './pcx';
import { TEMPLATES, fill } from './templates';

type Rgb = readonly [number, number, number];

/** Runs the converter, checks the result contract and returns the decoded PNG. */
function convertOk(file: Uint8Array) {
  const result = convertPcx(file);
  expect(checkResultInvariants(result)).toEqual([]);
  if (!result.ok) throw new Error(`conversion failed: ${result.error}`);
  expect(result.mime).toBe('image/png');
  expect(result.extension).toBe('.png');
  return { result, png: decodePng(result.output) };
}

function pixel(rgba: Uint8Array, width: number, x: number, y: number): number[] {
  const o = (y * width + x) * 4;
  return [rgba[o] as number, rgba[o + 1] as number, rgba[o + 2] as number, rgba[o + 3] as number];
}

/** Expected RGBA (opaque) for a list of colours in row-major order. */
function expectedRgba(colours: readonly Rgb[]): number[] {
  return colours.flatMap((c) => [c[0], c[1], c[2], 255]);
}

function headerPalette(entries: Record<number, Rgb>): Uint8Array {
  const p = new Uint8Array(48);
  for (const [i, c] of Object.entries(entries)) p.set(c, Number(i) * 3);
  return p;
}

const BLACK: Rgb = [0, 0, 0];
const WHITE: Rgb = [255, 255, 255];
const RED: Rgb = [200, 0, 0];
const GREEN: Rgb = [0, 150, 0];
const BLUE: Rgb = [0, 0, 100];
const YELLOW: Rgb = [250, 240, 10];

describe('convertPcx examples', () => {
  it('converts a 10x2 monochrome image to black and white', () => {
    const indices = Uint8Array.from([
      1, 0, 1, 0, 1, 0, 1, 0, 1, 1,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 1,
    ]);
    const { png, result } = convertOk(encodePcx({ mode: 'mono', width: 10, height: 2, indices }));
    expect(result.warnings).toEqual([]);
    expect(png.width).toBe(10);
    expect(png.height).toBe(2);
    expect(Array.from(png.rgba)).toEqual(
      expectedRgba(Array.from(indices, (v) => (v === 1 ? WHITE : BLACK))),
    );
  });

  it('converts 3x2 planar 16-colour through the header palette', () => {
    const palette = headerPalette({ 0: BLACK, 3: RED, 9: GREEN, 15: YELLOW });
    const indices = Uint8Array.from([3, 9, 15, 0, 15, 3]);
    const { png, result } = convertOk(
      encodePcx({ mode: 'planar16', width: 3, height: 2, indices, palette }),
    );
    expect(result.warnings).toEqual([]);
    expect(Array.from(png.rgba)).toEqual(expectedRgba([RED, GREEN, YELLOW, BLACK, YELLOW, RED]));
  });

  it('converts 3x2 packed 16-colour through the header palette', () => {
    const palette = headerPalette({ 0: BLACK, 5: BLUE, 7: WHITE, 12: RED });
    const indices = Uint8Array.from([5, 7, 12, 12, 0, 5]);
    const { png, result } = convertOk(
      encodePcx({ mode: 'packed16', width: 3, height: 2, indices, palette }),
    );
    expect(result.warnings).toEqual([]);
    expect(Array.from(png.rgba)).toEqual(expectedRgba([BLUE, WHITE, RED, RED, BLACK, BLUE]));
  });

  it('converts 3x2 256-colour through the trailer palette', () => {
    const palette = new Uint8Array(768);
    palette.set(RED, 10 * 3);
    palette.set(GREEN, 200 * 3);
    palette.set(BLUE, 255 * 3);
    const indices = Uint8Array.from([10, 200, 255, 255, 0, 10]);
    const { png, result } = convertOk(
      encodePcx({ mode: 'indexed256', width: 3, height: 2, indices, palette }),
    );
    expect(result.warnings).toEqual([]);
    expect(Array.from(png.rgba)).toEqual(expectedRgba([RED, GREEN, BLUE, BLUE, BLACK, RED]));
  });

  it('converts 3x2 rgb24 exactly', () => {
    const colours: Rgb[] = [
      [10, 40, 70],
      [20, 50, 80],
      [30, 60, 90],
      [255, 0, 128],
      [1, 2, 3],
      [200, 201, 202],
    ];
    const rgb = Uint8Array.from(colours.flat());
    const { png, result } = convertOk(encodePcx({ mode: 'rgb24', width: 3, height: 2, rgb }));
    expect(result.warnings).toEqual([]);
    expect(Array.from(png.rgba)).toEqual(expectedRgba(colours));
  });

  it('uses the fixed EGA palette for version 3 and the header palette for version 5', () => {
    const header = headerPalette({ 1: [1, 2, 3], 6: [4, 5, 6], 12: [7, 8, 9] });
    const indices = Uint8Array.from([1, 6, 12, 12, 6, 1]);
    const base = { mode: 'planar16', width: 3, height: 2, indices, palette: header } as const;

    const v3 = convertOk(encodePcx({ ...base, version: 3 })).png;
    expect(pixel(v3.rgba, 3, 0, 0)).toEqual([0, 0, 170, 255]);
    expect(pixel(v3.rgba, 3, 1, 0)).toEqual([170, 85, 0, 255]);
    expect(pixel(v3.rgba, 3, 2, 0)).toEqual([255, 85, 85, 255]);

    const v5 = convertOk(encodePcx({ ...base, version: 5 })).png;
    expect(pixel(v5.rgba, 3, 0, 0)).toEqual([1, 2, 3, 255]);
    expect(pixel(v5.rgba, 3, 1, 0)).toEqual([4, 5, 6, 255]);
    expect(pixel(v5.rgba, 3, 2, 0)).toEqual([7, 8, 9, 255]);
  });

  it('uses a grayscale palette and warns when the 256-colour trailer is missing', () => {
    const indices = Uint8Array.from([0, 100, 255, 7, 8, 9]);
    const full = encodePcx({ mode: 'indexed256', width: 3, height: 2, indices });
    const cut = full.slice(0, full.length - 769);
    const { png, result } = convertOk(cut);
    expect(result.warnings.map((w) => w.code)).toEqual(['pcx-palette-missing']);
    expect(result.warnings[0]?.message).toBe(TEMPLATES.pcxPaletteMissing);
    expect(Array.from(png.rgba)).toEqual(
      expectedRgba(Array.from(indices, (v): Rgb => [v, v, v])),
    );
  });

  it('zero-fills missing bytes and warns once when pixel data is truncated', () => {
    const colours: Rgb[] = [
      [10, 40, 70],
      [20, 50, 80],
      [30, 60, 90],
      [11, 41, 71],
      [21, 51, 81],
      [31, 61, 91],
    ];
    const rgb = Uint8Array.from(colours.flat());
    const full = encodePcx({ mode: 'rgb24', width: 3, height: 2, rgb });
    // One row is 3 planes x 4 bytes = 12 literal bytes; keep that row plus a partial second one.
    const cut = full.slice(0, 128 + 12 + 5);
    const { png, result } = convertOk(cut);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]?.code).toBe('pcx-data-truncated');
    expect(result.warnings[0]?.message).toBe(fill(TEMPLATES.pcxDataTruncated, 1));
    expect(Array.from(png.rgba.slice(0, 12))).toEqual(expectedRgba(colours.slice(0, 3)));
    // Second row: the red plane and the first green byte survived, the rest is zero.
    expect(pixel(png.rgba, 3, 0, 1).slice(0, 3)).toEqual([11, 41, 0]);
    expect(pixel(png.rgba, 3, 1, 1).slice(0, 3)).toEqual([21, 0, 0]);
    expect(pixel(png.rgba, 3, 2, 1).slice(0, 3)).toEqual([31, 0, 0]);
  });

  it('fails without throwing for every input shorter than the 128-byte header', () => {
    for (let n = 0; n < 128; n++) {
      const result = convertPcx(new Uint8Array(n));
      expect(checkResultInvariants(result)).toEqual([]);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe(fill(TEMPLATES.errPcxShort, n));
    }
  });
});
