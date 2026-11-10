import { describe, expect, it } from 'vitest';
import { convertWordStar } from './wordstar';
import { checkResultInvariants } from '../../test-support/formats/invariants';

// Feature: real-disk-hardening, task 4.3. Soft hyphen joining and soft space runs.
// Every row of the design's interaction table. Requirements 5.1, 5.2, 5.3, 5.6.

function bytes(...parts: Array<string | number[]>): Uint8Array {
  const out: number[] = [];
  for (const p of parts) {
    if (typeof p === 'string') for (let i = 0; i < p.length; i++) out.push(p.charCodeAt(i));
    else out.push(...p);
  }
  return Uint8Array.from(out);
}

function convert(input: Uint8Array): string {
  const result = convertWordStar(input);
  expect(checkResultInvariants(result)).toEqual([]);
  if (!result.ok) throw new Error('expected success: ' + result.error);
  expect(result.warnings.map((w) => w.code)).toEqual([]);
  return result.output;
}

const SOFT = [0x8d, 0x0a];
const HARD = [0x0d, 0x0a];

describe('convertWordStar soft hyphen', () => {
  it('joins the word across a soft hyphen before a soft return', () => {
    expect(convert(bytes('cor', [0x1f], SOFT, 'rected'))).toBe('corrected');
  });
  it('joins across the 0x9F form as well', () => {
    expect(convert(bytes('cor', [0x9f], SOFT, 'rected'))).toBe('corrected');
  });
  it('keeps a space when an ordinary space sits between the hyphen and the soft return', () => {
    expect(convert(bytes('cor', [0x1f, 0x20], SOFT, 'rected'))).toBe('cor rected');
  });
  it('adds nothing for the soft return after a space that follows a word', () => {
    expect(convert(bytes('word ', [0x1f], SOFT, 'next'))).toBe('word next');
  });
  it('writes nothing for a soft hyphen and soft return at the start of the document', () => {
    expect(convert(bytes([0x1f], SOFT, 'a'))).toBe('a');
  });
  it('drops a soft hyphen elsewhere in a word', () => {
    expect(convert(bytes('cor', [0x1f], 'rected'))).toBe('corrected');
  });
});

describe('convertWordStar soft space runs', () => {
  it('emits one space for an ordinary space then a soft space', () => {
    expect(convert(bytes('a', [0x20, 0xa0], 'b'))).toBe('a b');
  });
  it('emits one space for a soft space then an ordinary space', () => {
    expect(convert(bytes('a', [0xa0, 0x20], 'b'))).toBe('a b');
  });
  it('keeps one space per soft space in a run of soft spaces only', () => {
    expect(convert(bytes('a', [0xa0, 0xa0], 'b'))).toBe('a  b');
  });
  it('adds nothing for a soft return after a soft space', () => {
    expect(convert(bytes('a', [0xa0], SOFT, 'b'))).toBe('a b');
  });
  it('adds nothing for a soft space after a soft return', () => {
    expect(convert(bytes('a', SOFT, [0xa0], 'b'))).toBe('a b');
  });
  it('writes the pending run as trailing spaces before a hard return', () => {
    // Changed on purpose (mcp-root-and-flaky, Item C): a hard return after a content line now ends a
    // paragraph, so a blank line follows the trailing spaces. The trailing-space run itself is unchanged.
    expect(convert(bytes('a', [0x20, 0x20], HARD, 'b', HARD))).toBe('a  \n\nb\n');
    expect(convert(bytes('a', [0x20, 0xa0], HARD, 'b', HARD))).toBe('a \n\nb\n');
    expect(convert(bytes('a', [0xa0, 0xa0], HARD, 'b', HARD))).toBe('a  \n\nb\n');
  });
});
