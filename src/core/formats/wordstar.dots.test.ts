import fc from 'fast-check';
import { describe, it } from 'vitest';
import { TEMPLATES, fill } from './templates';
import { ConversionWarningCode } from './types';
import { convertWordStar } from './wordstar';
import { numRuns } from '../../test-support/runs';

// Feature: format-resurrection, Property 15: Dot-command lines are removed and counted
// **Validates: Requirements 5.1, 5.2, 5.4, 5.5, 5.7, 5.8, 5.10**

type Line =
  | { kind: 'text'; bytes: number[] }
  | { kind: 'cmd'; bytes: number[]; pa: boolean }
  | { kind: 'comment'; bytes: number[] };

function ascii(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) out.push(s.charCodeAt(i));
  return out;
}

const bodyChars = fc.constantFrom(...'abcXYZ019 .,;:!?()'.split(''));
const bodyArb = fc.string({ unit: bodyChars, maxLength: 12 });

// Text lines: never a dot command or comment.
const textLineArb: fc.Arbitrary<Line> = fc
  .oneof(
    // plain text with no leading '.'
    bodyArb.filter((s) => s.length === 0 || s[0] !== '.'),
    // '.' only after position 0
    fc.tuple(fc.constantFrom('a', ' ', 'x1'), bodyArb).map(([p, s]) => p + '.' + s),
    fc.tuple(fc.constantFrom('.5', '. x', '.A', '.', '.1a', '. '), fc.constantFrom('', ' q', '5', ' 7 z')).map(([a, b]) => a + b),
    // looks like a command but is indented
    fc.constantFrom(' .PA', ' ..', 'a.MT 5'),
  )
  .map((s) => ({ kind: 'text', bytes: ascii(s) }));

const letterArb = fc
  .tuple(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'.split('')), fc.boolean())
  .map(([c, hi]) => c.charCodeAt(0) | (hi ? 0x80 : 0));
const dotArb = fc.boolean().map((hi) => 0x2e | (hi ? 0x80 : 0));
// Never starts with a letter, so `.PA` stays exactly `.PA` followed by a non-letter.
const trailArb = fc.constantFrom('', ' 5', ' abc', '1', ' x y', '  ');

const cmdLineArb: fc.Arbitrary<Line> = fc
  .tuple(
    dotArb,
    fc.oneof(
      letterArb.chain((a) => letterArb.map((b) => [a, b] as const)),
      fc.constantFrom('P', 'p').chain((a) =>
        fc.constantFrom('A', 'a').map((b) => [a.charCodeAt(0), b.charCodeAt(0)] as const),
      ),
    ),
    trailArb,
  )
  .map(([d, [a, b], t]) => {
    const isPa = (a & 0x7f & 0xdf) === 0x50 && (b & 0x7f & 0xdf) === 0x41;
    return { kind: 'cmd', bytes: [d, a, b, ...ascii(t)], pa: isPa } as Line;
  });

const commentLineArb: fc.Arbitrary<Line> = fc
  .tuple(dotArb, dotArb, fc.constantFrom('', ' note', 'x', ' .PA'))
  .map(([d1, d2, t]) => ({ kind: 'comment', bytes: [d1, d2, ...ascii(t)] }) as Line);

const docArb = fc.record({
  lines: fc.array(fc.oneof({ weight: 3, arbitrary: textLineArb }, { weight: 2, arbitrary: cmdLineArb }, { weight: 1, arbitrary: commentLineArb }), {
    maxLength: 12,
  }),
  finalTerminator: fc.boolean(),
});

function terminated(lines: Line[], finalTerminator: boolean): number[] {
  const out: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    out.push(...lines[i].bytes);
    if (i < lines.length - 1 || finalTerminator) out.push(0x0d, 0x0a);
  }
  return out;
}

function outputOf(bytes: number[]): string | null {
  const r = convertWordStar(Uint8Array.from(bytes));
  return r.ok ? r.output : null;
}

/**
 * Reference model of the converter output for a document of lines (Item C, mcp-root-and-flaky).
 * Rewritten on purpose: the old model converted each run of text lines alone and put the rule block between
 * runs. That cannot describe the lazy rule, so the model is now a function of the whole document:
 * - a text line with a visible character is a content line; its text is what the converter gives for that line
 *   alone (escaping is not re-modelled here). Empty and space-only text lines are dropped;
 * - content lines are joined by one blank line (the previous content line ends with a line feed, then '\n');
 * - `.PA` makes a rule due only if some content came before; the rule is written when the next content line
 *   arrives, so repeated `.PA` give one rule and a `.PA` before the first or after the last content writes nothing;
 * - other dot commands and `..` comments write nothing and do not interrupt the blank-line state;
 * - a content line ends with a line feed exactly when a hard return follows it in the input.
 * Returns null when a per-line conversion fails.
 */
function referenceOutput(lines: Line[], finalTerminator: boolean): string | null {
  let out = '';
  let hasContent = false;
  let ruleDue = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as Line;
    if (line.kind === 'cmd') {
      if (line.pa && hasContent) ruleDue = true;
      continue;
    }
    if (line.kind === 'comment') continue;
    if (!line.bytes.some((b) => b !== 0x20)) continue;
    const piece = outputOf(line.bytes);
    if (piece === null) return null;
    if (hasContent) out += ruleDue ? '\n---\n\n' : '\n';
    out += piece + (i < lines.length - 1 || finalTerminator ? '\n' : '');
    hasContent = true;
    ruleDue = false;
  }
  return out;
}

describe('Property 15: dot-command lines are removed and counted', () => {
  it('removes dot lines, turns .PA into a rule, and counts the rest once', () => {
    fc.assert(
      fc.property(docArb, ({ lines, finalTerminator }) => {
        const input = terminated(lines, finalTerminator);
        const result = convertWordStar(Uint8Array.from(input));
        if (!result.ok) return false;

        const expected = referenceOutput(lines, finalTerminator);
        if (expected === null) return false;
        const count = lines.filter((l) => l.kind === 'cmd' && !l.pa).length;

        if (result.output !== expected) return false;

        const dotWarnings = result.warnings.filter((w) => w.code === ConversionWarningCode.DotCommandsIgnored);
        if (count === 0) return dotWarnings.length === 0;
        return dotWarnings.length === 1 && dotWarnings[0].message === fill(TEMPLATES.dotCommandsIgnored, count);
      }),
      { numRuns: numRuns(200) },
    );
  });
});
