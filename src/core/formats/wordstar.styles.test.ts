import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { convertWordStar } from './wordstar';
import { wsParagraphsArb } from '../../test-support/formats/arbitraries';
import { writeWordStar } from '../../test-support/formats';
import type { WsParagraph } from '../../test-support/formats';
import { findMarkdownDecomposition, lineMarkersBalanced, lineMatchesStyles, markdownLineText } from '../../test-support/formats/oracles';
import type { TextStyle } from '../../test-support/formats/oracles';
import { numRuns } from '../../test-support/runs';
import { contentSpecArb, expandContent } from '../../test-support/formats/arbitraries';
import { hostileInputArb } from '../../test-support/formats/hostile';

// ---------------------------------------------------------------------------
// Shared helpers (tasks 8.8 to 8.10)
// ---------------------------------------------------------------------------

interface ExpectedLine {
  text: string;
  styles: TextStyle[];
}

type Open = 'bold' | 'em';

/**
 * Builds the expected output line of one paragraph from the fixture description.
 *
 * Model:
 * - bold is on for a span that lists 'bold'; emphasis is on for a span when the number of
 *   'underline' and 'italic' entries is odd (they share one toggle state, Requirement 4.2);
 * - a space at or past `wrapAt` is a soft return and gives one space unless the output is
 *   already at a break (line start, after a space, after another soft return);
 * - spaces are held back and written before the next visible character, or at the end of
 *   the line; they sit inside exactly those open markers that stay open at the next character
 *   (the lowest open style that is no longer wanted closes everything above it).
 */
function expectedLine(p: WsParagraph): ExpectedLine {
  let text = '';
  const styles: TextStyle[] = [];
  let stack: Open[] = [];
  let pending = 0;
  let atBreak = true;
  let col = 0;

  for (const span of p.spans) {
    const bold = (span.styles ?? []).includes('bold');
    const emCount = (span.styles ?? []).filter((s) => s === 'underline' || s === 'italic').length;
    const em = emCount % 2 === 1;
    for (const ch of span.text) {
      if (ch === ' ') {
        if (p.wrapAt !== undefined && col >= p.wrapAt) {
          col = 0;
          if (!atBreak) pending++;
          atBreak = true;
        } else {
          pending++;
          atBreak = true;
          col++;
        }
        continue;
      }
      // Lowest open style that is no longer wanted.
      let k = stack.length;
      for (let j = 0; j < stack.length; j++) {
        const wanted = stack[j] === 'bold' ? bold : em;
        if (!wanted) {
          k = j;
          break;
        }
      }
      const kept = stack.slice(0, k);
      const spaceStyle: TextStyle = { bold: kept.includes('bold'), emphasis: kept.includes('em') };
      for (; pending > 0; pending--) {
        text += ' ';
        styles.push(spaceStyle);
      }
      const next = kept.concat(stack.slice(k).filter((s) => (s === 'bold' ? bold : em)));
      if (bold && !next.includes('bold')) next.push('bold');
      if (em && !next.includes('em')) next.push('em');
      stack = next;
      text += ch;
      styles.push({ bold, emphasis: em });
      atBreak = false;
      col++;
    }
  }
  // Trailing spaces come after the markers are closed.
  for (; pending > 0; pending--) {
    text += ' ';
    styles.push({ bold: false, emphasis: false });
  }
  return { text, styles };
}

/** True when the converter would read the paragraph's first byte as a dot-command start. */
function startsWithDot(p: WsParagraph): boolean {
  const first = p.spans.find((s) => s.text.length > 0);
  return first !== undefined && (first.styles ?? []).length === 0 && first.text.startsWith('.');
}

// ---------------------------------------------------------------------------
// Property 12
// ---------------------------------------------------------------------------

describe('WordStar styles against the fixture description', () => {
  // Feature: format-resurrection, Property 12: WordStar styles agree with the fixture description
  // **Validates: Requirements 3.2, 3.3, 3.6, 4.1, 4.2, 4.3, 13.4, 13.9**
  it('Property 12: WordStar styles agree with the fixture description', () => {
    // A paragraph that starts with '.' and no toggle byte is a dot command (Requirement 5), not text.
    const docs = wsParagraphsArb.filter((ps) => !ps.some(startsWithDot));
    fc.assert(
      fc.property(docs, (paragraphs) => {
        const result = convertWordStar(writeWordStar(paragraphs));
        if (!result.ok) return false;
        // Changed on purpose (Item C, mcp-root-and-flaky): the converter now separates paragraphs by one
        // blank line and writes nothing for a paragraph with no visible text (empty or only spaces).
        // So the model keeps only paragraphs with visible text, and the output is split on '\n\n'
        // instead of '\n'. Per-paragraph text and style checks are unchanged.
        const visible = paragraphs.filter((p) => p.spans.some((s) => s.text.split('').some((c) => c !== ' ')));
        if (!result.output.endsWith('\n')) return visible.length === 0 && result.output === '';
        const lines = result.output.slice(0, -1).split('\n\n');
        if (lines.length !== visible.length) return false;
        for (let i = 0; i < visible.length; i++) {
          const expected = expectedLine(visible[i] as WsParagraph);
          const line = lines[i] as string;
          if (markdownLineText(line) !== expected.text) return false;
          if (!lineMatchesStyles(line, expected.styles, true)) return false;
        }
        return true;
      }),
      { numRuns: numRuns(100) },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 13
// ---------------------------------------------------------------------------

const STYLE_BYTES = [0x02, 0x13, 0x19, 0x0d, 0x0a, 0x20, 0x61, 0x62, 0x2a, 0x5c];

/** Small arrays heavy in toggle bytes, line ends, spaces and letters. */
const styleBytesArb: fc.Arbitrary<Uint8Array> = fc
  .array(fc.constantFrom(...STYLE_BYTES), { minLength: 0, maxLength: 60 })
  .map((a) => Uint8Array.from(a));

/** Checks every output line of a conversion; returns true when all lines hold. */
function markersHold(bytes: Uint8Array, minOutputLength = 0): boolean {
  const result = convertWordStar(bytes);
  if (!result.ok) return false;
  if (result.output.length < minOutputLength) return false;
  for (const line of result.output.split('\n')) {
    if (!lineMarkersBalanced(line)) return false;
    const found = findMarkdownDecomposition(line, { hug: true });
    if (found === null) return false;
    // Each kind of marker opens and closes in pairs, so the counts are even.
    const bold = found.filter((m) => m.kind === 'bold').length;
    const em = found.filter((m) => m.kind === 'emphasis').length;
    if (bold % 2 !== 0 || em % 2 !== 0) return false;
  }
  return true;
}

/** Alphabet that keeps toggles, line ends, spaces and letters frequent. */
const BIASED_ALPHABET = [0x02, 0x13, 0x19, 0x0d, 0x0a, 0x20, 0x61, 0x62, 0x2a, 0x5c, 0x8d, 0x09];

/** Replaces every byte whose low 7 bits are 0x1A (end of document) by a letter. */
function stripEndMarkers(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] as number;
    out[i] = (b & 0x7f) === 0x1a ? 0x61 : b;
  }
  return out;
}

/** Maps every byte to one of a small alphabet, depending on the byte. */
function biasBytes(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[i] = BIASED_ALPHABET[(bytes[i] as number) % BIASED_ALPHABET.length] as number;
  }
  return out;
}

/** Large inputs must give real output, so a truncated document cannot pass silently. */
function largeMarkersHold(bytes: Uint8Array): boolean {
  return markersHold(bytes, bytes.length >= 100000 ? 1000 : 0);
}

function convertedOutput(bytes: number[]): string {
  const result = convertWordStar(Uint8Array.from(bytes));
  return result.ok ? result.output : '';
}

describe('WordStar marker balance', () => {
  // Feature: format-resurrection, Property 13: Markers are balanced, nested and hug the text
  // **Validates: Requirements 4.4, 4.5, 4.6, 4.8, 4.9, 4.10**
  it('Property 13: small inputs heavy in toggle bytes', () => {
    fc.assert(fc.property(styleBytesArb, (bytes) => markersHold(bytes)), { numRuns: numRuns(300) });
  });

  it('Property 13: hostile inputs', () => {
    fc.assert(
      fc.property(
        hostileInputArb('wordstar').filter((h) => h.bytes.length <= 65536),
        (h) => markersHold(h.bytes),
      ),
      { numRuns: numRuns(100) },
    );
  });

  it('Property 13: large inputs up to 1,048,576 bytes with end markers removed', () => {
    fc.assert(
      fc.property(contentSpecArb(0, 1048576), (spec) =>
        largeMarkersHold(stripEndMarkers(expandContent(spec.seed, spec.length))),
      ),
      { numRuns: numRuns(5) },
    );
  });

  it('Property 13: large inputs up to 1,048,576 bytes biased to toggles, returns and letters', () => {
    fc.assert(
      fc.property(contentSpecArb(0, 1048576), (spec) =>
        largeMarkersHold(biasBytes(expandContent(spec.seed, spec.length))),
      ),
      { numRuns: numRuns(5) },
    );
  });

  it('Property 13: spans of only spaces or no visible text give no marker', () => {
    expect(convertedOutput([0x02, 0x20, 0x02])).not.toContain('*');
    expect(convertedOutput([0x02, 0x02])).not.toContain('*');
    expect(convertedOutput([0x02, 0x13, 0x13, 0x02])).not.toContain('*');
  });

  it('Property 13: bold and emphasis on the same text are nested pairs', () => {
    const out = convertedOutput([0x02, 0x13, 0x61, 0x13, 0x02]);
    expect(out).toContain('a');
    const line = out.split('\n')[0] as string;
    expect(lineMarkersBalanced(line)).toBe(true);
    expect(findMarkdownDecomposition(line, { hug: true })?.length).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Property 14
// ---------------------------------------------------------------------------

const ESC_ALWAYS = '\\`*_<>[]';
const ESC_UNESCAPED_FORBIDDEN = '<>[]`_';

/**
 * Walks one output line with an escape-parity state machine (no regular expression).
 * A backslash that is not itself escaped escapes the next character. Returns the
 * recovered text (escapes dropped, unescaped marker stars removed) or null when a rule
 * of Property 14 is broken:
 * - '<' '>' '[' ']' '`' '_' are always escaped; '*' is escaped or a marker star;
 * - '#', '+', '-' are escaped exactly when they are the first text character;
 * - when the first text character is a digit, a '.' or ')' right after it is escaped,
 *   and '.' or ')' anywhere else is not;
 * - no other character is escaped, and no backslash dangles at the end of the line.
 * The line '---' (the converter's own rule for a page break) is accepted as it is.
 */
function recoverLineText(line: string): string | null {
  if (line === '---') return '';
  let text = '';
  let escaped = false;
  let ti = 0;
  let firstIsDigit = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line.charAt(i);
    let esc = false;
    if (escaped) {
      esc = true;
      escaped = false;
    } else if (ch === '\\') {
      escaped = true;
      continue;
    } else if (ch === '*') {
      continue; // marker star, checked by the decomposition oracle
    }
    const lineStartSpecial = ch === '#' || ch === '+' || ch === '-';
    const afterDigit = ti === 1 && firstIsDigit && (ch === '.' || ch === ')');
    if (esc) {
      const allowed =
        ESC_ALWAYS.includes(ch) || (ti === 0 && lineStartSpecial) || afterDigit;
      if (!allowed) return null;
    } else {
      if (ESC_UNESCAPED_FORBIDDEN.includes(ch)) return null;
      if (ti === 0 && lineStartSpecial) return null;
      if (afterDigit) return null;
    }
    if (ti === 0) firstIsDigit = !esc && ch >= '0' && ch <= '9';
    text += ch;
    ti++;
  }
  if (escaped) return null;
  return text;
}

/** Escaping and marker rules hold on every output line. */
function escapingHolds(bytes: Uint8Array): boolean {
  const result = convertWordStar(bytes);
  if (!result.ok) return false;
  for (const line of result.output.split('\n')) {
    if (recoverLineText(line) === null) return false;
    if (findMarkdownDecomposition(line, { hug: true }) === null) return false;
  }
  return true;
}

/** Bytes with the Markdown specials, line-start candidates, toggles, returns and spaces. */
const ESCAPE_BYTES = [
  0x5c, 0x60, 0x2a, 0x5f, 0x3c, 0x3e, 0x5b, 0x5d, 0x23, 0x2b, 0x2d, 0x31, 0x32, 0x39, 0x2e, 0x29, 0x02, 0x13, 0x19,
  0x0d, 0x0a, 0x20, 0x61, 0x8d,
];

const escapeBytesArb: fc.Arbitrary<Uint8Array> = fc
  .array(fc.constantFrom(...ESCAPE_BYTES), { minLength: 0, maxLength: 80 })
  .map((a) => Uint8Array.from(a));

/**
 * Printable bytes (high bit random, except on 0x20) with no toggles or returns: the simple text model.
 * A raw 0xA0 is a soft space and adds nothing next to an ordinary space (Requirement 5.3), so spaces keep
 * their high bit clear and stay one output space each.
 */
const PLAIN_PRINTABLE = [
  0x5c, 0x60, 0x2a, 0x5f, 0x3c, 0x3e, 0x5b, 0x5d, 0x23, 0x2b, 0x2d, 0x30, 0x31, 0x39, 0x2e, 0x29, 0x20, 0x61, 0x62, 0x28,
];

const plainTextArb: fc.Arbitrary<Uint8Array> = fc
  .array(fc.tuple(fc.constantFrom(...PLAIN_PRINTABLE), fc.boolean()), { minLength: 0, maxLength: 80 })
  .map((a) => Uint8Array.from(a.map(([b, hi]) => (hi && b !== 0x20 ? b | 0x80 : b))))
  // A '.' first byte at line start would be read as a dot command.
  .filter((b) => b.length === 0 || ((b[0] as number) & 0x7f) !== 0x2e);

function bytesOf(s: string): Uint8Array {
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

function firstLine(bytes: Uint8Array): string {
  return convertedOutput(Array.from(bytes)).split('\n')[0] as string;
}

describe('WordStar Markdown escaping', () => {
  // Feature: format-resurrection, Property 14: Markdown specials are escaped
  // **Validates: Requirements 4.7, 4.11**
  it('Property 14: small inputs heavy in Markdown specials', () => {
    fc.assert(fc.property(escapeBytesArb, (bytes) => escapingHolds(bytes)), { numRuns: numRuns(300) });
  });

  it('Property 14: hostile inputs', () => {
    fc.assert(
      fc.property(
        hostileInputArb('wordstar').filter((h) => h.bytes.length <= 65536),
        (h) => escapingHolds(h.bytes),
      ),
      { numRuns: numRuns(100) },
    );
  });

  it('Property 14: large inputs with end markers removed', () => {
    fc.assert(
      fc.property(contentSpecArb(0, 1048576), (spec) =>
        escapingHolds(stripEndMarkers(expandContent(spec.seed, spec.length))),
      ),
      { numRuns: numRuns(3) },
    );
  });

  it('Property 14: large inputs biased to Markdown specials', () => {
    fc.assert(
      fc.property(contentSpecArb(0, 1048576), (spec) => {
        const raw = expandContent(spec.seed, spec.length);
        const out = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) {
          out[i] = ESCAPE_BYTES[(raw[i] as number) % ESCAPE_BYTES.length] as number;
        }
        return escapingHolds(out);
      }),
      { numRuns: numRuns(3) },
    );
  });

  it('Property 14: un-escaping recovers the 7-bit text of the input', () => {
    fc.assert(
      fc.property(plainTextArb, (bytes) => {
        const result = convertWordStar(bytes);
        if (!result.ok) return false;
        let line = result.output;
        if (line.endsWith('\n')) line = line.slice(0, -1);
        if (line.includes('\n')) return false;
        let expected = '';
        for (let i = 0; i < bytes.length; i++) expected += String.fromCharCode((bytes[i] as number) & 0x7f);
        return recoverLineText(line) === expected;
      }),
      { numRuns: numRuns(300) },
    );
  });

  it('Property 14: line-start specials are escaped and later ones are not', () => {
    const lineStart = fc.constantFrom('#', '+', '-');
    const rest = fc.constantFrom('a', ' ', '#', '+', '-', '.', ')', '1', 'b');
    fc.assert(
      fc.property(lineStart, fc.array(rest, { minLength: 0, maxLength: 12 }), (first, tail) => {
        const text = first + tail.join('');
        const line = firstLine(bytesOf(text));
        const expected = '\\' + first + tail.join('');
        return line === expected;
      }),
      { numRuns: numRuns(100) },
    );
    fc.assert(
      fc.property(
        fc.constantFrom('0', '1', '7', '9'),
        fc.constantFrom('.', ')'),
        fc.array(fc.constantFrom('a', ' ', '.', ')', '1'), { minLength: 0, maxLength: 8 }),
        (digit, mark, tail) => {
          const line = firstLine(bytesOf(digit + mark + tail.join('')));
          return line === digit + '\\' + mark + tail.join('');
        },
      ),
      { numRuns: numRuns(100) },
    );
    fc.assert(
      fc.property(
        fc.constantFrom('a', 'b'),
        fc.constantFrom('#', '+', '-', '.', ')'),
        fc.constantFrom('1', 'a'),
        (head, special, other) => {
          const text = head + special + other + special;
          return firstLine(bytesOf(text)) === text;
        },
      ),
      { numRuns: numRuns(50) },
    );
  });

  it('Property 14: HTML-like text is escaped', () => {
    expect(firstLine(bytesOf('<script>alert(1)</script>'))).toBe('\\<script\\>alert(1)\\</script\\>');
  });

  it('Property 14: link-like text is escaped', () => {
    expect(firstLine(bytesOf('[a](b)'))).toBe('\\[a\\](b)');
  });
});
