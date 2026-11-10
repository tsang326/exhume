// Item C (mcp-root-and-flaky), task 15: bug condition exploration for WordStar paragraph breaks.
// Written BEFORE the fix. On the unfixed converter the examples, the CHAPTER1 test and the paragraph-model
// property are EXPECTED TO FAIL (a hard return writes a single "\n"). They pass once Item C is implemented.
import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { numRuns } from '../../test-support/runs';
import { wsBiasedArb } from '../../test-support/formats/ws-biased';
import { CHAPTER1 } from '../../demo-disks/content/prose';
import { writeWordStar } from '../../test-support/formats';
import type { WsParagraph } from '../../test-support/formats';
import { hostileInputArb } from '../../test-support/formats/hostile';
import { checkResultInvariants } from '../../test-support/formats/invariants';
import { lineMarkersBalanced } from '../../test-support/formats/oracles';
import { convertWordStar, runWordStar } from './wordstar';

const enc = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));

function md(bytes: ArrayLike<number>): string {
  const r = convertWordStar(Uint8Array.from(bytes));
  if (!r.ok || typeof r.output !== 'string') throw new Error('conversion failed');
  return r.output;
}

describe('WordStar hard return is a paragraph break (examples)', () => {
  it('a CRLF b CRLF gives a, blank line, b, one final newline', () => {
    // **Validates: Requirements 1.7, 2.8**
    expect(md([...enc('a'), 0x0d, 0x0a, ...enc('b'), 0x0d, 0x0a])).toBe('a\n\nb\n');
  });

  const forms: Array<[string, number[]]> = [
    ['0D 0A', [0x0d, 0x0a]],
    ['0D 8A', [0x0d, 0x8a]],
    ['lone 0A', [0x0a]],
    ['lone 0D', [0x0d]],
    ['lone 8D', [0x8d]],
  ];
  it.each(forms)('hard return form %s between a and b gives a\\n\\nb', (_name, hard) => {
    // **Validates: Requirements 2.8**
    expect(md([...enc('a'), ...hard, ...enc('b')])).toBe('a\n\nb');
  });
});

/** Expected Markdown text of an authored paragraph: bold = **, italic/underline = *. */
function expectedText(p: WsParagraph): string {
  let out = '';
  for (const span of p.spans) {
    const styles = span.styles ?? [];
    const mark = styles.includes('bold') ? '**' : styles.length > 0 ? '*' : '';
    out += mark + span.text + mark;
  }
  return out;
}

describe('CHAPTER1 renders as separate paragraphs', () => {
  it('11 paragraphs on blank lines, none holding a newline, no triple newline', () => {
    // **Validates: Requirements 1.7, 2.8, 2.9, 2.10**
    const out = md(writeWordStar(CHAPTER1));
    expect(out).not.toContain('\n\n\n');
    const paragraphs = out.replace(/\n$/, '').split('\n\n');
    expect(paragraphs).toHaveLength(11);
    for (const p of paragraphs) expect(p).not.toContain('\n');
    expect(paragraphs).toEqual(CHAPTER1.map(expectedText));
  });
});

// Content lines: letter words joined by single spaces, no leading/trailing space, nothing the converter escapes.
const lineArb: fc.Arbitrary<string> = fc
  .array(fc.stringMatching(/^[A-Za-z]{1,8}$/), { minLength: 1, maxLength: 5 })
  .map((words) => words.join(' '));
const linesArb = fc.array(lineArb, { minLength: 1, maxLength: 8 });

describe('WordStar paragraph normal form (properties)', () => {
  it('Property 5: output has no blank-line runs, no leading newline, no trailing blank line', () => {
    // **Validates: Requirements 2.9, 2.10**
    fc.assert(
      fc.property(wsBiasedArb, (bytes) => {
        const out = md(bytes);
        if (out.includes('\n\n\n')) return false;
        if (out.startsWith('\n')) return false;
        if (out.endsWith('\n\n')) return false;
        return true;
      }),
      { numRuns: numRuns(300) },
    );
  });

  it('Property 5: lines joined by CRLF convert to lines joined by one blank line', () => {
    // **Validates: Requirements 1.7, 2.8**
    fc.assert(
      fc.property(linesArb, (lines) => {
        const bytes = enc(lines.join('\r\n') + '\r\n');
        return md(bytes) === lines.join('\n\n') + '\n';
      }),
      { numRuns: numRuns(200) },
    );
  });
});

// ---------------------------------------------------------------------------------------------------------
// Task 16: preservation (Property 6). Observed on the UNFIXED converter; these PASS before and after Item C.
// Every input below has no hard return followed by text, so paragraph spacing cannot change the output.
// ---------------------------------------------------------------------------------------------------------

describe('WordStar output without a hard return before text (preservation examples)', () => {
  const cases: Array<[string, number[], string]> = [
    ['empty input', [], ''],
    ['single line', enc('hello world'), 'hello world'],
    ['single line, trailing space', enc('hello '), 'hello '],
    ['single line ended by a hard return', [...enc('hello'), 0x0d, 0x0a], 'hello\n'],
    ['soft return 8D 0A joins words', [...enc('one'), 0x8d, 0x0a, ...enc('two')], 'one two'],
    ['soft return 8D 8A joins words', [...enc('one'), 0x8d, 0x8a, ...enc('two')], 'one two'],
    ['soft hyphen is dropped', [...enc('co'), 0x1f, ...enc('op')], 'coop'],
    ['soft space (A0) is a space', [...enc('a'), 0xa0, ...enc('b')], 'a b'],
    ['two plain spaces are kept', enc('a  b'), 'a  b'],
    ['bold toggle', [0x02, ...enc('hi'), 0x02, ...enc(' there')], '**hi** there'],
    ['bold left open is closed', [0x02, ...enc('hi')], '**hi**'],
    ['italic toggle (0x19)', [0x19, ...enc('it'), 0x19], '*it*'],
    ['underline toggle (0x13)', [0x13, ...enc('un'), 0x13], '*un*'],
    ['bold across a soft return', [0x02, ...enc('a'), 0x8d, 0x0a, ...enc('b'), 0x02], '**a b**'],
    ['inline escapes', enc('*a* _b_ \\c'), '\\*a\\* \\_b\\_ \\\\c'],
    ['line-start # escape', enc('# head'), '\\# head'],
    ['line-start dash escape', enc('- item'), '\\- item'],
    ['line-start ordered list escape', enc('1. item'), '1\\. item'],
    ['dot command without return', enc('.OP'), ''],
    ['dot command line ended by a return', [...enc('.LM 5'), 0x0d, 0x0a], ''],
    ['two dot command lines', [...enc('.LM 5'), 0x0d, 0x0a, ...enc('.OP'), 0x0d, 0x0a], ''],
    ['comment line (..)', enc('..a comment'), ''],
    ['comment line ended by a return', [...enc('..note'), 0x0d, 0x0a], ''],
  ];
  it.each(cases)('%s', (_name, bytes, expected) => {
    // **Validates: Requirements 3.9, 3.10, 3.11, 3.12**
    expect(md(bytes)).toBe(expected);
  });

  it('dot commands other than .PA still report dot-commands-ignored', () => {
    // **Validates: Requirements 3.11**
    const r = convertWordStar(Uint8Array.from([...enc('.LM 5'), 0x0d, 0x0a, ...enc('.OP'), 0x0d, 0x0a]));
    expect(r.warnings).toEqual([{ code: 'dot-commands-ignored', message: '2 dot command lines ignored' }]);
  });
});

const MAX_BYTES = 4096;
const hostileBytesArb: fc.Arbitrary<Uint8Array> = hostileInputArb('wordstar').map((h) => h.bytes.subarray(0, MAX_BYTES));
const inputArb = fc.oneof(hostileBytesArb, wsBiasedArb);
const capArb = fc.oneof(fc.integer({ min: 0, max: 200 }), fc.constantFrom(0, 1, 2, 3, 4, 5, 200));

function alphabetOk(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (!((c >= 0x20 && c <= 0x7e) || c === 0x0a)) return false;
  }
  return true;
}

describe('WordStar totality, bounds and markers (preservation properties)', () => {
  it('Property 6/8: total, deterministic, printable ASCII plus LF, within the cap, output-capped exact, markers balanced per line', () => {
    // **Validates: Requirements 3.9, 3.10, 3.11, 3.12**
    fc.assert(
      fc.property(inputArb, capArb, (bytes, cap) => {
        const r = runWordStar(bytes, cap);
        const again = runWordStar(bytes, cap);
        if (JSON.stringify(r) !== JSON.stringify(again)) return false;
        if (checkResultInvariants(r).length > 0) return false;
        if (!r.ok || typeof r.output !== 'string') return false;
        if (!alphabetOk(r.output)) return false;
        if (r.output.length > cap) return false;

        const full = runWordStar(bytes, 1_000_000);
        if (!full.ok || typeof full.output !== 'string') return false;
        const capped = r.warnings.filter((w) => w.code === 'output-capped').length;
        if (full.output.length > cap ? capped !== 1 : capped !== 0) return false;

        for (const line of r.output.split('\n')) {
          if (!lineMarkersBalanced(line)) return false;
        }
        return true;
      }),
      { numRuns: numRuns(300) },
    );
  });
});

// ---------------------------------------------------------------------------------------------------------
// Task 17.4: new Item C tests (runs absorbed, .PA rules, bold across a break, soft/hard, no final return).
// ---------------------------------------------------------------------------------------------------------

const CRLF = '\r\n';
const segArb: fc.Arbitrary<string> = fc.stringMatching(/^[A-Za-z]{1,8}$/);
// One extra line end: an empty line or a space-only line.
const extraArb: fc.Arbitrary<string> = fc.oneof(
  fc.constant(CRLF),
  fc.integer({ min: 1, max: 4 }).map((n) => ' '.repeat(n) + CRLF),
);

describe('WordStar paragraph runs and rules (Item C properties)', () => {
  it('Property 7: a run of empty or space-only lines is absorbed into one paragraph break', () => {
    // **Validates: Requirements 2.9, 3.10**
    fc.assert(
      fc.property(segArb, segArb, fc.array(extraArb, { minLength: 1, maxLength: 6 }), (p, q, extras) => {
        const base = md(enc(p + CRLF + q));
        const run = md(enc(p + CRLF + extras.join('') + q));
        return base === run && base === p + '\n\n' + q;
      }),
      { numRuns: numRuns(200) },
    );
  });

  it('repeated .PA gives exactly one rule', () => {
    // **Validates: Requirements 2.9, 3.12**
    fc.assert(
      fc.property(segArb, segArb, fc.integer({ min: 1, max: 5 }), (p, q, k) => {
        const out = md(enc(p + CRLF + '.PA' + CRLF + ('.PA' + CRLF).repeat(k - 1) + q + CRLF));
        return out === p + '\n\n---\n\n' + q + '\n';
      }),
      { numRuns: numRuns(100) },
    );
  });

  it('.PA before the first or after the last content writes nothing', () => {
    // **Validates: Requirements 2.9, 3.12**
    fc.assert(
      fc.property(segArb, fc.integer({ min: 1, max: 3 }), fc.integer({ min: 1, max: 3 }), (p, a, b) => {
        const out = md(enc(('.PA' + CRLF).repeat(a) + p + CRLF + ('.PA' + CRLF).repeat(b)));
        return out === p + '\n' && !out.includes('---');
      }),
      { numRuns: numRuns(100) },
    );
  });

  it('a soft return before a hard return adds no extra break', () => {
    // **Validates: Requirements 2.9, 3.10**
    fc.assert(
      fc.property(segArb, segArb, (p, q) => {
        const out = md([...enc(p), 0x8d, 0x0a, ...enc(CRLF + q)]);
        return out === p + ' \n\n' + q;
      }),
      { numRuns: numRuns(100) },
    );
  });

  it('a document ending without a return has no trailing newline or blank line', () => {
    // **Validates: Requirements 2.9, 3.10**
    fc.assert(
      fc.property(linesArb, (lines) => md(enc(lines.join(CRLF))) === lines.join('\n\n')),
      { numRuns: numRuns(100) },
    );
  });
});

describe('WordStar bold across a paragraph break (examples)', () => {
  it('markers close before the line feed and reopen after the blank line', () => {
    // **Validates: Requirements 2.9, 3.10**
    expect(md([0x02, ...enc('a' + CRLF + 'b'), 0x02])).toBe('**a**\n\n**b**');
  });

  it('a soft return before a hard return gives one paragraph break', () => {
    // **Validates: Requirements 2.9, 3.10**
    // The soft return is a pending space, written before the line feed like any trailing space.
    expect(md([...enc('a'), 0x8d, 0x0a, ...enc(CRLF + 'b')])).toBe('a \n\nb');
  });

  it('a document ending without a return has no trailing newline', () => {
    // **Validates: Requirements 2.9, 3.10**
    expect(md(enc('a' + CRLF + 'b'))).toBe('a\n\nb');
  });
});
