/**
 * Chainable CRC-32 (PNG/zlib) and Adler-32 (zlib) checksums.
 *
 * State representation:
 * - CRC-32: the state is the *finalised* CRC value as an unsigned 32-bit
 *   number. Start a new computation with 0; feed the returned value back in to
 *   continue across segments. Internally the value is XORed with 0xFFFFFFFF on
 *   entry and exit.
 * - Adler-32: the state is the packed value `(b << 16) | a` as an unsigned
 *   32-bit number. Start a new computation with 1; feed the returned value
 *   back in to continue across segments.
 *
 * `start` and `end` select the half-open byte range [start, end) of `buf`;
 * they default to the whole buffer and are clamped to its bounds.
 */

/** CRC-32 reflected polynomial. */
export const CRC32_POLYNOMIAL = 0xedb88320;
/** Largest Adler-32 prime modulus. */
export const ADLER_MODULUS = 65521;
/**
 * Largest n such that 255*n*(n+1)/2 + (n+1)*(65521-1) <= 2^32 - 1, so the
 * accumulators cannot overflow 32 bits between reductions.
 */
export const ADLER_NMAX = 5552;

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (c >>> 1) ^ CRC32_POLYNOMIAL : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function clampRange(buf: Uint8Array, start: number | undefined, end: number | undefined): [number, number] {
  const s = start === undefined ? 0 : Math.max(0, Math.min(buf.length, start));
  const e = end === undefined ? buf.length : Math.max(s, Math.min(buf.length, end));
  return [s, e];
}

/** Continue a CRC-32 over buf[start, end). Pass 0 as `crc` to begin. */
export function crc32Update(crc: number, buf: Uint8Array, start?: number, end?: number): number {
  const [s, e] = clampRange(buf, start, end);
  let c = (crc ^ 0xffffffff) >>> 0;
  for (let i = s; i < e; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** CRC-32 of a whole buffer. */
export function crc32(buf: Uint8Array): number {
  return crc32Update(0, buf);
}

/** Continue an Adler-32 over buf[start, end). Pass 1 as `adler` to begin. */
export function adler32Update(adler: number, buf: Uint8Array, start?: number, end?: number): number {
  const [s, e] = clampRange(buf, start, end);
  let a = adler & 0xffff;
  let b = (adler >>> 16) & 0xffff;
  let i = s;
  while (i < e) {
    const runEnd = Math.min(e, i + ADLER_NMAX);
    for (; i < runEnd; i++) {
      a += buf[i];
      b += a;
    }
    a %= ADLER_MODULUS;
    b %= ADLER_MODULUS;
  }
  return ((b << 16) | a) >>> 0;
}

/** Adler-32 of a whole buffer. */
export function adler32(buf: Uint8Array): number {
  return adler32Update(1, buf);
}
