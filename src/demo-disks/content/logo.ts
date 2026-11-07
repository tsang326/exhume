// Generic builder: an authored logo (size, palette, pixel function) to PCX bytes
// plus the RGBA pixels a correct PNG conversion must give back.

import { encodePcx } from '../../test-support/formats/index';
import { DemoBuildError } from '../errors';

export interface AuthoredLogo {
  width: number;
  height: number;
  palette: ReadonlyArray<readonly [number, number, number]>; // 1 to 256 colors
  pixel(x: number, y: number): number; // palette index
}

const MAX_SIDE = 256;
const MAX_COLORS = 256;
const SOURCE = 'logo';

function fail(message: string): never {
  throw new DemoBuildError(SOURCE, message);
}

function isByte(n: number): boolean {
  return Number.isInteger(n) && n >= 0 && n <= 255;
}

export function logoToPcx(l: AuthoredLogo): { bytes: Uint8Array; expectedRgba: Uint8Array } {
  const { width, height, palette } = l;
  if (!Number.isInteger(width) || width < 1 || width > MAX_SIDE) fail('logo width must be an integer from 1 to 256');
  if (!Number.isInteger(height) || height < 1 || height > MAX_SIDE) fail('logo height must be an integer from 1 to 256');
  if (palette.length < 1 || palette.length > MAX_COLORS) fail('logo palette must hold 1 to 256 colors');

  const pal = new Uint8Array(MAX_COLORS * 3); // unused entries stay black
  for (let i = 0; i < palette.length; i++) {
    const c = palette[i] as readonly [number, number, number];
    for (let k = 0; k < 3; k++) {
      const v = c[k] as number;
      if (!isByte(v)) fail('logo palette components must be integers from 0 to 255');
      pal[i * 3 + k] = v;
    }
  }

  const pixels = width * height;
  const indices = new Uint8Array(pixels);
  const expectedRgba = new Uint8Array(pixels * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = l.pixel(x, y);
      if (!Number.isInteger(idx) || idx < 0 || idx >= palette.length) {
        fail('logo pixel index is outside the palette');
      }
      const at = y * width + x;
      indices[at] = idx;
      expectedRgba[at * 4] = pal[idx * 3] as number;
      expectedRgba[at * 4 + 1] = pal[idx * 3 + 1] as number;
      expectedRgba[at * 4 + 2] = pal[idx * 3 + 2] as number;
      expectedRgba[at * 4 + 3] = 255;
    }
  }

  try {
    const bytes = encodePcx({ mode: 'indexed256', width, height, indices, palette: pal });
    return { bytes, expectedRgba };
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'PCX encoding failed');
  }
}
