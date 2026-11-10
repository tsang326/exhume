import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import { numRuns } from '../../test-support/runs';
import { hostileInputArb } from '../../test-support/formats/hostile';
import { checkResultInvariants } from '../../test-support/formats/invariants';
import { lineMarkersBalanced } from '../../test-support/formats/oracles';
import { wsBiasedArb } from '../../test-support/formats/ws-biased';
import { convertWordStar, runWordStar } from './wordstar';

const MAX_BYTES = 4096;

const bytesArb: fc.Arbitrary<Uint8Array> = hostileInputArb('wordstar').map((h) => h.bytes.subarray(0, MAX_BYTES));

// Small arrays biased toward WordStar control bytes, dots, markers and text.
const biasedArb: fc.Arbitrary<Uint8Array> = wsBiasedArb;

const inputArb = fc.oneof(bytesArb, biasedArb);
const capArb = fc.oneof(fc.integer({ min: 0, max: 200 }), fc.constantFrom(0, 1, 2, 3, 4, 5, 200));

function warningCount(r: { warnings: readonly { code: string }[] }, code: string): number {
  return r.warnings.filter((w) => w.code === code).length;
}

function alphabetOk(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (!((c >= 0x20 && c <= 0x7e) || c === 0x0a)) return false;
  }
  return true;
}

describe('WordStar output alphabet and cap', () => {
  it('Property 11: output alphabet, length cap and output-capped warning', () => {
    // **Validates: Requirements 3.9, 3.10**
    fc.assert(
      fc.property(inputArb, capArb, (bytes, cap) => {
        const r = runWordStar(bytes, cap);
        const violations = checkResultInvariants(r);
        if (violations.length > 0) throw new Error(violations.join('; '));
        if (!r.ok) throw new Error('runWordStar failed: ' + r.error);
        if (typeof r.output !== 'string') return false;
        if (!alphabetOk(r.output)) return false;
        if (r.output.length > cap) return false;

        const full = runWordStar(bytes, 1_000_000);
        if (!full.ok || typeof full.output !== 'string') return false;
        const cappedCount = warningCount(r, 'output-capped');
        if (full.output.length > cap) {
          if (cappedCount !== 1) return false;
        } else if (cappedCount !== 0) {
          return false;
        }

        // Closing reserve keeps markers balanced on every line.
        for (const line of r.output.split('\n')) {
          if (!lineMarkersBalanced(line)) return false;
        }
        return true;
      }),
      { numRuns: numRuns(300) },
    );
  });

  it('convertWordStar output uses the same alphabet and passes the invariants', () => {
    // **Validates: Requirements 3.9, 3.10**
    fc.assert(
      fc.property(inputArb, (bytes) => {
        const r = convertWordStar(bytes);
        const violations = checkResultInvariants(r);
        if (violations.length > 0) throw new Error(violations.join('; '));
        if (!r.ok || typeof r.output !== 'string') return false;
        return alphabetOk(r.output) && warningCount(r, 'output-capped') === 0;
      }),
      { numRuns: numRuns(200) },
    );
  });
});
