/**
 * Bounded PCX RLE decoder (Requirements 10.1 to 10.5, 12.3).
 *
 * The caller has already checked `totalBytes <= MAX_PCX_DECODED_BYTES`.
 * The stream is one continuous stream: runs may cross scanline boundaries
 * but are cut at `totalBytes`.
 */

export interface RleResult {
  /** Zero-filled, length `totalBytes`, allocated once. */
  data: Uint8Array;
  /** Bytes actually decoded (at most `totalBytes`). */
  filled: number;
  /** Input position after the last byte actually used. */
  consumed: number;
  /** True when the stream ended before `totalBytes` bytes were decoded. */
  truncated: boolean;
}

export function decodeRle(
  input: Uint8Array,
  start: number,
  limit: number,
  totalBytes: number,
): RleResult {
  const data = new Uint8Array(totalBytes);
  let pos = start;
  let w = 0;
  while (w < totalBytes && pos < limit) {
    const b = input[pos++];
    if (b >= 0xc0) {
      if (pos >= limit) break; // lone run byte at the end: discard
      const v = input[pos++];
      const end = Math.min(w + (b & 0x3f), totalBytes);
      if (end > w) {
        data.fill(v, w, end);
        w = end;
      }
    } else {
      data[w++] = b;
    }
  }
  return { data, filled: w, consumed: pos, truncated: w < totalBytes };
}
