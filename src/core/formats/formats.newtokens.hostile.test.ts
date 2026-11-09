import { describe, it } from 'vitest';
import fc from 'fast-check';
import { convertAuto, convertWordStar, detectFormat } from './index';
import { CONVERT_TIME_BUDGET_MS } from './limits';
import { checkResultInvariants } from '../../test-support/formats/invariants';
import { numRuns } from '../../test-support/runs';
import { timed } from '../../test-support/timed';

// Feature: real-disk-hardening, Property 12: Totality on hostile input
// **Property 12: Totality on hostile input**
// **Validates: Requirements 1.10, 5.5, 11.4**
// Dedicated grammar for the tokens task 3.2 added: soft hyphen 0x1F, 0xA0, soft return after a
// soft hyphen, and an MZ/ZM prefix. Mixed with ordinary spaces, text and noise.

const TOKENS: number[][] = [
  [0x1f], [0x9f], [0xa0], [0x20], [0x20, 0xa0], [0xa0, 0x20], [0x1f, 0x8d, 0x0a], [0x1f, 0x0d, 0x0a],
  [0x8d, 0x0a], [0x0d, 0x0a], [0x41, 0x42], [0x2e, 0x50, 0x41, 0x0d, 0x0a], [0x00], [0x01], [0x4d, 0x5a],
];
const PREFIXES: number[][] = [[], [], [0x4d, 0x5a], [0x5a, 0x4d]];

const newTokensArb: fc.Arbitrary<Uint8Array> = fc
  .tuple(
    fc.constantFrom(...PREFIXES),
    fc.array(
      fc.oneof(fc.constantFrom(...TOKENS), fc.integer({ min: 0, max: 255 }).map((n) => [n])),
      { minLength: 0, maxLength: 300 },
    ),
  )
  .map(([prefix, tokens]) => Uint8Array.from([...prefix, ...tokens.flat()]));

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function check(name: string, bytes: Uint8Array, call: (b: Uint8Array) => unknown, contract: boolean): boolean {
  const before = bytes.slice();
  const result = timed(() => call(bytes), CONVERT_TIME_BUDGET_MS);
  if (!sameBytes(before, bytes)) throw new Error(`${name}: modified its input`);
  if (contract) {
    const violations = checkResultInvariants(result);
    if (violations.length > 0) throw new Error(`${name}: ${violations.join('; ')}`);
  }
  return true;
}

describe('hostile WordStar input with soft hyphen, 0xA0 and MZ tokens', () => {
  it('detectFormat, convertWordStar and convertAuto are total and honour the contract', () => {
    fc.assert(
      fc.property(newTokensArb, (bytes) => {
        check('detectFormat', bytes, (b) => detectFormat(b), false);
        check('convertWordStar', bytes, (b) => convertWordStar(b), true);
        check('convertAuto', bytes, (b) => convertAuto(b), true);
        return true;
      }),
      { numRuns: numRuns(100) },
    );
  });
});
