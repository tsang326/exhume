import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { numRuns } from '../test-support/runs';
import { sanitizeText } from './sanitize';

const LF = 0x0a;
const TAB = 0x09;
const CR = 0x0d;

const SPECIAL_UNITS = [
  0x00, 0x01, 0x07, 0x08, TAB, LF, 0x0b, 0x0c, CR, 0x1b, 0x1f, 0x7f, 0x80, 0x85, 0x9b, 0x9f, 0x2028, 0x2029, 0x202a,
  0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069, 0xfeff, 0xd800, 0xdbff, 0xdc00, 0xdfff, 0x41, 0xe9,
];

const MODES = fc.boolean().map((multiline) => ({ multiline }));

const anyUnit = fc.oneof(fc.constantFrom(...SPECIAL_UNITS), fc.integer({ min: 0, max: 0xffff }));
const validPair = fc.integer({ min: 0x10000, max: 0x10ffff }).map((cp) => String.fromCodePoint(cp));
// Hostile text: any UTF-16 unit (lone surrogates included), valid pairs, and ANSI-like runs.
const hostileText = fc
  .array(
    fc.oneof(
      { weight: 6, arbitrary: anyUnit.map((u) => String.fromCharCode(u)) },
      { weight: 2, arbitrary: validPair },
      { weight: 1, arbitrary: fc.constantFrom('\x1b[31m', '\r\n', '\r', '\n\r', '\u202e', '\ud83d', '\ude00') },
    ),
    { maxLength: 60 },
  )
  .map((parts) => parts.join(''));

function isHigh(c: number): boolean {
  return c >= 0xd800 && c <= 0xdbff;
}
function isLow(c: number): boolean {
  return c >= 0xdc00 && c <= 0xdfff;
}

function isForbidden(c: number, multiline: boolean): boolean {
  if (multiline && (c === LF || c === TAB)) return false;
  return (
    c <= 0x1f ||
    c === 0x7f ||
    (c >= 0x80 && c <= 0x9f) ||
    c === 0x2028 ||
    c === 0x2029 ||
    (c >= 0x202a && c <= 0x202e) ||
    (c >= 0x2066 && c <= 0x2069) ||
    c === 0xfeff
  );
}

function isClean(out: string, multiline: boolean): boolean {
  for (let i = 0; i < out.length; i++) {
    const c = out.charCodeAt(i);
    if (isForbidden(c, multiline)) return false;
    if (isHigh(c)) {
      if (i + 1 >= out.length || !isLow(out.charCodeAt(i + 1))) return false;
      i += 1;
    } else if (isLow(c)) {
      return false;
    }
  }
  return true;
}

// Clean text: units outside every listed class, no lone surrogates, valid pairs allowed.
function cleanArb(multiline: boolean): fc.Arbitrary<string> {
  const unit = fc
    .integer({ min: 0x20, max: 0xffff })
    .filter((c) => !isForbidden(c, multiline) && !isHigh(c) && !isLow(c))
    .map((c) => String.fromCharCode(c));
  const extra = multiline ? fc.constantFrom('\n', '\t') : unit;
  return fc
    .array(fc.oneof({ weight: 6, arbitrary: unit }, { weight: 2, arbitrary: validPair }, { weight: 1, arbitrary: extra }), {
      maxLength: 60,
    })
    .map((parts) => parts.join(''));
}

describe('sanitizer properties', () => {
  // Feature: mcp-server, Property 11: The sanitizer is idempotent
  // **Validates: Requirements 11.6**
  it('is idempotent in both modes', () => {
    fc.assert(
      fc.property(hostileText, MODES, (s, mode) => {
        const once = sanitizeText(s, mode);
        return sanitizeText(once, mode) === once;
      }),
      { numRuns: numRuns(300) },
    );
  });

  // Feature: mcp-server, Property 12: Sanitizer output is clean and well formed
  // **Validates: Requirements 11.2, 11.7**
  it('produces output with no forbidden character and no lone surrogate', () => {
    fc.assert(
      fc.property(hostileText, MODES, (s, mode) => isClean(sanitizeText(s, mode), mode.multiline)),
      { numRuns: numRuns(300) },
    );
  });

  // Feature: mcp-server, Property 13: The sanitizer is the identity on clean text
  // **Validates: Requirements 11.8**
  it('leaves clean text unchanged', () => {
    fc.assert(
      fc.property(
        fc.boolean().chain((multiline) => cleanArb(multiline).map((s) => ({ multiline, s }))),
        ({ multiline, s }) => sanitizeText(s, { multiline }) === s,
      ),
      { numRuns: numRuns(200) },
    );
  });
});

describe('sanitizer examples', () => {
  it('keeps CSV rows with CRLF readable in multi-line mode', () => {
    expect(sanitizeText('a,b\r\nc,d\r\n', { multiline: true })).toBe('a,b\nc,d\n');
  });

  it('turns a lone CR into LF in multi-line mode and a space in single-line mode', () => {
    expect(sanitizeText('a\rb', { multiline: true })).toBe('a\nb');
    expect(sanitizeText('a\rb', { multiline: false })).toBe('a b');
  });

  it('replaces ANSI escape bytes', () => {
    expect(sanitizeText('\x1b[31mred', { multiline: true })).toBe('\ufffd[31mred');
  });

  it('replaces lone surrogates and keeps valid pairs', () => {
    expect(sanitizeText('\ud800x\ud83d\ude00\udc00', { multiline: false })).toBe('\ufffdx\ud83d\ude00\ufffd');
  });
});
