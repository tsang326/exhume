// convertPcx: header -> RLE -> palette -> RGBA -> PNG (Requirements 9.7, 10.4, 10.14, 10.15, 1.6, 12.12).

import { assertUint8Array, guarded, limitInput } from './guard';
import { PCX_VGA_PALETTE_BYTES } from './limits';
import { decodeRle } from './pcx-rle';
import { choosePalette } from './pcx-palette';
import { parsePcxHeader } from './pcx-header';
import type { PcxHeader } from './pcx-header';
import { expandToRgba } from './pcx-pixels';
import { encodePng } from './png';
import { failResult, okResult } from './result';
import { TEMPLATES, fill } from './templates';
import { ConversionWarningCode } from './types';
import type { PngResult } from './types';
import { makeWarningCollector } from './warnings';
import type { WarningCollector } from './warnings';

const VGA_MARKER = 0x0c;

/**
 * Decodes and expands in one function so the decoded planes are unreachable
 * once the RGBA array is returned (before the PNG buffer is allocated).
 *
 * Trailer rule: for 8-bit/1-plane images that carry a 0x0C-marked 769-byte
 * trailer, the RLE stream is bounded at the trailer start, so palette bytes are
 * never decoded as pixels. A stream that needs more room ends as
 * pcx-data-truncated and the trailer palette is still used.
 */
function decodeToRgba(
  input: Uint8Array,
  header: PcxHeader,
  collector: WarningCollector,
): Uint8Array {
  let limit = input.length;
  if (header.bitsPerPixel === 8 && header.planes === 1) {
    const trailerStart = input.length - PCX_VGA_PALETTE_BYTES;
    if (trailerStart >= header.dataStart && input[trailerStart] === VGA_MARKER) {
      limit = trailerStart;
    }
  }

  const rle = decodeRle(input, header.dataStart, limit, header.decodedBytes);
  if (rle.truncated) {
    const completeRows = Math.floor(rle.filled / (header.planes * header.bytesPerLine));
    collector.add(
      ConversionWarningCode.PcxDataTruncated,
      fill(TEMPLATES.pcxDataTruncated, completeRows),
    );
  }

  const choice = choosePalette(header, input, rle.consumed);
  if (choice.missing) {
    collector.add(ConversionWarningCode.PcxPaletteMissing, TEMPLATES.pcxPaletteMissing);
  }

  return expandToRgba(header, rle.data, choice.palette);
}

export function convertPcx(input: Uint8Array): PngResult {
  assertUint8Array(input);
  const collector = makeWarningCollector();
  return guarded((): PngResult => {
    const data = limitInput(input, collector);
    const parsed = parsePcxHeader(data, collector);
    if (!parsed.ok) return failResult(parsed.error, collector);

    const header = parsed.header;
    const rgba = decodeToRgba(data, header, collector);
    const png = encodePng({ width: header.width, height: header.height, rgba });
    for (const warning of png.warnings) collector.add(warning.code, warning.message);
    if (!png.ok) return failResult(png.error, collector);
    return okResult(png.output, 'image/png', '.png', collector);
  }, collector);
}
