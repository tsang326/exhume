import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { numRuns } from '../test-support/runs';
import { sanitizeCapped, sanitizeText } from './sanitize';

const HIGH = 0xd83d;
const LOW = 0xde00;

// Strings mixing plain text, controls, bidi marks, pairs and lone surrogates.
const unitArb = fc.oneof(
  fc.integer({ min: 0x20, max: 0x7e }),
  fc.constantFrom(0x00, 0x09, 0x0a, 0x0d, 0x1b, 0x7f, 0x85, 0x2028, 0x202e, 0x2066, 0xfeff, 0xfffd, 0xe9, 0x4e2d),
  fc.integer({ min: 0xd800, max: 0xdbff }),
  fc.integer({ min: 0xdc00, max: 0xdfff }),
);
const pairArb = fc
  .tuple(fc.integer({ min: 0xd800, max: 0xdbff }), fc.integer({ min: 0xdc00, max: 0xdfff }))
  .map(([h, l]) => String.fromCharCode(h, l));
const textArb = fc
  .array(fc.oneof(unitArb.map((u) => String.fromCharCode(u)), pairArb), { maxLength: 60 })
  .map((parts) => parts.join(''));

const isHigh = (c: number): boolean => c >= 0xd800 && c <= 0xdbff;

describe('capping properties', () => {
  // Feature: mcp-server, Property 14: Capping cuts on a code point boundary and counts exactly
  // **Validates: Requirements 7.6, 8.9**
  it('returns a bounded prefix of the full sanitized text with exact total and truncated', () => {
    fc.assert(
      fc.property(textArb, fc.boolean(), fc.integer({ min: 0, max: 80 }), (input, multiline, cap) => {
        const opts = { multiline };
        const full = sanitizeText(input, opts);
        const r = sanitizeCapped(input, opts, cap);
        const bounded = r.text.length <= cap;
        const prefix = full.startsWith(r.text);
        const shortBy = Math.min(full.length, cap) - r.text.length;
        const slack = shortBy >= 0 && shortBy <= 1;
        const noTrailingHigh = r.text.length === 0 || !isHigh(r.text.charCodeAt(r.text.length - 1));
        const exact = r.total === full.length && r.truncated === full.length > cap;
        const whole = full.length > cap || r.text === full;
        return bounded && prefix && slack && noTrailingHigh && exact && whole;
      }),
      { numRuns: numRuns(300) },
    );
  });
});

describe('capping examples', () => {
  it('does not cut inside a surrogate pair', () => {
    const input = `a${String.fromCharCode(HIGH, LOW)}b`;
    const r = sanitizeCapped(input, { multiline: false }, 2);
    expect(r).toEqual({ text: 'a', total: 4, truncated: true });
  });

  it('keeps a pair that fits exactly', () => {
    const pair = String.fromCharCode(HIGH, LOW);
    const r = sanitizeCapped(`a${pair}b`, { multiline: false }, 3);
    expect(r).toEqual({ text: `a${pair}`, total: 4, truncated: true });
  });

  it('reports no truncation at exactly the cap', () => {
    expect(sanitizeCapped('abc', { multiline: false }, 3)).toEqual({ text: 'abc', total: 3, truncated: false });
  });
});
