import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import { numRuns } from '../../test-support/runs';
import { convertWordStar } from './wordstar';
import { fill, TEMPLATES } from './templates';
import { ConversionWarningCode } from './types';

// Markdown_Special characters anywhere in a line: \ ` * _ < > [ ]
const SPECIAL_ANYWHERE = new Set([0x5c, 0x60, 0x2a, 0x5f, 0x3c, 0x3e, 0x5b, 0x5d]);
// Also special as the first character of a line: # + -
const SPECIAL_FIRST = new Set([0x23, 0x2b, 0x2d]);

function isDigitByte(b: number): boolean {
  return b >= 0x30 && b <= 0x39;
}

const bodyByte = fc
  .integer({ min: 0x20, max: 0x7e })
  .filter((b) => !SPECIAL_ANYWHERE.has(b));

/** One Plain_ASCII_Text line (bytes), possibly empty, with leading/trailing/consecutive spaces. */
const plainLine: fc.Arbitrary<number[]> = fc
  .array(bodyByte, { minLength: 0, maxLength: 40 })
  .filter((line) => {
    if (line.length === 0) return true;
    const first = line[0]!;
    if (first === 0x2e || SPECIAL_FIRST.has(first)) return false;
    if (isDigitByte(first) && line.length > 1 && (line[1] === 0x2e || line[1] === 0x29)) {
      return false;
    }
    return true;
  });

const plainLines = fc.array(plainLine, { minLength: 1, maxLength: 12 });

function joinBytes(lines: number[][], sep: number[]): Uint8Array {
  const out: number[] = [];
  lines.forEach((line, i) => {
    if (i > 0) out.push(...sep);
    out.push(...line);
  });
  return Uint8Array.from(out);
}

function toText(lines: number[][]): string {
  return lines.map((l) => String.fromCharCode(...l)).join('\n');
}

describe('WordStar text pass-through', () => {
  // Feature: format-resurrection, Property 8: WordStar pass-through and high-bit invariance
  it('passes Plain_ASCII_Text through with hard returns turned into line feeds', () => {
    // **Validates: Requirements 3.1, 3.12**
    fc.assert(
      fc.property(plainLines, (lines) => {
        const r = convertWordStar(joinBytes(lines, [0x0d, 0x0a]));
        return r.ok && r.output === toText(lines) && r.warnings.length === 0;
      }),
      { numRuns: numRuns(100) },
    );
  });

  // Feature: format-resurrection, Property 8: WordStar pass-through and high-bit invariance
  it('gives the same output when the high bit is set on non-return characters', () => {
    // **Validates: Requirements 3.1, 3.12**
    fc.assert(
      fc.property(
        plainLines.chain((lines) => {
          const total = lines.reduce((s, l) => s + l.length, 0);
          return fc.tuple(
            fc.constant(lines),
            fc.array(fc.boolean(), { minLength: total, maxLength: total }),
          );
        }),
        ([lines, mask]) => {
          const plain = joinBytes(lines, [0x0d, 0x0a]);
          let k = 0;
          const high = joinBytes(
            lines.map((l) => l.map((b) => (mask[k++] ? b | 0x80 : b))),
            [0x0d, 0x0a],
          );
          const a = convertWordStar(plain);
          const b = convertWordStar(high);
          return (
            a.ok &&
            b.ok &&
            a.output === b.output &&
            a.warnings.length === 0 &&
            b.warnings.length === 0
          );
        },
      ),
      { numRuns: numRuns(100) },
    );
  });
});

// Bytes whose low 7 bits are not 0x1A (neither 0x1A nor 0x9A).
const notEndMarker = fc.integer({ min: 0, max: 255 }).filter((b) => (b & 0x7f) !== 0x1a);
const headBytes = fc.array(notEndMarker, { minLength: 0, maxLength: 120 });
const tailBytes = fc.array(fc.integer({ min: 0, max: 255 }), { minLength: 0, maxLength: 80 });

describe('WordStar end marker', () => {
  // Feature: format-resurrection, Property 9: 0x1A ends the document
  it('ignores everything after 0x1A or 0x9A and adds no warning for it', () => {
    // **Validates: Requirements 3.5**
    fc.assert(
      fc.property(
        headBytes,
        tailBytes,
        fc.constantFrom(0x1a, 0x9a),
        (head, tail, marker) => {
          const alone = convertWordStar(Uint8Array.from(head));
          const combined = convertWordStar(Uint8Array.from([...head, marker, ...tail]));
          return JSON.stringify(alone) === JSON.stringify(combined);
        },
      ),
      { numRuns: numRuns(100) },
    );
  });
});

// Low-7-bit values that are dropped and counted: 0x01..0x1F minus style toggles
// (02, 13, 19), tab, returns, end marker (1A), soft hyphen (1F); plus 0x7F.
const DROPPED_LOW = [
  0x01, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x0b, 0x0c, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x14, 0x15,
  0x16, 0x17, 0x18, 0x1b, 0x1c, 0x1d, 0x1e, 0x7f,
];
const droppedByte = fc
  .tuple(fc.constantFrom(...DROPPED_LOW), fc.boolean())
  .map(([b, high]) => (high ? b | 0x80 : b));
const silentByte = fc
  .tuple(fc.constantFrom(0x00, 0x1f), fc.boolean())
  .map(([b, high]) => (high ? b | 0x80 : b));
// Letters only, so removing control bytes between them cannot create adjacency effects.
const letter = fc.integer({ min: 0x61, max: 0x7a });

function warningsOf(r: ReturnType<typeof convertWordStar>) {
  return r.warnings.filter((w) => w.code === ConversionWarningCode.ControlCodesDropped);
}

describe('WordStar dropped control bytes', () => {
  // Feature: format-resurrection, Property 10: Dropped control bytes are counted exactly
  it('counts dropped bytes in exactly one warning and leaves the text unchanged', () => {
    // **Validates: Requirements 3.7, 3.8, 3.13**
    fc.assert(
      fc.property(
        fc.array(
          fc.tuple(
            fc.array(letter, { minLength: 1, maxLength: 6 }),
            fc.array(fc.oneof(droppedByte, silentByte), { minLength: 0, maxLength: 5 }),
          ),
          { minLength: 1, maxLength: 10 },
        ),
        fc.array(droppedByte, { minLength: 0, maxLength: 3 }),
        (segments, lead) => {
          const withBytes: number[] = [...lead];
          const without: number[] = [];
          let count = lead.length;
          for (const [text, ctrl] of segments) {
            withBytes.push(...text, ...ctrl);
            without.push(...text);
            for (const c of ctrl) if ((c & 0x7f) !== 0x00 && (c & 0x7f) !== 0x1f) count++;
          }
          // A printable on both sides of every control run (lead precedes the first letter).
          const a = convertWordStar(Uint8Array.from(withBytes));
          const b = convertWordStar(Uint8Array.from(without));
          if (!a.ok || !b.ok) return false;
          if (a.output !== b.output) return false;
          const ws = warningsOf(a);
          if (count === 0) return ws.length === 0 && a.warnings.length === 0;
          return (
            ws.length === 1 &&
            a.warnings.length === 1 &&
            ws[0]!.message === fill(TEMPLATES.controlCodesDropped, count)
          );
        },
      ),
      { numRuns: numRuns(100) },
    );
  });

  // Feature: format-resurrection, Property 10: Dropped control bytes are counted exactly
  it('never warns for NUL or soft hyphen alone', () => {
    // **Validates: Requirements 3.7, 3.8, 3.13**
    fc.assert(
      fc.property(fc.array(silentByte, { minLength: 1, maxLength: 20 }), (bytes) => {
        const r = convertWordStar(Uint8Array.from(bytes));
        return r.ok && r.output === '' && r.warnings.length === 0;
      }),
      { numRuns: numRuns(100) },
    );
  });
});
