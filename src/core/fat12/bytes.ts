/** Bounds-checked byte access over an untrusted image. No other module indexes the image directly. */

export interface ByteView {
  readonly length: number;
  u8(offset: number): number | undefined;
  /** Little endian. */
  u16(offset: number): number | undefined;
  /** Little endian, returned as an unsigned number. */
  u32(offset: number): number | undefined;
  /** Fresh copy, so callers never alias the image. undefined when any byte is out of range. */
  copy(offset: number, length: number): Uint8Array | undefined;
}

function isIndex(n: number): boolean {
  return typeof n === 'number' && Number.isSafeInteger(n) && n >= 0;
}

export function makeByteView(image: Uint8Array): ByteView {
  const total = image.length;

  // True when [offset, offset + count) lies inside the image.
  const inRange = (offset: number, count: number): boolean =>
    isIndex(offset) && isIndex(count) && offset <= total && count <= total - offset;

  const u8 = (offset: number): number | undefined => {
    if (!isIndex(offset) || offset >= total) return undefined;
    return image[offset];
  };

  return {
    length: total,
    u8,
    u16(offset: number): number | undefined {
      if (!inRange(offset, 2)) return undefined;
      return image[offset]! | (image[offset + 1]! << 8);
    },
    u32(offset: number): number | undefined {
      if (!inRange(offset, 4)) return undefined;
      // Multiply for the top byte so the result stays unsigned.
      return (
        image[offset]! +
        image[offset + 1]! * 0x100 +
        image[offset + 2]! * 0x10000 +
        image[offset + 3]! * 0x1000000
      );
    },
    copy(offset: number, length: number): Uint8Array | undefined {
      if (!inRange(offset, length)) return undefined;
      const out = new Uint8Array(length);
      for (let i = 0; i < length; i++) out[i] = image[offset + i]!;
      return out;
    },
  };
}
