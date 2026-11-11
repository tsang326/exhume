// Test-only PNG reader. Decodes 8-bit, non-interlaced PNGs (grey, grey+alpha, RGB, palette, RGBA)
// into RGBA so tests can measure pixel alpha (the grain overlay). Not for untrusted input.
import { inflateSync } from 'node:zlib';

export interface PngImage {
  readonly width: number;
  readonly height: number;
  /** width * height * 4 bytes, row-major, R G B A. */
  readonly rgba: Uint8Array;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const CHANNELS: Readonly<Record<number, number>> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

const u32 = (b: Uint8Array, at: number): number =>
  ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0;

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

export function readPng(png: Uint8Array): PngImage {
  if (png.length < 8 || SIGNATURE.some((v, i) => png[i] !== v)) throw new Error('not a PNG');
  let width = 0;
  let height = 0;
  let colorType = -1;
  let palette: Uint8Array = new Uint8Array(0);
  let trns: Uint8Array = new Uint8Array(0);
  const idat: Uint8Array[] = [];
  for (let at = 8; at + 8 <= png.length; ) {
    const len = u32(png, at);
    const type = String.fromCharCode(png[at + 4]!, png[at + 5]!, png[at + 6]!, png[at + 7]!);
    const body = png.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') {
      width = u32(body, 0);
      height = u32(body, 4);
      if (body[8] !== 8) throw new Error('only 8-bit PNG is supported');
      colorType = body[9]!;
      if (body[12] !== 0) throw new Error('interlaced PNG is not supported');
    } else if (type === 'PLTE') palette = body;
    else if (type === 'tRNS') trns = body;
    else if (type === 'IDAT') idat.push(body);
    else if (type === 'IEND') break;
    at += 12 + len;
  }
  const ch = CHANNELS[colorType];
  if (ch === undefined || width === 0 || height === 0) throw new Error('unsupported PNG header');
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * ch;
  if (raw.length < height * (stride + 1)) throw new Error('PNG data too short');
  const cur = new Uint8Array(stride);
  let prev = new Uint8Array(stride);
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!;
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= ch ? cur[i - ch]! : 0;
      const b = prev[i]!;
      const c = i >= ch ? prev[i - ch]! : 0;
      const x = line[i]!;
      cur[i] =
        filter === 0 ? x : filter === 1 ? x + a : filter === 2 ? x + b : filter === 3 ? x + ((a + b) >> 1) : x + paeth(a, b, c);
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      const p = x * ch;
      let r: number, g: number, bl: number, al: number;
      if (colorType === 0) [r, g, bl, al] = [cur[p]!, cur[p]!, cur[p]!, 255];
      else if (colorType === 2) [r, g, bl, al] = [cur[p]!, cur[p + 1]!, cur[p + 2]!, 255];
      else if (colorType === 3) {
        const k = cur[p]! * 3;
        [r, g, bl, al] = [palette[k] ?? 0, palette[k + 1] ?? 0, palette[k + 2] ?? 0, trns[cur[p]!] ?? 255];
      } else if (colorType === 4) [r, g, bl, al] = [cur[p]!, cur[p]!, cur[p]!, cur[p + 1]!];
      else [r, g, bl, al] = [cur[p]!, cur[p + 1]!, cur[p + 2]!, cur[p + 3]!];
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = bl;
      rgba[o + 3] = al;
    }
    prev = Uint8Array.from(cur);
  }
  return { width, height, rgba };
}

/** Alpha (0..255) of the pixel at (x, y). */
export function alphaAt(img: PngImage, x: number, y: number): number {
  return img.rgba[(y * img.width + x) * 4 + 3] ?? 0;
}
