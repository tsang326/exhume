// PCX palette selection (Requirements 10.6 to 10.10, 10.12). Only constant-size tables.

import { PCX_VGA_PALETTE_BYTES } from './limits';
import type { PcxHeader } from './pcx-header';

export interface PaletteChoice {
  /** Flat RGB table, 3 bytes per entry. Empty for 24-bit images. */
  palette: Uint8Array;
  /** True when an 8-bit/1-plane image had no usable VGA trailer. */
  missing: boolean;
}

const VGA_MARKER = 0x0c;

// Standard 16-colour EGA palette used for version 3 files (10.12).
const EGA_PALETTE: readonly number[] = [
  0x00, 0x00, 0x00, 0x00, 0x00, 0xaa, 0x00, 0xaa, 0x00, 0x00, 0xaa, 0xaa,
  0xaa, 0x00, 0x00, 0xaa, 0x00, 0xaa, 0xaa, 0x55, 0x00, 0xaa, 0xaa, 0xaa,
  0x55, 0x55, 0x55, 0x55, 0x55, 0xff, 0x55, 0xff, 0x55, 0x55, 0xff, 0xff,
  0xff, 0x55, 0x55, 0xff, 0x55, 0xff, 0xff, 0xff, 0x55, 0xff, 0xff, 0xff,
];

export function choosePalette(
  header: PcxHeader,
  input: Uint8Array,
  rleConsumed: number,
): PaletteChoice {
  if (header.bitsPerPixel === 1 && header.planes === 1) {
    const mono = new Uint8Array(6);
    mono[3] = 255;
    mono[4] = 255;
    mono[5] = 255;
    return { palette: mono, missing: false };
  }

  if (header.bitsPerPixel === 8 && header.planes === 3) {
    return { palette: new Uint8Array(0), missing: false };
  }

  if (header.bitsPerPixel === 8 && header.planes === 1) {
    const start = input.length - PCX_VGA_PALETTE_BYTES;
    if (start >= header.dataStart && start >= rleConsumed && input[start] === VGA_MARKER) {
      return { palette: input.slice(start + 1, input.length), missing: false };
    }
    const gray = new Uint8Array(768);
    for (let i = 0; i < 256; i++) {
      gray[i * 3] = i;
      gray[i * 3 + 1] = i;
      gray[i * 3 + 2] = i;
    }
    return { palette: gray, missing: true };
  }

  // 16-colour modes.
  if (header.version === 3) {
    return { palette: Uint8Array.from(EGA_PALETTE), missing: false };
  }
  return { palette: header.headerPalette.slice(0, 48), missing: false };
}
