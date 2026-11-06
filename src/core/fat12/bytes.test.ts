import { describe, expect, it } from 'vitest';
import { makeByteView } from './bytes';

const bytes = [0x01, 0x02, 0x03, 0xff, 0x80, 0x00];

describe('makeByteView', () => {
  it('reads little endian values', () => {
    const v = makeByteView(new Uint8Array(bytes));
    expect(v.length).toBe(6);
    expect(v.u8(3)).toBe(0xff);
    expect(v.u16(0)).toBe(0x0201);
    expect(v.u32(0)).toBe(0xff030201);
    expect(v.u32(0)!).toBeGreaterThan(0);
  });

  it('returns undefined for out-of-range, negative, fractional and NaN offsets', () => {
    const v = makeByteView(new Uint8Array(bytes));
    for (const bad of [-1, 6, 100, 0.5, NaN, Infinity, -Infinity]) {
      expect(v.u8(bad)).toBeUndefined();
      expect(v.u16(bad)).toBeUndefined();
      expect(v.u32(bad)).toBeUndefined();
      expect(v.copy(bad, 1)).toBeUndefined();
    }
    expect(v.u16(5)).toBeUndefined();
    expect(v.u32(3)).toBeUndefined();
    expect(v.copy(4, 3)).toBeUndefined();
    expect(v.copy(0, -1)).toBeUndefined();
    expect(v.copy(0, 1.5)).toBeUndefined();
    expect(v.copy(0, NaN)).toBeUndefined();
    expect(v.u8(0)).toBe(1);
    expect(v.u16(4)).toBe(0x0080);
    expect(v.u32(2)).toBe(0x0080ff03);
  });

  it('allows empty copies at the end and handles an empty image', () => {
    const v = makeByteView(new Uint8Array(bytes));
    expect(v.copy(6, 0)?.length).toBe(0);
    const e = makeByteView(new Uint8Array(0));
    expect(e.u8(0)).toBeUndefined();
    expect(e.copy(0, 0)?.length).toBe(0);
  });

  it('copy does not alias the image and reads leave it unchanged', () => {
    const image = new Uint8Array(bytes);
    const v = makeByteView(image);
    const c = v.copy(0, 4)!;
    expect(Array.from(c)).toEqual(bytes.slice(0, 4));
    c[0] = 0xaa;
    expect(image[0]).toBe(1);
    expect(v.u8(0)).toBe(1);
    image[1] = 0x55;
    expect(c[1]).toBe(2);
    v.u8(0);
    v.u16(0);
    v.u32(0);
    const fresh = new Uint8Array(bytes);
    fresh[1] = 0x55;
    expect(Array.from(image)).toEqual(Array.from(fresh));
  });

  it('gives the same reads for a Buffer and a Uint8Array', () => {
    const a = makeByteView(new Uint8Array(bytes));
    const b = makeByteView(Buffer.from(bytes));
    expect(b.length).toBe(a.length);
    for (let i = -1; i <= 7; i++) {
      expect(b.u8(i)).toBe(a.u8(i));
      expect(b.u16(i)).toBe(a.u16(i));
      expect(b.u32(i)).toBe(a.u32(i));
      expect(b.copy(i, 2)).toEqual(a.copy(i, 2));
    }
  });
});
