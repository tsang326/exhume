import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import { numRuns } from '../../test-support/runs';
import { timed } from '../../test-support/timed';
import { referenceRle } from '../../test-support/formats/oracles';
import { decodeRle } from './pcx-rle';

/**
 * Feature: format-resurrection, Property 27: The RLE decoder agrees with a reference model
 * **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5**
 */

type Token = { kind: 'lit'; byte: number } | { kind: 'run'; count: number; value: number };

const tokenArb: fc.Arbitrary<Token> = fc.oneof(
  { weight: 3, arbitrary: fc.integer({ min: 0, max: 0xbf }).map((byte): Token => ({ kind: 'lit', byte })) },
  {
    weight: 3,
    arbitrary: fc
      .record({ count: fc.integer({ min: 0, max: 63 }), value: fc.integer({ min: 0, max: 255 }) })
      .map(({ count, value }): Token => ({ kind: 'run', count, value })),
  },
  // Literal 0xC0 data byte after a run byte, and extreme counts.
  { weight: 1, arbitrary: fc.constantFrom<Token>({ kind: 'run', count: 0, value: 0xc0 }, { kind: 'run', count: 63, value: 0xff }, { kind: 'run', count: 1, value: 0xc0 }) },
);

interface Built {
  stream: Uint8Array;
  /** Stream offset just after each token. */
  ends: number[];
  /** Decoded length of each token. */
  sizes: number[];
}

function build(tokens: Token[]): Built {
  const bytes: number[] = [];
  const ends: number[] = [];
  const sizes: number[] = [];
  for (const t of tokens) {
    if (t.kind === 'lit') {
      bytes.push(t.byte);
      sizes.push(1);
    } else {
      bytes.push(0xc0 | t.count, t.value);
      sizes.push(t.count);
    }
    ends.push(bytes.length);
  }
  return { stream: Uint8Array.from(bytes), ends, sizes };
}

/** Stream offset just after the token that completes `target`, or -1. */
function completionEnd(b: Built, target: number): number {
  let acc = 0;
  for (let i = 0; i < b.sizes.length; i++) {
    acc += b.sizes[i];
    if (acc >= target) return b.ends[i];
  }
  return -1;
}

function pad(stream: Uint8Array, before: Uint8Array, after: Uint8Array): Uint8Array {
  const out = new Uint8Array(before.length + stream.length + after.length);
  out.set(before, 0);
  out.set(stream, before.length);
  out.set(after, before.length + stream.length);
  return out;
}

const bytesArb = fc.uint8Array({ maxLength: 16 });
const targetArb = fc.integer({ min: 1, max: 4096 });
const tokensArb = fc.array(tokenArb, { maxLength: 200 });

function agrees(
  input: Uint8Array,
  start: number,
  limit: number,
  target: number,
  stream: Uint8Array,
): boolean {
  const r = decodeRle(input, start, limit, target);
  const o = referenceRle(stream, target);
  if (r.data.length !== target) return false;
  if (r.filled !== o.filled || r.truncated !== o.truncated) return false;
  if (r.consumed < start || r.consumed > limit) return false;
  for (let i = 0; i < target; i++) if (r.data[i] !== o.data[i]) return false;
  return true;
}

describe('Property 27: PCX RLE decoder agrees with the reference model', () => {
  it('matches the oracle with arbitrary start/limit, optional lone final run byte, and ignores outside bytes', () => {
    fc.assert(
      fc.property(
        tokensArb,
        fc.option(fc.integer({ min: 0xc0, max: 0xff }), { nil: undefined }),
        targetArb,
        bytesArb,
        bytesArb,
        (tokens, lone, target, before, after) => {
          const b = build(tokens);
          const stream = lone === undefined ? b.stream : Uint8Array.of(...b.stream, lone);
          const input = pad(stream, before, after);
          const start = before.length;
          const limit = start + stream.length;
          if (!agrees(input, start, limit, target, stream)) return false;

          // Bytes outside [start, limit) are never read.
          const mutated = input.map((v, i) => (i < start || i >= limit ? (v ^ 0xa5) & 0xff : v));
          const a = decodeRle(input, start, limit, target);
          const m = decodeRle(mutated, start, limit, target);
          if (a.filled !== m.filled || a.consumed !== m.consumed || a.truncated !== m.truncated) return false;
          for (let i = 0; i < target; i++) if (a.data[i] !== m.data[i]) return false;

          // Reading stops at the byte that completes the target.
          const end = completionEnd(b, target);
          if (end >= 0 && !a.truncated && a.consumed > start + end) return false;
          return true;
        },
      ),
      { numRuns: numRuns(300) },
    );
  });

  it('stops at the target on streams much longer than the target, ignoring the excess', () => {
    fc.assert(
      fc.property(
        fc.array(tokenArb, { minLength: 100, maxLength: 400 }),
        fc.integer({ min: 1, max: 64 }),
        (tokens, target) => {
          const b = build(tokens);
          const r = decodeRle(b.stream, 0, b.stream.length, target);
          const end = completionEnd(b, target);
          if (end < 0) return agrees(b.stream, 0, b.stream.length, target, b.stream);
          return agrees(b.stream, 0, b.stream.length, target, b.stream) && !r.truncated && r.consumed <= end;
        },
      ),
      { numRuns: numRuns(200) },
    );
  });

  it('a stream ending exactly at the target is complete and fully consumed', () => {
    fc.assert(
      fc.property(tokensArb, (tokens) => {
        const b = build(tokens);
        const total = b.sizes.reduce((s, n) => s + n, 0);
        if (total < 1 || total > 4096) return true;
        const r = decodeRle(b.stream, 0, b.stream.length, total);
        return agrees(b.stream, 0, b.stream.length, total, b.stream) && !r.truncated && r.filled === total;
      }),
      { numRuns: numRuns(200) },
    );
  });

  it('runs crossing scanline boundaries decode as one continuous stream', () => {
    fc.assert(
      fc.property(
        tokensArb,
        fc.integer({ min: 1, max: 64 }),
        fc.integer({ min: 1, max: 64 }),
        (tokens, lineBytes, height) => {
          const target = lineBytes * height;
          const b = build(tokens);
          return agrees(b.stream, 0, b.stream.length, target, b.stream);
        },
      ),
      { numRuns: numRuns(200) },
    );
  });

  it('discards a lone final run byte and flags truncation', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 0, max: 0xbf }), { maxLength: 50 }),
        fc.integer({ min: 0xc0, max: 0xff }),
        fc.integer({ min: 1, max: 100 }),
        (literals, lone, extra) => {
          const target = literals.length + extra;
          const stream = Uint8Array.of(...literals, lone);
          const r = decodeRle(stream, 0, stream.length, target);
          if (!r.truncated || r.filled !== literals.length) return false;
          for (let i = literals.length; i < target; i++) if (r.data[i] !== 0) return false;
          return agrees(stream, 0, stream.length, target, stream);
        },
      ),
      { numRuns: numRuns(100) },
    );
  });

  it('treats a literal 0xC0..0xFF data byte after a run byte as data', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 63 }),
        fc.integer({ min: 0xc0, max: 0xff }),
        (count, value) => {
          const stream = Uint8Array.of(0xc0 | count, value, 5);
          const r = decodeRle(stream, 0, stream.length, count + 1);
          if (r.truncated || r.consumed !== 3) return false;
          for (let i = 0; i < count; i++) if (r.data[i] !== value) return false;
          return r.data[count] === 5;
        },
      ),
      { numRuns: numRuns(100) },
    );
  });

  it('bounds time and output on 4 MiB bomb streams with a small target', () => {
    const bomb = new Uint8Array(4 * 1024 * 1024);
    for (let i = 0; i < bomb.length; i += 2) {
      bomb[i] = 0xff;
      bomb[i + 1] = 0;
    }
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 4096 }), fc.integer({ min: 0, max: 8 }), (target, startPairs) => {
        const start = startPairs * 2;
        const r = timed(() => decodeRle(bomb, start, bomb.length, target));
        return (
          r.data.length === target &&
          r.filled === target &&
          !r.truncated &&
          r.consumed >= start &&
          r.consumed <= start + 2 * Math.ceil(target / 63)
        );
      }),
      { numRuns: numRuns(30) },
    );
  });
});
