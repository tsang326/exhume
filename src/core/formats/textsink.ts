// Chunked byte buffer that builds a one-byte-per-character string.

import { TEXT_CHUNK_BYTES } from './limits';

export interface AsciiSink {
  /** Bytes written so far. */
  readonly length: number;
  /** Append one code (0x20..0x7E or 0x0A). */
  push(code: number): void;
  /** Append every UTF-16 unit of `s` as one byte. */
  pushString(s: string): void;
  /** Return the whole text. */
  finish(): string;
}

export function makeAsciiSink(): AsciiSink {
  const pieces: string[] = [];
  const chunk = new Uint8Array(TEXT_CHUNK_BYTES);
  let used = 0;
  let total = 0;

  function flush(): void {
    if (used === 0) return;
    const view = used === TEXT_CHUNK_BYTES ? chunk : chunk.subarray(0, used);
    pieces.push(String.fromCharCode.apply(null, view as unknown as number[]));
    used = 0;
  }

  function push(code: number): void {
    if (used === TEXT_CHUNK_BYTES) flush();
    chunk[used++] = code;
    total++;
  }

  return {
    get length(): number {
      return total;
    },
    push,
    pushString(s: string): void {
      for (let i = 0; i < s.length; i++) push(s.charCodeAt(i));
    },
    finish(): string {
      flush();
      return pieces.join('');
    },
  };
}
