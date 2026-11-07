import { FixtureError } from './errors';

export interface DecodedPng {
  width: number;
  height: number;
  rgba: Uint8Array;
  idat: Uint8Array;
  storedBlocks: Array<{ final: boolean; len: number }>;
  adler32: number;
  crcs: Array<{ type: string; stored: number }>;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function u32(b: Uint8Array, at: number): number {
  return (((b[at] as number) << 24) | ((b[at + 1] as number) << 16) | ((b[at + 2] as number) << 8) | (b[at + 3] as number)) >>> 0;
}

function need(ok: boolean, feature: string, detail?: string): void {
  if (!ok) throw new FixtureError(feature, detail);
}

/**
 * Decodes a PNG made of stored deflate blocks, filter 0 and colour type 6 (8-bit,
 * non-interlaced). The stored Adler-32 and CRC-32 values are returned as read; they
 * are never recomputed. Throws FixtureError naming the unsupported feature.
 */
export function decodePng(bytes: Uint8Array): DecodedPng {
  need(bytes.length >= 8 && SIGNATURE.every((v, i) => bytes[i] === v), 'png-signature');
  let pos = 8;
  let width = 0;
  let height = 0;
  let sawIhdr = false;
  let sawIend = false;
  const idatParts: Uint8Array[] = [];
  const crcs: Array<{ type: string; stored: number }> = [];

  while (pos < bytes.length && !sawIend) {
    need(pos + 8 <= bytes.length, 'png-truncated-chunk');
    const len = u32(bytes, pos);
    const type = String.fromCharCode(
      bytes[pos + 4] as number, bytes[pos + 5] as number, bytes[pos + 6] as number, bytes[pos + 7] as number,
    );
    const dataStart = pos + 8;
    need(len <= bytes.length - dataStart - 4, 'png-truncated-chunk', type);
    crcs.push({ type, stored: u32(bytes, dataStart + len) });
    if (type === 'IHDR') {
      need(len === 13, 'png-ihdr-length');
      width = u32(bytes, dataStart);
      height = u32(bytes, dataStart + 4);
      need(bytes[dataStart + 8] === 8, 'png-bit-depth-not-8');
      need(bytes[dataStart + 9] === 6, 'png-colour-type-not-6');
      need(bytes[dataStart + 10] === 0 && bytes[dataStart + 11] === 0, 'png-compression-or-filter-method');
      need(bytes[dataStart + 12] === 0, 'png-interlace');
      sawIhdr = true;
    } else if (type === 'IDAT') {
      idatParts.push(bytes.subarray(dataStart, dataStart + len));
    } else if (type === 'IEND') {
      sawIend = true;
    }
    pos = dataStart + len + 4;
  }
  need(sawIhdr, 'png-missing-ihdr');
  need(idatParts.length > 0, 'png-missing-idat');

  let total = 0;
  for (const p of idatParts) total += p.length;
  const idat = new Uint8Array(total);
  let o = 0;
  for (const p of idatParts) {
    idat.set(p, o);
    o += p.length;
  }

  // zlib header, stored blocks, Adler-32.
  need(idat.length >= 2, 'zlib-truncated');
  need(((idat[0] as number) & 0x0f) === 8, 'zlib-method');
  let z = 2;
  const storedBlocks: Array<{ final: boolean; len: number }> = [];
  const raw: number[][] = [];
  let final = false;
  while (!final) {
    need(z + 5 <= idat.length, 'deflate-truncated');
    const head = idat[z] as number;
    need(((head >> 1) & 3) === 0, 'deflate-compressed-block', 'only stored blocks are supported');
    final = (head & 1) === 1;
    const blen = (idat[z + 1] as number) | ((idat[z + 2] as number) << 8);
    const nlen = (idat[z + 3] as number) | ((idat[z + 4] as number) << 8);
    need((blen ^ 0xffff) === nlen, 'deflate-stored-length-check');
    need(z + 5 + blen <= idat.length, 'deflate-truncated');
    storedBlocks.push({ final, len: blen });
    raw.push([z + 5, blen]);
    z += 5 + blen;
  }
  need(z + 4 <= idat.length, 'zlib-missing-adler32');
  const adler32 = u32(idat, z);
  need(z + 4 === idat.length, 'zlib-trailing-bytes');

  const stride = width * 4;
  const expected = height * (stride + 1);
  let rawLen = 0;
  for (const r of raw) rawLen += r[1] as number;
  need(rawLen === expected, 'png-pixel-data-length', `expected ${expected}, got ${rawLen}`);
  const flat = new Uint8Array(rawLen);
  let f = 0;
  for (const [start, n] of raw as Array<[number, number]>) {
    flat.set(idat.subarray(start, start + n), f);
    f += n;
  }
  const rgba = new Uint8Array(height * stride);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    need(flat[rowStart] === 0, 'png-filter-not-0', `row ${y}`);
    rgba.set(flat.subarray(rowStart + 1, rowStart + 1 + stride), y * stride);
  }
  return { width, height, rgba, idat, storedBlocks, adler32, crcs };
}
