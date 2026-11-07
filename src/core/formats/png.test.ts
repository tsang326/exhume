import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { numRuns } from '../../test-support/runs';
import { rgbaImageArb } from '../../test-support/formats/arbitraries';
import { decodePng } from '../../test-support/formats';
import { inflateIdat, recomputeChunkCrcs } from '../../test-support/formats/png-oracle';
import { encodePng } from './png';

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function u32(b: Uint8Array, at: number): number {
  return (((b[at] as number) << 24) | ((b[at + 1] as number) << 16) | ((b[at + 2] as number) << 8) | (b[at + 3] as number)) >>> 0;
}

/** Walks the chunks from byte 8; returns null if the layout does not end exactly at the file end. */
function walkChunks(b: Uint8Array): Array<{ type: string; data: number; len: number }> | null {
  const out: Array<{ type: string; data: number; len: number }> = [];
  let pos = 8;
  while (pos < b.length) {
    if (pos + 12 > b.length) return null;
    const len = u32(b, pos);
    const type = String.fromCharCode(b[pos + 4] as number, b[pos + 5] as number, b[pos + 6] as number, b[pos + 7] as number);
    if (pos + 12 + len > b.length) return null;
    out.push({ type, data: pos + 8, len });
    pos += 12 + len;
  }
  return pos === b.length ? out : null;
}

describe('encodePng round trip', () => {
  // Feature: format-resurrection, Property 30: PNG round trip
  it('decodePng(encodePng(image)) equals the source with a well-formed container', () => {
    // **Validates: Requirements 11.1, 11.2, 11.12, 11.15**
    fc.assert(
      fc.property(rgbaImageArb(64, 64), (image) => {
        const before = image.rgba.slice();
        const result = encodePng(image);
        if (!result.ok) return false;

        // Input unchanged.
        if (image.rgba.length !== before.length) return false;
        for (let i = 0; i < before.length; i++) if (image.rgba[i] !== before[i]) return false;

        const png = result.output;
        for (let i = 0; i < 8; i++) if (png[i] !== SIGNATURE[i]) return false;

        // Chunk order: IHDR, IDAT, IEND, and no other bytes.
        const chunks = walkChunks(png);
        if (chunks === null) return false;
        if (chunks.map((c) => c.type).join(',') !== 'IHDR,IDAT,IEND') return false;

        // IHDR fields.
        const ihdr = chunks[0] as { data: number; len: number };
        if (ihdr.len !== 13) return false;
        if (u32(png, ihdr.data) !== image.width) return false;
        if (u32(png, ihdr.data + 4) !== image.height) return false;
        if (png[ihdr.data + 8] !== 8 || png[ihdr.data + 9] !== 6) return false;
        if (png[ihdr.data + 10] !== 0 || png[ihdr.data + 11] !== 0 || png[ihdr.data + 12] !== 0) return false;
        if ((chunks[2] as { len: number }).len !== 0) return false;

        // Decoded image equals the source.
        const decoded = decodePng(png);
        if (decoded.width !== image.width || decoded.height !== image.height) return false;
        if (decoded.rgba.length !== before.length) return false;
        for (let i = 0; i < before.length; i++) if (decoded.rgba[i] !== before[i]) return false;
        return true;
      }),
      { numRuns: numRuns(100) },
    );
  });

  it('round-trips a 1 by 1 image (example)', () => {
    const image = { width: 1, height: 1, rgba: Uint8Array.of(1, 2, 3, 4) };
    const result = encodePng(image);
    expect(result.ok).toBe(true);
    if (result.ok) expect(Array.from(decodePng(result.output).rgba)).toEqual([1, 2, 3, 4]);
  });
});

describe('encodePng agrees with Node zlib', () => {
  // Feature: format-resurrection, Property 31: PNG agrees with Node zlib
  it('inflates to the filtered rows and every chunk CRC matches zlib.crc32', () => {
    // **Validates: Requirements 11.3, 11.4, 11.5, 11.13**
    fc.assert(
      fc.property(rgbaImageArb(64, 64), (image) => {
        const result = encodePng(image);
        if (!result.ok) return false;
        const png = result.output;

        const chunks = walkChunks(png);
        if (chunks === null) return false;
        const idat = chunks.find((c) => c.type === 'IDAT');
        if (idat === undefined) return false;

        // inflateSync also verifies the zlib Adler-32 trailer (throws on mismatch).
        let inflated: Uint8Array;
        try {
          inflated = inflateIdat(png.subarray(idat.data, idat.data + idat.len));
        } catch {
          return false;
        }

        const rowBytes = image.width * 4;
        if (inflated.length !== image.height * (1 + rowBytes)) return false;
        for (let y = 0; y < image.height; y++) {
          const at = y * (1 + rowBytes);
          if (inflated[at] !== 0) return false;
          for (let x = 0; x < rowBytes; x++) {
            if (inflated[at + 1 + x] !== image.rgba[y * rowBytes + x]) return false;
          }
        }

        // CRC-32 of type + data for every chunk equals zlib's.
        const crcs = recomputeChunkCrcs(png);
        if (crcs.length !== chunks.length) return false;
        for (const c of crcs) if (c.computed !== c.stored) return false;
        return true;
      }),
      { numRuns: numRuns(100) },
    );
  });
});
