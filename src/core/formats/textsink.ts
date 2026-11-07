// Chunked UTF-16 buffer that builds a string and counts its UTF-8 length.

import { TEXT_CHUNK_BYTES, U16_MAX } from './limits';

export interface TextSink {
  /** UTF-8 bytes of the text written so far. Equal to the unit count while only ASCII is written. */
  readonly length: number;
  /** Append one UTF-16 code unit (0..U16_MAX). Callers that write ASCII behave exactly as before. */
  push(code: number): void;
  /** Append every UTF-16 unit of `s`. */
  pushString(s: string): void;
  /**
   * Append the longest prefix of `s` that keeps `length <= maxBytes`, never splitting a surrogate pair.
   * Returns the number of UTF-16 units appended; a result below `s.length` means the cap was hit.
   */
  pushStringCapped(s: string, maxBytes: number): number;
  /** Return the whole text. */
  finish(): string;
}

const ASCII_END = 0x80;
const TWO_BYTE_END = 0x800;
const HIGH_SURROGATE_START = 0xd800;
const LOW_SURROGATE_START = 0xdc00;
const SURROGATE_END = 0xe000;

function isHigh(unit: number): boolean {
  return unit >= HIGH_SURROGATE_START && unit < LOW_SURROGATE_START;
}

function isLow(unit: number): boolean {
  return unit >= LOW_SURROGATE_START && unit < SURROGATE_END;
}

export function makeTextSink(): TextSink {
  const pieces: string[] = [];
  const chunk = new Uint16Array(TEXT_CHUNK_BYTES);
  let used = 0;
  let total = 0;
  let prevHigh = false;

  function flush(): void {
    if (used === 0) return;
    const view = used === TEXT_CHUNK_BYTES ? chunk : chunk.subarray(0, used);
    pieces.push(String.fromCharCode.apply(null, view as unknown as number[]));
    used = 0;
  }

  /** UTF-8 cost of one unit given the previous unit. A pair costs 4 (high) + 0 (low). */
  function costOf(unit: number): number {
    if (unit < ASCII_END) return 1;
    if (unit < TWO_BYTE_END) return 2;
    if (isHigh(unit)) return 4;
    if (isLow(unit) && prevHigh) return 0;
    return 3;
  }

  function push(code: number): void {
    const unit = code & U16_MAX;
    if (used === TEXT_CHUNK_BYTES) flush();
    chunk[used++] = unit;
    total += costOf(unit);
    prevHigh = isHigh(unit);
  }

  return {
    get length(): number {
      return total;
    },
    push,
    pushString(s: string): void {
      for (let i = 0; i < s.length; i++) push(s.charCodeAt(i));
    },
    pushStringCapped(s: string, maxBytes: number): number {
      let i = 0;
      while (i < s.length) {
        const unit = s.charCodeAt(i);
        const paired = isHigh(unit) && i + 1 < s.length && isLow(s.charCodeAt(i + 1));
        const cost = paired ? 4 : costOf(unit);
        if (total + cost > maxBytes) break;
        push(unit);
        i++;
        if (paired) {
          push(s.charCodeAt(i));
          i++;
        }
      }
      return i;
    },
    finish(): string {
      flush();
      return pieces.join('');
    },
  };
}
