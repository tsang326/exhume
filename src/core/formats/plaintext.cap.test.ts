import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import { numRuns } from '../../test-support/runs';
import { plainTextBytesArb } from '../../test-support/formats/arbitraries';
import { utf8ByteLength } from '../../test-support/formats/invariants';
import { runPlainText } from './plaintext';
import { ConversionWarningCode } from './types';

const HUGE = 100_000_000;

const inputArb: fc.Arbitrary<Uint8Array> = fc.oneof(
  plainTextBytesArb,
  fc.uint8Array({ maxLength: 400 }),
  // High-half bytes decode to 2- and 3-byte UTF-8 characters.
  fc.uint8Array({ minLength: 1, maxLength: 400 }).map((a) => a.map((b) => 0x80 | b)),
);

function check(input: Uint8Array, cap: number): boolean {
  const full = runPlainText(input, HUGE);
  const capped = runPlainText(input, cap);
  if (!full.ok || !capped.ok) return false;

  const out = capped.output;
  if (utf8ByteLength(out) > cap) return false;
  if (!full.output.startsWith(out)) return false;

  const warned = capped.warnings.some(
    (x) => x.code === ConversionWarningCode.OutputCapped && x.message.includes(String(cap)),
  );
  const shorter = out.length < full.output.length;
  if (warned !== shorter) return false;

  if (shorter) {
    // The next character of the uncapped output must not have fit.
    const next = String.fromCodePoint(full.output.codePointAt(out.length) as number);
    if (utf8ByteLength(out) + utf8ByteLength(next) <= cap) return false;
  }
  return true;
}

describe('plain text output cap', () => {
  // Feature: plain-text, Property 7: Output cap at a character boundary
  // **Validates: Requirements 3.3**
  it('caps the output at a character boundary and says so', () => {
    fc.assert(
      fc.property(inputArb, fc.nat(600), (input, cap) => check(input, cap)),
      { numRuns: numRuns(100) },
    );
  });
});
