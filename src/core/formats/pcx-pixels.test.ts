import { describe, expect, it } from 'vitest';
import type { PcxHeader } from './pcx-header';
import { expandToRgba } from './pcx-pixels';

function header(
  bitsPerPixel: number,
  planes: number,
  width: number,
  height: number,
  bytesPerLine: number,
): PcxHeader {
  return {
    version: 5,
    bitsPerPixel,
    planes,
    width,
    height,
    bytesPerLine,
    xmin: 0,
    ymin: 0,
    headerPalette: new Uint8Array(48),
    decodedBytes: planes * bytesPerLine * height,
    rowBytes: Math.ceil((width * bitsPerPixel) / 8),
    dataStart: 128,
  };
}

function table(entries: number[][], size: number): Uint8Array {
  const t = new Uint8Array(size * 3);
  entries.forEach((e, i) => t.set(e, i * 3));
  return t;
}

describe('expandToRgba', () => {
  it('1-bit: MSB first, odd width, padding ignored', () => {
    const pal = table([[0, 0, 0], [255, 255, 255]], 2);
    // width 10 -> bits 1010 1010 11, then 6 padding bits (zeros here)
    const out = expandToRgba(header(1, 1, 10, 1, 2), Uint8Array.of(0xaa, 0xc0), pal);
    expect(out.length).toBe(40);
    const expected = [1, 0, 1, 0, 1, 0, 1, 0, 1, 1];
    expected.forEach((bit, i) => {
      const v = bit ? 255 : 0;
      expect(Array.from(out.subarray(i * 4, i * 4 + 4))).toEqual([v, v, v, 255]);
    });
  });

  it('1-bit/4-plane: plane 0 is the least significant bit', () => {
    const pal = new Uint8Array(48);
    for (let i = 0; i < 16; i++) pal.set([i, i * 2, i * 3], i * 3);
    const decoded = Uint8Array.of(0b10100000, 0b01100000, 0b00100000, 0b10000000);
    const out = expandToRgba(header(1, 4, 3, 1, 1), decoded, pal);
    expect(Array.from(out)).toEqual([9, 18, 27, 255, 2, 4, 6, 255, 7, 14, 21, 255]);
  });

  it('4-bit: high nibble first, odd width drops trailing nibble', () => {
    const pal = table([[0, 0, 0], [10, 0, 0], [20, 0, 0], [30, 0, 0]], 16);
    const out = expandToRgba(header(4, 1, 3, 1, 2), Uint8Array.of(0x12, 0x3f), pal);
    expect(Array.from(out)).toEqual([10, 0, 0, 255, 20, 0, 0, 255, 30, 0, 0, 255]);
  });

  it('8-bit/1-plane: byte indexes the palette, row padding ignored', () => {
    const pal = table([[1, 2, 3], [4, 5, 6], [7, 8, 9]], 256);
    const out = expandToRgba(header(8, 1, 2, 2, 3), Uint8Array.of(1, 2, 99, 0, 1, 99), pal);
    expect(Array.from(out)).toEqual([
      4, 5, 6, 255, 7, 8, 9, 255,
      1, 2, 3, 255, 4, 5, 6, 255,
    ]);
  });

  it('8-bit/3-plane: planes are red, green, blue', () => {
    const decoded = Uint8Array.of(10, 20, 0, 30, 40, 0, 50, 60, 0);
    const out = expandToRgba(header(8, 3, 2, 1, 3), decoded, new Uint8Array(0));
    expect(Array.from(out)).toEqual([10, 30, 50, 255, 20, 40, 60, 255]);
  });
});
