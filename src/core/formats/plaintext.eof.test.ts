import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import { numRuns } from '../../test-support/runs';
import { plainTextBytesArb } from '../../test-support/formats/arbitraries';
import { convertPlainText } from './plaintext';

const EOF = 0x1a;

function withoutEof(bytes: Uint8Array): Uint8Array {
  return Uint8Array.from(bytes.filter((b) => b !== EOF));
}

const headArb: fc.Arbitrary<Uint8Array> = fc.oneof(
  plainTextBytesArb.map(withoutEof),
  fc.uint8Array({ maxLength: 400 }).map(withoutEof),
);
const tailArb: fc.Arbitrary<Uint8Array> = fc.oneof(
  fc.uint8Array({ maxLength: 400 }),
  plainTextBytesArb,
);

function concat(head: Uint8Array, tail: Uint8Array): Uint8Array {
  const out = new Uint8Array(head.length + 1 + tail.length);
  out.set(head, 0);
  out[head.length] = EOF;
  out.set(tail, head.length + 1);
  return out;
}

describe('plain text EOF truncation', () => {
  // Feature: plain-text, Property 3: Nothing after the first EOF byte matters
  // **Validates: Requirements 1.9, 1.11**
  it('ignores every byte after the first EOF byte', () => {
    fc.assert(
      fc.property(headArb, tailArb, (head, tail) => {
        const full = convertPlainText(concat(head, tail));
        const cut = convertPlainText(concat(head, new Uint8Array(0)));
        const bare = convertPlainText(head);
        const same = JSON.stringify(full) === JSON.stringify(cut);
        const sameAsHead = JSON.stringify(full) === JSON.stringify(bare);
        return same && sameAsHead;
      }),
      { numRuns: numRuns(100) },
    );
  });
});
