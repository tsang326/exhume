// PCX pixel expansion (Requirements 10.6 to 10.9, 10.11, 10.13).
// One tight loop per pixel format. The RGBA array is allocated once; alpha is always 255.
// `decoded` is scanline-major: each scanline holds `planes` planes of bytesPerLine bytes.
// Bytes of a plane after the first rowBytes, and padding bits of the last byte, are ignored.

import type { PcxHeader } from './pcx-header';

export function expandToRgba(
  header: PcxHeader,
  decoded: Uint8Array,
  palette: Uint8Array,
): Uint8Array {
  const { width, height, bitsPerPixel, planes, bytesPerLine } = header;
  const out = new Uint8Array(width * height * 4);
  const stride = planes * bytesPerLine;
  let o = 0;

  if (bitsPerPixel === 1 && planes === 1) {
    for (let y = 0; y < height; y++) {
      const row = y * stride;
      for (let x = 0; x < width; x++) {
        const bit = ((decoded[row + (x >> 3)] as number) >> (7 - (x & 7))) & 1;
        const p = bit * 3;
        out[o] = palette[p] as number;
        out[o + 1] = palette[p + 1] as number;
        out[o + 2] = palette[p + 2] as number;
        out[o + 3] = 255;
        o += 4;
      }
    }
  } else if (bitsPerPixel === 1 && planes === 4) {
    for (let y = 0; y < height; y++) {
      const row = y * stride;
      for (let x = 0; x < width; x++) {
        const at = row + (x >> 3);
        const shift = 7 - (x & 7);
        const index =
          (((decoded[at] as number) >> shift) & 1) |
          ((((decoded[at + bytesPerLine] as number) >> shift) & 1) << 1) |
          ((((decoded[at + 2 * bytesPerLine] as number) >> shift) & 1) << 2) |
          ((((decoded[at + 3 * bytesPerLine] as number) >> shift) & 1) << 3);
        const p = (index & 15) * 3;
        out[o] = palette[p] as number;
        out[o + 1] = palette[p + 1] as number;
        out[o + 2] = palette[p + 2] as number;
        out[o + 3] = 255;
        o += 4;
      }
    }
  } else if (bitsPerPixel === 4) {
    for (let y = 0; y < height; y++) {
      const row = y * stride;
      for (let x = 0; x < width; x++) {
        const byte = decoded[row + (x >> 1)] as number;
        const index = (x & 1) === 0 ? byte >> 4 : byte & 15;
        const p = (index & 15) * 3;
        out[o] = palette[p] as number;
        out[o + 1] = palette[p + 1] as number;
        out[o + 2] = palette[p + 2] as number;
        out[o + 3] = 255;
        o += 4;
      }
    }
  } else if (planes === 1) {
    // 8 bits per pixel, one plane
    for (let y = 0; y < height; y++) {
      const row = y * stride;
      for (let x = 0; x < width; x++) {
        const p = ((decoded[row + x] as number) & 255) * 3;
        out[o] = palette[p] as number;
        out[o + 1] = palette[p + 1] as number;
        out[o + 2] = palette[p + 2] as number;
        out[o + 3] = 255;
        o += 4;
      }
    }
  } else {
    // 8 bits per pixel, three planes: red, green, blue
    for (let y = 0; y < height; y++) {
      const row = y * stride;
      for (let x = 0; x < width; x++) {
        const at = row + x;
        out[o] = decoded[at] as number;
        out[o + 1] = decoded[at + bytesPerLine] as number;
        out[o + 2] = decoded[at + 2 * bytesPerLine] as number;
        out[o + 3] = 255;
        o += 4;
      }
    }
  }
  return out;
}
