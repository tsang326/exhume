// PCX header parser. The ten conditions of Requirement 9.2 run in order and the lowest
// failed one decides the error (9.7). Nothing is allocated before all ten pass (9.8).
// DPI (offsets 12..15) and screen size (70..73) are never read (9.9).

import {
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
  MAX_PCX_BYTES_PER_LINE,
  MAX_PCX_DECODED_BYTES,
  PCX_HEADER_BYTES,
} from './limits';
import type { LimitName } from './limits';
import { TEMPLATES, fill, limitExceededMessage } from './templates';
import { ConversionWarningCode } from './types';
import type { WarningCollector } from './warnings';

export interface PcxHeader {
  version: number;
  bitsPerPixel: number;
  planes: number;
  width: number;
  height: number;
  bytesPerLine: number;
  xmin: number;
  ymin: number;
  /** 48 bytes copied from offsets 16..63. */
  headerPalette: Uint8Array;
  /** planes * bytesPerLine * height; at most MAX_PCX_DECODED_BYTES once accepted. */
  decodedBytes: number;
  /** ceil(width * bitsPerPixel / 8): bytes of one pixel row in a single plane. */
  rowBytes: number;
  /** Offset of the first RLE byte. */
  dataStart: number;
}

export type PcxHeaderResult =
  | { ok: true; header: PcxHeader }
  | { ok: false; error: string; limit?: LimitName };

const PALETTE_START = 16;
const PALETTE_BYTES = 48;
const MANUFACTURER = 0x0a;

function u16(input: Uint8Array, offset: number): number {
  return (input[offset] as number) + (input[offset + 1] as number) * 256;
}

function invalid(condition: number, limit?: LimitName): PcxHeaderResult {
  const error = fill(TEMPLATES.errPcxInvalid, condition);
  return limit === undefined ? { ok: false, error } : { ok: false, error, limit };
}

function limitFail(
  limit: LimitName,
  error: string,
  collector: WarningCollector,
): PcxHeaderResult {
  collector.add(ConversionWarningCode.LimitExceeded, limitExceededMessage(limit));
  return { ok: false, error, limit };
}

function isListedCombination(bpp: number, planes: number): boolean {
  return (
    (bpp === 1 && (planes === 1 || planes === 4)) ||
    (bpp === 4 && planes === 1) ||
    (bpp === 8 && (planes === 1 || planes === 3))
  );
}

export function parsePcxHeader(input: Uint8Array, collector: WarningCollector): PcxHeaderResult {
  // Condition 1: read no header field.
  if (input.length < PCX_HEADER_BYTES) {
    return { ok: false, error: fill(TEMPLATES.errPcxShort, input.length) };
  }

  const manufacturer = input[0] as number;
  const version = input[1] as number;
  const encoding = input[2] as number;
  const bitsPerPixel = input[3] as number;
  const xmin = u16(input, 4);
  const ymin = u16(input, 6);
  const xmax = u16(input, 8);
  const ymax = u16(input, 10);
  const planes = input[65] as number;
  const bytesPerLine = u16(input, 66);

  if (manufacturer !== MANUFACTURER) return invalid(2);
  if (version !== 0 && (version < 2 || version > 5)) return invalid(3);
  if (encoding !== 1) return invalid(4);
  if (xmax < xmin || ymax < ymin) return invalid(5);

  const width = xmax - xmin + 1;
  const height = ymax - ymin + 1;
  const largeError = fill(TEMPLATES.errPcxLarge, width, height);

  // Condition 6: width and height are at least 1 here, so only the upper bound can fail.
  if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
    return limitFail('MAX_IMAGE_DIMENSION', largeError, collector);
  }
  // Condition 7
  if (width * height > MAX_IMAGE_PIXELS) {
    return limitFail('MAX_IMAGE_PIXELS', largeError, collector);
  }
  // Condition 8
  if (!isListedCombination(bitsPerPixel, planes)) {
    return { ok: false, error: fill(TEMPLATES.errPcxFormat, bitsPerPixel, planes) };
  }

  // Condition 9
  const rowBytes = Math.ceil((width * bitsPerPixel) / 8);
  if (bytesPerLine > MAX_PCX_BYTES_PER_LINE) {
    collector.add(ConversionWarningCode.LimitExceeded, limitExceededMessage('MAX_PCX_BYTES_PER_LINE'));
    return invalid(9, 'MAX_PCX_BYTES_PER_LINE');
  }
  if (bytesPerLine < rowBytes) return invalid(9);

  // Condition 10
  const decodedBytes = planes * bytesPerLine * height;
  if (decodedBytes > MAX_PCX_DECODED_BYTES) {
    collector.add(ConversionWarningCode.LimitExceeded, limitExceededMessage('MAX_PCX_DECODED_BYTES'));
    return invalid(10, 'MAX_PCX_DECODED_BYTES');
  }

  // All ten hold: only now is anything allocated.
  const headerPalette = new Uint8Array(PALETTE_BYTES);
  for (let i = 0; i < PALETTE_BYTES; i++) {
    headerPalette[i] = input[PALETTE_START + i] as number;
  }

  return {
    ok: true,
    header: {
      version,
      bitsPerPixel,
      planes,
      width,
      height,
      bytesPerLine,
      xmin,
      ymin,
      headerPalette,
      decodedBytes,
      rowBytes,
      dataStart: PCX_HEADER_BYTES,
    },
  };
}
