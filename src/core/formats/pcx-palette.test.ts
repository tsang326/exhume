import { describe, expect, it } from 'vitest';
import { choosePalette } from './pcx-palette';
import type { PcxHeader } from './pcx-header';

function hdr(over: Partial<PcxHeader>): PcxHeader {
  const headerPalette = new Uint8Array(48);
  for (let i = 0; i < 48; i++) headerPalette[i] = i + 1;
  return {
    version: 5,
    bitsPerPixel: 8,
    planes: 1,
    width: 1,
    height: 1,
    bytesPerLine: 2,
    xmin: 0,
    ymin: 0,
    headerPalette,
    decodedBytes: 2,
    rowBytes: 1,
    dataStart: 128,
    ...over,
  };
}

function withTrailer(dataLen: number, marker = 0x0c): Uint8Array {
  const input = new Uint8Array(128 + dataLen + 769);
  input[128 + dataLen] = marker;
  for (let i = 0; i < 768; i++) input[128 + dataLen + 1 + i] = (i * 7) & 255;
  return input;
}

describe('choosePalette', () => {
  it('monochrome is black then white', () => {
    const r = choosePalette(hdr({ bitsPerPixel: 1, planes: 1 }), new Uint8Array(130), 128);
    expect(Array.from(r.palette)).toEqual([0, 0, 0, 255, 255, 255]);
    expect(r.missing).toBe(false);
  });

  it('version 3 uses the fixed EGA palette, version 5 the header palette', () => {
    const v3 = choosePalette(hdr({ version: 3, bitsPerPixel: 4 }), new Uint8Array(130), 128);
    expect(v3.palette.length).toBe(48);
    expect(Array.from(v3.palette.slice(6, 9))).toEqual([0x00, 0xaa, 0x00]);
    expect(Array.from(v3.palette.slice(18, 21))).toEqual([0xaa, 0x55, 0x00]);
    expect(Array.from(v3.palette.slice(45, 48))).toEqual([255, 255, 255]);
    const v5 = choosePalette(hdr({ version: 5, bitsPerPixel: 1, planes: 4 }), new Uint8Array(130), 128);
    expect(v5.palette[0]).toBe(1);
    expect(v5.palette[47]).toBe(48);
    expect(v5.missing).toBe(false);
  });

  it('reads the VGA trailer when present', () => {
    const input = withTrailer(10);
    const r = choosePalette(hdr({}), input, 138);
    expect(r.missing).toBe(false);
    expect(r.palette.length).toBe(768);
    expect(r.palette[1]).toBe(7);
  });

  it('falls back to grayscale when the trailer is absent or wrong marker', () => {
    for (const input of [new Uint8Array(900), withTrailer(10, 0x0d), new Uint8Array(200)]) {
      const r = choosePalette(hdr({}), input, 130);
      expect(r.missing).toBe(true);
      expect(r.palette.length).toBe(768);
      expect(Array.from(r.palette.slice(3 * 200, 3 * 200 + 3))).toEqual([200, 200, 200]);
    }
  });

  it('falls back to grayscale when the RLE data overlaps the trailer', () => {
    const input = withTrailer(10);
    const r = choosePalette(hdr({}), input, 139);
    expect(r.missing).toBe(true);
  });

  it('24-bit images have an empty palette', () => {
    const r = choosePalette(hdr({ planes: 3 }), new Uint8Array(130), 128);
    expect(r.palette.length).toBe(0);
    expect(r.missing).toBe(false);
  });
});
