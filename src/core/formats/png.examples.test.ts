import { describe, expect, it } from 'vitest';
import { MAX_PNG_BYTES } from './limits';
import { encodePng } from './png';
import type { PngResult, RgbaImage } from './types';
import { checkResultInvariants } from '../../test-support/formats/invariants';
import { timed } from '../../test-support/timed';

function ok(result: PngResult): Uint8Array {
  if (!result.ok) throw new Error('expected success: ' + result.error);
  return result.output;
}

function u32(b: Uint8Array, at: number): number {
  return ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
}

function chunks(b: Uint8Array): Array<{ type: string; len: number; end: number }> {
  const out: Array<{ type: string; len: number; end: number }> = [];
  let pos = 8;
  while (pos < b.length) {
    const len = u32(b, pos);
    const type = String.fromCharCode(b[pos + 4], b[pos + 5], b[pos + 6], b[pos + 7]);
    pos += 12 + len;
    out.push({ type, len, end: pos });
  }
  return out;
}

describe('encodePng examples', () => {
  const one: RgbaImage = { width: 1, height: 1, rgba: new Uint8Array([10, 20, 30, 40]) };
  const bytes = ok(encodePng(one));

  it('writes the 8-byte PNG signature', () => {
    expect(Array.from(bytes.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  it('orders chunks IHDR, one IDAT, IEND with nothing after IEND', () => {
    const cs = chunks(bytes);
    expect(cs.map((c) => c.type)).toEqual(['IHDR', 'IDAT', 'IEND']);
    expect(cs[cs.length - 1].end).toBe(bytes.length);
  });

  it('starts the IDAT with zlib header 0x78 0x01 and a 5-byte filtered stream', () => {
    const idatAt = 8 + 12 + 13;
    const len = u32(bytes, idatAt);
    const data = bytes.subarray(idatAt + 8, idatAt + 8 + len);
    expect(data[0]).toBe(0x78);
    expect(data[1]).toBe(0x01);
    // final stored block header: BFINAL=1, LEN=5, NLEN=~5
    expect(Array.from(data.subarray(2, 7))).toEqual([1, 5, 0, 0xfa, 0xff]);
    expect(Array.from(data.subarray(7, 12))).toEqual([0, 10, 20, 30, 40]);
    expect(len).toBe(2 + 5 + 5 + 4);
  });

  it('passes the result invariants', () => {
    expect(checkResultInvariants(encodePng(one))).toEqual([]);
  });
});

describe('encodePng invalid images', () => {
  const rgba = (n: number) => new Uint8Array(n);
  const cases: Array<[string, unknown]> = [
    ['null', null],
    ['non-integer width', { width: 1.5, height: 1, rgba: rgba(6) }],
    ['width 0', { width: 0, height: 1, rgba: rgba(0) }],
    ['width 4097', { width: 4097, height: 1, rgba: rgba(4097 * 4) }],
    ['height 4097', { width: 1, height: 4097, rgba: rgba(4097 * 4) }],
    ['2049x2048 over pixel cap', { width: 2049, height: 2048, rgba: rgba(1) }],
    ['rgba wrong length', { width: 2, height: 2, rgba: rgba(15) }],
    ['rgba not a Uint8Array', { width: 1, height: 1, rgba: [1, 2, 3, 4] }],
  ];

  for (const [name, input] of cases) {
    it(`rejects ${name}`, () => {
      let result: PngResult | undefined;
      expect(() => {
        result = encodePng(input as RgbaImage);
      }).not.toThrow();
      expect(result?.ok).toBe(false);
      if (result && !result.ok) expect(result.error).toBe('PNG input invalid');
      expect(checkResultInvariants(result)).toEqual([]);
    });
  }

  it('does not modify the input', () => {
    const pixels = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const copy = pixels.slice();
    const image = { width: 2, height: 1, rgba: pixels };
    ok(encodePng(image));
    expect(image).toEqual({ width: 2, height: 1, rgba: copy });
    const bad = { width: 3, height: 1, rgba: pixels };
    encodePng(bad);
    expect(Array.from(pixels)).toEqual(Array.from(copy));
    expect(bad.width).toBe(3);
  });
});

describe('encodePng size extremes', () => {
  it('encodes 4096 by 1 within MAX_PNG_BYTES', () => {
    const image: RgbaImage = { width: 4096, height: 1, rgba: new Uint8Array(4096 * 4) };
    const result = timed(() => encodePng(image), 10000);
    expect(ok(result).length).toBeLessThanOrEqual(MAX_PNG_BYTES);
    expect(checkResultInvariants(result)).toEqual([]);
  });

  it('encodes 2048 by 2048 within MAX_PNG_BYTES', () => {
    const image: RgbaImage = { width: 2048, height: 2048, rgba: new Uint8Array(2048 * 2048 * 4) };
    const result = timed(() => encodePng(image), 10000);
    expect(ok(result).length).toBeLessThanOrEqual(MAX_PNG_BYTES);
    expect(checkResultInvariants(result)).toEqual([]);
  });
});
