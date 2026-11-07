// Node-only: imports node:zlib. Used by test files; never exported from the barrel.
import { crc32, inflateSync } from 'node:zlib';

/** Inflates a zlib stream with Node's zlib (also checks the stored Adler-32). */
export function inflateZlib(zlibBytes: Uint8Array): Uint8Array {
  return new Uint8Array(inflateSync(zlibBytes));
}

/** CRC-32 of the bytes, computed by Node's zlib. */
export function crc32Of(bytes: Uint8Array): number {
  return crc32(bytes) >>> 0;
}

/** Recomputes every chunk CRC (type + data) of a PNG file with Node's zlib. */
export function recomputeChunkCrcs(png: Uint8Array): Array<{ type: string; computed: number; stored: number }> {
  const out: Array<{ type: string; computed: number; stored: number }> = [];
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  let pos = 8;
  while (pos + 12 <= png.length) {
    const len = view.getUint32(pos);
    const type = String.fromCharCode(...png.subarray(pos + 4, pos + 8));
    if (pos + 12 + len > png.length) break;
    out.push({
      type,
      computed: crc32Of(png.subarray(pos + 4, pos + 8 + len)),
      stored: view.getUint32(pos + 8 + len),
    });
    pos += 12 + len;
  }
  return out;
}

/** Inflates the concatenated IDAT bytes of a PNG with Node's zlib and returns the raw scanline stream. */
export function inflateIdat(idat: Uint8Array): Uint8Array {
  return inflateZlib(idat);
}
