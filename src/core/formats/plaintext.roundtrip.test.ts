import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import { numRuns } from '../../test-support/runs';
import { plainTextBytesArb } from '../../test-support/formats/arbitraries';
import { encodeCp437 } from '../../test-support/formats/oracles';
import { convertPlainText } from './plaintext';

/** True when converting the CP437 encoding of a successful output gives the same output and no warnings. */
function idempotent(bytes: Uint8Array): boolean {
  const first = convertPlainText(bytes);
  if (!first.ok) return true; // the property covers successful conversions only
  const encoded = encodeCp437(first.output);
  if (encoded === null) return false;
  const second = convertPlainText(encoded);
  return second.ok && second.output === first.output && second.warnings.length === 0;
}

describe('plain text idempotence through CP437', () => {
  // Feature: plain-text, Property 5: Idempotence through the CP437 encoding
  // **Validates: Requirements 1.15**
  it('re-converts its own CP437 encoding to the same output on DOS-style text bytes', () => {
    fc.assert(fc.property(plainTextBytesArb, (bytes) => idempotent(bytes)), {
      numRuns: numRuns(100),
    });
  });

  it('re-converts its own CP437 encoding to the same output on arbitrary bytes', () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 600 }), (bytes) => idempotent(bytes)),
      { numRuns: numRuns(100) },
    );
  });
});
