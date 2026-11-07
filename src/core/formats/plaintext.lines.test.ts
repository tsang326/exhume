import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import { numRuns } from '../../test-support/runs';
import { convertPlainText } from './plaintext';

const ENDINGS = ['\r\n', '\r', '\n'] as const;

/**
 * Printable ASCII (0x20..0x7E), never empty: an empty line between a lone CR and an
 * LF ending would make the bytes `\r\n`, which is one CRLF and not two breaks.
 */
const lineArb = fc.string({
  unit: fc.integer({ min: 0x20, max: 0x7e }).map((c) => String.fromCharCode(c)),
  minLength: 1,
  maxLength: 40,
});

const endingArb = fc.constantFrom(...ENDINGS);

/** Lines, one ending between each pair, and an optional trailing ending. */
const docArb = fc
  .tuple(fc.array(lineArb, { minLength: 1, maxLength: 12 }), fc.boolean(), endingArb)
  .chain(([lines, trailing, lastEnding]) =>
    fc
      .array(endingArb, { minLength: lines.length - 1, maxLength: lines.length - 1 })
      .map((between) => ({ lines, between, trailing, lastEnding })),
  );

function asBytes(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i);
  return out;
}

describe('plain text line endings', () => {
  // Feature: plain-text, Property 4: Line ending forms are equivalent
  // **Validates: Requirements 1.4, 1.5, 1.6**
  it('treats CRLF, lone CR and lone LF as the same line break', () => {
    fc.assert(
      fc.property(docArb, ({ lines, between, trailing, lastEnding }) => {
        let input = '';
        let expected = '';
        lines.forEach((line, i) => {
          input += line;
          expected += line;
          if (i < lines.length - 1) {
            input += between[i]!;
            expected += '\n';
          }
        });
        if (trailing) {
          input += lastEnding;
          expected += '\n';
        }
        const r = convertPlainText(asBytes(input));
        return r.ok && r.output === expected;
      }),
      { numRuns: numRuns(100) },
    );
  });
});
