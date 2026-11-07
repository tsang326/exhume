import { FixtureError } from './errors';

/**
 * mono: 1 bit, 1 plane. planar16: 1 bit, 4 planes. packed16: 4 bits, 1 plane.
 * indexed256: 8 bits, 1 plane (palette trailer). rgb24: 8 bits, 3 planes.
 */
export type PcxMode = 'mono' | 'planar16' | 'packed16' | 'indexed256' | 'rgb24';

export interface PcxSource {
  mode: PcxMode;
  width: number; // 1..65535
  height: number; // 1..65535
  /** One palette index per pixel (width * height), for every mode except rgb24. */
  indices?: Uint8Array;
  /** width * height * 3 bytes, rgb24 only. */
  rgb?: Uint8Array;
  /** 48 bytes (header palette) for mono/planar16/packed16, 768 bytes (trailer) for indexed256. */
  palette?: Uint8Array;
  version?: number; // default 5
  /** Extra deterministic bytes after each plane row, 0..64. */
  padding?: number;
}

export const PCX_MAX_SIDE = 65535;
export const PCX_MAX_PADDING = 64;

interface ModeInfo {
  bits: number;
  planes: number;
  colours: number; // number of palette indices allowed (0 = not indexed)
  paletteBytes: number; // expected palette length
}

const MODES: Record<PcxMode, ModeInfo> = {
  mono: { bits: 1, planes: 1, colours: 2, paletteBytes: 48 },
  planar16: { bits: 1, planes: 4, colours: 16, paletteBytes: 48 },
  packed16: { bits: 4, planes: 1, colours: 16, paletteBytes: 48 },
  indexed256: { bits: 8, planes: 1, colours: 256, paletteBytes: 768 },
  rgb24: { bits: 8, planes: 3, colours: 0, paletteBytes: 0 },
};

function isSide(n: unknown): n is number {
  return typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= PCX_MAX_SIDE;
}

/** Run-length encodes one continuous byte stream (runs may cross scanlines). */
function rle(data: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    const b = data[i] as number;
    let n = 1;
    while (n < 63 && i + n < data.length && data[i + n] === b) n++;
    if (n > 1 || b >= 0xc0) out.push(0xc0 | n);
    out.push(b);
    i += n;
  }
  return Uint8Array.from(out);
}

/** Builds a PCX file with a 128-byte header, RLE data and, for 256 colours, a 769-byte trailer. */
export function encodePcx(source: PcxSource): Uint8Array {
  if (source === null || typeof source !== 'object') throw new FixtureError('source', 'expected an object');
  const info = MODES[source.mode];
  if (info === undefined) throw new FixtureError('mode', 'unknown mode');
  const { width, height } = source;
  if (!isSide(width)) throw new FixtureError('width', `integer 1..${PCX_MAX_SIDE}`);
  if (!isSide(height)) throw new FixtureError('height', `integer 1..${PCX_MAX_SIDE}`);
  const version = source.version ?? 5;
  if (!Number.isInteger(version) || version < 0 || version > 255) {
    throw new FixtureError('version', 'integer 0..255');
  }
  const padding = source.padding ?? 0;
  if (!Number.isInteger(padding) || padding < 0 || padding > PCX_MAX_PADDING) {
    throw new FixtureError('padding', `integer 0..${PCX_MAX_PADDING}`);
  }
  const pixels = width * height;
  if (source.mode === 'rgb24') {
    if (!(source.rgb instanceof Uint8Array) || source.rgb.length !== pixels * 3) {
      throw new FixtureError('rgb', 'width * height * 3 bytes');
    }
  } else {
    const idx = source.indices;
    if (!(idx instanceof Uint8Array) || idx.length !== pixels) {
      throw new FixtureError('indices', 'width * height bytes');
    }
    for (let i = 0; i < idx.length; i++) {
      if ((idx[i] as number) >= info.colours) throw new FixtureError('indices', `values below ${info.colours}`);
    }
  }
  let palette = source.palette;
  if (palette !== undefined) {
    if (!(palette instanceof Uint8Array) || palette.length !== info.paletteBytes) {
      throw new FixtureError('palette', `${info.paletteBytes} bytes`);
    }
  } else if (source.mode === 'indexed256') {
    palette = new Uint8Array(768);
    for (let i = 0; i < 256; i++) palette.fill(i, i * 3, i * 3 + 3);
  } else if (source.mode !== 'rgb24') {
    palette = new Uint8Array(48);
  }
  const minBytes = Math.ceil((width * info.bits) / 8);
  let bytesPerLine = minBytes + padding;
  if (bytesPerLine % 2 === 1) bytesPerLine++;
  if (bytesPerLine > 0xffff) throw new FixtureError('width', 'bytes per line above 65535');

  // Plane stream: for each row, for each plane, bytesPerLine bytes.
  const stream = new Uint8Array(height * info.planes * bytesPerLine);
  for (let y = 0; y < height; y++) {
    for (let p = 0; p < info.planes; p++) {
      const base = (y * info.planes + p) * bytesPerLine;
      for (let x = 0; x < width; x++) {
        const at = y * width + x;
        if (source.mode === 'rgb24') {
          stream[base + x] = (source.rgb as Uint8Array)[at * 3 + p] as number;
        } else {
          const v = (source.indices as Uint8Array)[at] as number;
          if (info.bits === 8) stream[base + x] = v;
          else if (info.bits === 4) stream[base + (x >> 1)] |= x % 2 === 0 ? v << 4 : v;
          else stream[base + (x >> 3)] |= ((v >> p) & 1) << (7 - (x & 7));
        }
      }
      for (let k = minBytes; k < bytesPerLine; k++) {
        stream[base + k] = (y * 31 + p * 17 + k * 7) & 0xff;
      }
    }
  }
  const data = rle(stream);
  const trailer = source.mode === 'indexed256' ? 769 : 0;
  const out = new Uint8Array(128 + data.length + trailer);
  const view = new DataView(out.buffer);
  out[0] = 0x0a;
  out[1] = version;
  out[2] = 1;
  out[3] = info.bits;
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, width - 1, true);
  view.setUint16(10, height - 1, true);
  view.setUint16(12, 72, true);
  view.setUint16(14, 72, true);
  if (palette !== undefined && info.paletteBytes === 48) out.set(palette, 16);
  out[65] = info.planes;
  view.setUint16(66, bytesPerLine, true);
  view.setUint16(68, 1, true);
  out.set(data, 128);
  if (source.mode === 'indexed256') {
    out[128 + data.length] = 0x0c;
    out.set(palette as Uint8Array, 128 + data.length + 1);
  }
  return out;
}
