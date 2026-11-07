import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { numRuns } from '../test-support/runs';
import { createLineReader, type LineEvent } from './line-reader';

const LF = 10;
const CR = 13;
const A = 97;

type Simple = { kind: 'line'; text: number[] } | { kind: 'overflow' };

function simplify(events: LineEvent[]): Simple[] {
  return events.map((e) => (e.kind === 'line' ? { kind: 'line', text: Array.from(e.bytes) } : { kind: 'overflow' }));
}

function run(chunks: Uint8Array[], cap: number): Simple[] {
  const reader = createLineReader(cap);
  const out: LineEvent[] = [];
  for (const chunk of chunks) out.push(...reader.push(chunk));
  out.push(...reader.end());
  return simplify(out);
}

function split(bytes: number[], cuts: number[]): Uint8Array[] {
  const points = [...new Set(cuts.map((c) => (bytes.length === 0 ? 0 : c % (bytes.length + 1))))].sort((a, b) => a - b);
  const chunks: Uint8Array[] = [];
  let prev = 0;
  for (const p of points) {
    chunks.push(Uint8Array.from(bytes.slice(prev, p)));
    prev = p;
  }
  chunks.push(Uint8Array.from(bytes.slice(prev)));
  return chunks;
}

// Reference: split at LF; a segment over the cap is one overflow; else drop one trailing CR.
function reference(bytes: number[], cap: number): Simple[] {
  const out: Simple[] = [];
  let seg: number[] = [];
  const finish = (isFinal: boolean): void => {
    if (seg.length > cap) {
      out.push({ kind: 'overflow' });
    } else if (!isFinal || seg.length > 0) {
      const end = seg.length > 0 && seg[seg.length - 1] === CR ? seg.length - 1 : seg.length;
      out.push({ kind: 'line', text: seg.slice(0, end) });
    }
    seg = [];
  };
  for (const b of bytes) {
    if (b === LF) finish(false);
    else seg.push(b);
  }
  finish(true);
  return out;
}

const bytesArb = fc.array(fc.constantFrom(LF, CR, A, 98), { maxLength: 80 });
const cutsArb = fc.array(fc.nat(200), { maxLength: 12 });

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const lineOf = (s: string): Simple => ({ kind: 'line', text: Array.from(enc(s)) });

describe('line reader properties', () => {
  // Feature: mcp-server, Property 9: The line reader frames bytes the same way whatever the chunking
  // **Validates: Requirements 2.1, 2.4, 2.6, 2.10**
  it('frames identically for any chunking and matches the reference, including overflow', () => {
    fc.assert(
      fc.property(bytesArb, cutsArb, fc.integer({ min: 1, max: 12 }), (bytes, cuts, cap) => {
        const chunked = run(split(bytes, cuts), cap);
        const whole = run([Uint8Array.from(bytes)], cap);
        const ref = reference(bytes, cap);
        return JSON.stringify(chunked) === JSON.stringify(ref) && JSON.stringify(whole) === JSON.stringify(ref);
      }),
      { numRuns: numRuns(300) },
    );
  });

  // Feature: mcp-server, Property 9: The line reader frames bytes the same way whatever the chunking
  // **Validates: Requirements 2.1, 2.4, 2.6, 2.10**
  it('emits exactly one overflow per over-cap line and keeps following lines intact', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 8 }), fc.integer({ min: 1, max: 30 }), cutsArb, (cap, extra, cuts) => {
        const long = new Array<number>(cap + extra).fill(A);
        const stream = [...long, LF, 98, LF];
        const events = run(split(stream, cuts), cap);
        return (
          events.length === 2 &&
          events[0].kind === 'overflow' &&
          events[1].kind === 'line' &&
          events[1].text.length === 1 &&
          events[1].text[0] === 98
        );
      }),
      { numRuns: numRuns(100) },
    );
  });
});

describe('line reader examples', () => {
  it('removes one trailing CR for CRLF', () => {
    expect(run([enc('ab\r\ncd\n')], 100)).toEqual([lineOf('ab'), lineOf('cd')]);
  });

  it('removes only one CR', () => {
    expect(run([enc('ab\r\r\n')], 100)).toEqual([lineOf('ab\r')]);
  });

  it('delivers empty lines', () => {
    expect(run([enc('\n\r\n\n')], 100)).toEqual([lineOf(''), lineOf(''), lineOf('')]);
  });

  it('accepts a line of exactly the cap', () => {
    expect(run([enc('abcd\n')], 4)).toEqual([lineOf('abcd')]);
  });

  it('overflows on cap plus 1, then resumes at the next LF', () => {
    expect(run([enc('abcde\nok\n')], 4)).toEqual([{ kind: 'overflow' }, lineOf('ok')]);
  });

  it('counts the CR toward the cap', () => {
    expect(run([enc('abcd\r\n')], 4)).toEqual([{ kind: 'overflow' }]);
  });

  it('handles one-byte chunks', () => {
    const chunks = Array.from(enc('ab\r\ncd\nlongline\nz')).map((b) => Uint8Array.of(b));
    expect(run(chunks, 5)).toEqual([lineOf('ab'), lineOf('cd'), { kind: 'overflow' }, lineOf('z')]);
  });

  it('delivers a final line without LF on end()', () => {
    const reader = createLineReader(10);
    expect(reader.push(enc('abc'))).toEqual([]);
    expect(simplify(reader.end())).toEqual([lineOf('abc')]);
    expect(reader.end()).toEqual([]);
  });

  it('discards an unterminated over-cap line at end()', () => {
    const reader = createLineReader(3);
    expect(simplify(reader.push(enc('abcdef')))).toEqual([{ kind: 'overflow' }]);
    expect(reader.push(enc('more'))).toEqual([]);
    expect(reader.end()).toEqual([]);
  });
});
