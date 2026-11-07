// Pure state machine: byte chunks in, line events out, bounded memory.
// No process I/O. UTF-8 validity is checked later, in handleLine.

import { BYTE_CR, BYTE_LF, MAX_LINE_BYTES } from './limits';

export type LineEvent =
  | { kind: 'line'; bytes: Uint8Array } // content before LF, one trailing CR removed
  | { kind: 'overflow' }; // a line exceeded the cap; its bytes are being discarded

export interface LineReader {
  push(chunk: Uint8Array): LineEvent[];
  end(): LineEvent[]; // flush a final line that had no LF
}

export function createLineReader(maxLineBytes: number = MAX_LINE_BYTES): LineReader {
  let parts: Uint8Array[] = [];
  let held = 0;
  let discarding = false;

  const takeLine = (): LineEvent => {
    const joined = new Uint8Array(held);
    let at = 0;
    for (const part of parts) {
      joined.set(part, at);
      at += part.length;
    }
    parts = [];
    held = 0;
    const end = joined.length > 0 && joined[joined.length - 1] === BYTE_CR ? joined.length - 1 : joined.length;
    return { kind: 'line', bytes: joined.subarray(0, end) };
  };

  const push = (chunk: Uint8Array): LineEvent[] => {
    const events: LineEvent[] = [];
    let pos = 0;
    while (pos <= chunk.length) {
      const idx = chunk.indexOf(BYTE_LF, pos);
      const stop = idx === -1 ? chunk.length : idx;
      const segment = chunk.subarray(pos, stop);
      if (discarding) {
        // drop the bytes
      } else if (held + segment.length > maxLineBytes) {
        discarding = true;
        parts = [];
        held = 0;
        events.push({ kind: 'overflow' });
      } else if (segment.length > 0) {
        parts.push(segment.slice());
        held += segment.length;
      }
      if (idx === -1) break;
      if (discarding) {
        discarding = false; // resync at the next line
      } else {
        events.push(takeLine());
      }
      pos = idx + 1;
    }
    return events;
  };

  const end = (): LineEvent[] => {
    if (discarding) {
      discarding = false;
      parts = [];
      held = 0;
      return [];
    }
    if (held > 0) return [takeLine()];
    return [];
  };

  return { push, end };
}
