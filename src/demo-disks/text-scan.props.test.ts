import fc from 'fast-check';
import { describe, it } from 'vitest';
import { numRuns } from '../test-support/runs';
import { scanLinks, scanPhones, TEXT_SCAN_CAP } from './checks/text-scan';

const digits = (n: number): fc.Arbitrary<string> =>
  fc.array(fc.integer({ min: 0, max: 9 }), { minLength: n, maxLength: n }).map((a) => a.join(''));

interface Token {
  text: string;
  phone: boolean;
  reserved: boolean;
}

const phoneToken: fc.Arbitrary<Token> = fc
  .tuple(fc.oneof(fc.constant('555'), digits(3)), fc.oneof(digits(4), fc.integer({ min: 100, max: 199 }).map((n) => `0${n}`)))
  .map(([prefix, rest]) => ({
    text: `${prefix}-${rest}`,
    phone: true,
    reserved: prefix === '555' && Number(rest) >= 100 && Number(rest) <= 199,
  }));

const dateToken: fc.Arbitrary<Token> = fc
  .tuple(digits(4), digits(2), digits(2))
  .map(([y, m, d]) => ({ text: `${y}-${m}-${d}`, phone: false, reserved: false }));

const amountToken: fc.Arbitrary<Token> = fc
  .tuple(fc.boolean(), fc.integer({ min: 0, max: 99999 }), digits(2))
  .map(([neg, n, c]) => ({ text: `${neg ? '-' : ''}${n}.${c}`, phone: false, reserved: false }));

const wordToken: fc.Arbitrary<Token> = fc
  .stringMatching(/^[A-Za-z]{1,10}$/)
  .map((w) => ({ text: w, phone: false, reserved: false }));

const codeToken: fc.Arbitrary<Token> = fc
  .tuple(fc.stringMatching(/^[A-Z]{2,3}$/), fc.integer({ min: 0, max: 9999 }))
  .map(([l, n]) => ({ text: `${l}-${n}`, phone: false, reserved: false }));

const tokenList = fc.array(fc.oneof(phoneToken, dateToken, amountToken, wordToken, codeToken), {
  maxLength: 30,
});

const fullUnicode = fc.string({ unit: 'binary', maxLength: 300 });
const scannerAlphabet = fc
  .array(fc.constantFrom('0', '5', '1', '9', '-', ' ', '@', 'w', 'W', '.', '/', ':', 'h', 't', 'p', 's', 'a', 'é', '\u{1F480}'), {
    maxLength: 120,
  })
  .map((a) => a.join(''));
const anyText = fc.oneof(fullUnicode, scannerAlphabet);

describe('scanner properties', () => {
  // Feature: demo-disks, Property 1: Phone scan agrees with a token model
  // **Validates: Requirements 8.2, 8.9**
  it('Property 1: phone scan agrees with a token model', () => {
    fc.assert(
      fc.property(tokenList, (tokens) => {
        const text = tokens.map((t) => t.text).join(' ');
        const r = scanPhones(text);
        if (!r.ok) return false;
        const expected = tokens.filter((t) => t.phone);
        if (r.matches.length !== expected.length) return false;
        return r.matches.every((m, i) => {
          const e = expected[i];
          return (
            e !== undefined &&
            m.text === e.text &&
            m.reserved === e.reserved &&
            text.slice(m.index, m.index + 8) === e.text
          );
        });
      }),
      { numRuns: numRuns(100) },
    );
  });

  // Feature: demo-disks, Property 2: Text scans are total, ordered and bounded
  // **Validates: Requirements 8.2, 8.9**
  it('Property 2: scans are total, deterministic, ordered and in range', () => {
    fc.assert(
      fc.property(anyText, (text) => {
        const p1 = scanPhones(text);
        const p2 = scanPhones(text);
        const l1 = scanLinks(text);
        const l2 = scanLinks(text);
        if (!p1.ok || !p2.ok || !l1.ok || !l2.ok) return false;
        if (JSON.stringify(p1) !== JSON.stringify(p2)) return false;
        if (JSON.stringify(l1) !== JSON.stringify(l2)) return false;
        let prevEnd = 0;
        for (const m of p1.matches) {
          if (m.index < prevEnd || m.index + m.text.length > text.length) return false;
          prevEnd = m.index + m.text.length;
        }
        let prev = -1;
        for (const f of l1.findings) {
          if (f.index <= prev || f.index >= text.length) return false;
          prev = f.index;
        }
        return true;
      }),
      { numRuns: numRuns(100) },
    );
  });

  // Feature: demo-disks, Property 2: Text scans are total, ordered and bounded
  // **Validates: Requirements 8.2, 8.9**
  it('Property 2: strings above the cap are refused', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 64 }), fc.constantFrom('a', '5', '-', '@', '\u{1F480}'), (extra, ch) => {
        const text = ch.repeat(Math.ceil((TEXT_SCAN_CAP + extra) / ch.length)).slice(0, TEXT_SCAN_CAP + extra);
        const p = scanPhones(text);
        const l = scanLinks(text);
        return !p.ok && p.reason === 'too-long' && !l.ok && l.reason === 'too-long';
      }),
      { numRuns: numRuns(100) },
    );
  });
});
