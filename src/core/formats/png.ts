// PNG encoder: one allocation, stored (uncompressed) deflate blocks, filter 0.

import { adler32Update, crc32Update } from './checksums';
import {
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
  PNG_CHUNK_OVERHEAD_BYTES,
  PNG_IHDR_DATA_BYTES,
  PNG_SIGNATURE_BYTES,
  PNG_STORED_BLOCK_MAX,
  PNG_STORED_BLOCK_OVERHEAD_BYTES,
  PNG_ZLIB_WRAPPER_BYTES,
  pngBytesForFiltered,
} from './limits';
import type { LimitName } from './limits';
import { failResult, okResult } from './result';
import { TEMPLATES, limitExceededMessage } from './templates';
import { ConversionWarningCode } from './types';
import type { PngResult, RgbaImage } from './types';
import { makeWarningCollector } from './warnings';
import type { WarningCollector } from './warnings';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const TYPE_IHDR = [0x49, 0x48, 0x44, 0x52];
const TYPE_IDAT = [0x49, 0x44, 0x41, 0x54];
const TYPE_IEND = [0x49, 0x45, 0x4e, 0x44];
const BIT_DEPTH = 8;
const COLOR_TYPE_RGBA = 6;
const BYTES_PER_PIXEL = 4;
const ZLIB_HEADER_0 = 0x78;
const ZLIB_HEADER_1 = 0x01;
const ZERO_BYTE = new Uint8Array(1);

function fail(w: WarningCollector, limit?: LimitName): PngResult {
  if (limit !== undefined) {
    w.add(ConversionWarningCode.LimitExceeded, limitExceededMessage(limit));
  }
  return failResult(TEMPLATES.errPngInput, w);
}

function putU32(out: Uint8Array, at: number, v: number): void {
  out[at] = (v >>> 24) & 0xff;
  out[at + 1] = (v >>> 16) & 0xff;
  out[at + 2] = (v >>> 8) & 0xff;
  out[at + 3] = v & 0xff;
}

function putType(out: Uint8Array, at: number, type: number[]): void {
  for (let i = 0; i < 4; i++) out[at + i] = type[i];
}

/** Writes the CRC of out[typeStart, end) at `end`. */
function putCrc(out: Uint8Array, typeStart: number, end: number): void {
  putU32(out, end, crc32Update(0, out, typeStart, end));
}

export function encodePng(image: RgbaImage): PngResult {
  const w = makeWarningCollector();
  try {
    // Callers may pass anything at runtime; validate as unknown.
    const raw: unknown = image;
    if (typeof raw !== 'object' || raw === null) return fail(w);
    const src = raw as { width?: unknown; height?: unknown; rgba?: unknown };
    const width = src.width;
    const height = src.height;
    const rgba = src.rgba;
    if (typeof width !== 'number' || !Number.isInteger(width) || width < 1) return fail(w);
    if (typeof height !== 'number' || !Number.isInteger(height) || height < 1) return fail(w);
    if (width > MAX_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
      return fail(w, 'MAX_IMAGE_DIMENSION');
    }
    if (width * height > MAX_IMAGE_PIXELS) return fail(w, 'MAX_IMAGE_PIXELS');
    if (Object.prototype.toString.call(rgba) !== '[object Uint8Array]') return fail(w);
    const pixels = rgba as Uint8Array;
    const rowBytes = width * BYTES_PER_PIXEL;
    if (pixels.length !== rowBytes * height) return fail(w);

    const filtered = rowBytes * height + height;
    const stride = rowBytes + 1;
    const blocks = Math.ceil(filtered / PNG_STORED_BLOCK_MAX);
    const idatLen = PNG_ZLIB_WRAPPER_BYTES + filtered + PNG_STORED_BLOCK_OVERHEAD_BYTES * blocks;
    const total = pngBytesForFiltered(filtered);
    const out = new Uint8Array(total);

    // Signature.
    for (let i = 0; i < PNG_SIGNATURE_BYTES; i++) out[i] = SIGNATURE[i];

    // IHDR.
    let at = PNG_SIGNATURE_BYTES;
    putU32(out, at, PNG_IHDR_DATA_BYTES);
    putType(out, at + 4, TYPE_IHDR);
    putU32(out, at + 8, width);
    putU32(out, at + 12, height);
    out[at + 16] = BIT_DEPTH;
    out[at + 17] = COLOR_TYPE_RGBA;
    // compression, filter, interlace bytes stay 0
    putCrc(out, at + 4, at + 8 + PNG_IHDR_DATA_BYTES);
    at += PNG_CHUNK_OVERHEAD_BYTES + PNG_IHDR_DATA_BYTES;

    // IDAT.
    const idatStart = at;
    putU32(out, at, idatLen);
    putType(out, at + 4, TYPE_IDAT);
    at += 8;
    out[at++] = ZLIB_HEADER_0;
    out[at++] = ZLIB_HEADER_1;

    let adler = 1;
    let pos = 0; // position in the virtual filtered stream
    while (pos < filtered) {
      const len = Math.min(PNG_STORED_BLOCK_MAX, filtered - pos);
      out[at++] = pos + len >= filtered ? 1 : 0;
      out[at++] = len & 0xff;
      out[at++] = len >>> 8;
      out[at++] = ~len & 0xff;
      out[at++] = (~len >>> 8) & 0xff;
      let remaining = len;
      while (remaining > 0) {
        const row = Math.floor(pos / stride);
        const col = pos - row * stride;
        if (col === 0) {
          // Filter byte 0: output is already zero-filled.
          adler = adler32Update(adler, ZERO_BYTE);
          at++;
          pos++;
          remaining--;
          continue;
        }
        const n = Math.min(remaining, stride - col);
        const from = row * rowBytes + (col - 1);
        const seg = pixels.subarray(from, from + n);
        out.set(seg, at);
        adler = adler32Update(adler, seg);
        at += n;
        pos += n;
        remaining -= n;
      }
    }
    putU32(out, at, adler);
    at += 4;
    putCrc(out, idatStart + 4, at);
    at += 4;

    // IEND.
    putU32(out, at, 0);
    putType(out, at + 4, TYPE_IEND);
    putCrc(out, at + 4, at + 8);

    return okResult(out, 'image/png', '.png', w);
  } catch {
    return fail(makeWarningCollector());
  }
}
