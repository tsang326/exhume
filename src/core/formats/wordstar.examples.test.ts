import { describe, expect, it } from 'vitest';
import { MAX_CONVERT_INPUT_BYTES, MAX_MARKDOWN_OUTPUT_BYTES } from './limits';
import type { MarkdownResult } from './types';
import { convertWordStar } from './wordstar';
import { checkResultInvariants } from '../../test-support/formats/invariants';
import { writeWordStar } from '../../test-support/formats/wordstar-writer';
import { timed } from '../../test-support/timed';

function bytes(...parts: Array<string | number[]>): Uint8Array {
  const out: number[] = [];
  for (const p of parts) {
    if (typeof p === 'string') for (let i = 0; i < p.length; i++) out.push(p.charCodeAt(i));
    else out.push(...p);
  }
  return Uint8Array.from(out);
}

function convert(input: Uint8Array): { output: string; codes: string[] } {
  const result = convertWordStar(input);
  expect(checkResultInvariants(result)).toEqual([]);
  if (!result.ok) throw new Error('expected success: ' + result.error);
  return { output: result.output, codes: result.warnings.map((w) => w.code) };
}

function convertClean(input: Uint8Array): string {
  const { output, codes } = convert(input);
  expect(codes).toEqual([]);
  return output;
}

describe('convertWordStar examples', () => {
  it('writes a space for a soft return and a line feed for a hard return', () => {
    expect(convertClean(bytes('one', [0x8d, 0x0a], 'two', [0x0d, 0x0a], 'three', [0x0d, 0x0a]))).toBe(
      'one two\nthree\n',
    );
  });

  it('writes nothing for a soft return at the start of the output', () => {
    expect(convertClean(bytes([0x8d, 0x0a], 'a'))).toBe('a');
  });

  it('treats a bare CR as a hard return', () => {
    expect(convertClean(bytes('a', [0x0d], 'b'))).toBe('a\nb');
  });

  it('treats a bare LF as a hard return', () => {
    expect(convertClean(bytes('a', [0x0a], 'b'))).toBe('a\nb');
  });

  it('treats a lone 0x8D as a hard return', () => {
    expect(convertClean(bytes('a', [0x8d], 'b'))).toBe('a\nb');
  });

  it('treats 0x0D 0x8A as one hard return', () => {
    expect(convertClean(bytes('a', [0x0d, 0x8a], 'b'))).toBe('a\nb');
  });

  it('replaces .PA with a blank line, ---, and a blank line', () => {
    expect(convertClean(bytes('a\r\n.PA\r\nb\r\n'))).toBe('a\n\n---\n\nb\n');
  });

  it('keeps ".5" and ". x" lines as text', () => {
    expect(convertClean(bytes('.5\r\n. x\r\n'))).toBe('.5\n. x\n');
  });

  it('returns an empty result with no warnings for empty input', () => {
    const result = convertWordStar(new Uint8Array(0));
    expect(checkResultInvariants(result)).toEqual([]);
    expect(result).toMatchObject({ ok: true, output: '', warnings: [] });
  });

  it('truncates input over MAX_CONVERT_INPUT_BYTES with one input-truncated warning', () => {
    const line = 'hello world\r\n';
    const big = new Uint8Array(MAX_CONVERT_INPUT_BYTES + 1);
    for (let i = 0; i < big.length; i++) big[i] = line.charCodeAt(i % line.length);
    const head = big.slice(0, MAX_CONVERT_INPUT_BYTES);

    const over = timed(() => convertWordStar(big)) as MarkdownResult;
    const exact = timed(() => convertWordStar(head)) as MarkdownResult;
    expect(checkResultInvariants(over)).toEqual([]);
    expect(checkResultInvariants(exact)).toEqual([]);
    if (!over.ok || !exact.ok) throw new Error('expected success');

    expect(over.warnings.filter((w) => w.code === 'input-truncated')).toHaveLength(1);
    expect(exact.warnings.filter((w) => w.code === 'input-truncated')).toHaveLength(0);
    expect(over.output).toBe(exact.output);
  });

  it('caps a 4 MiB input of "<" bytes with exactly one output-capped warning', () => {
    // A plain 4 MiB of '<' escapes to exactly MAX_MARKDOWN_OUTPUT_BYTES (8 MiB) and never
    // exceeds the cap, so a leading bold toggle adds the marker bytes that push it over.
    const input = new Uint8Array(MAX_CONVERT_INPUT_BYTES).fill(0x3c);
    input[0] = 0x02;
    const result = timed(() => convertWordStar(input)) as MarkdownResult;
    expect(checkResultInvariants(result)).toEqual([]);
    if (!result.ok) throw new Error('expected success');
    expect(result.warnings.filter((w) => w.code === 'output-capped')).toHaveLength(1);
    expect(result.output.length).toBeLessThanOrEqual(MAX_MARKDOWN_OUTPUT_BYTES);
    expect(result.output.startsWith('**\\<\\<')).toBe(true);
  });

  it('agrees with the fixture writer on bold, underline and italic paragraphs', () => {
    const input = writeWordStar([
      { spans: [{ text: 'Hello ' }, { text: 'bold', styles: ['bold'] }, { text: ' world' }] },
      { spans: [{ text: 'an ' }, { text: 'underlined', styles: ['underline'] }, { text: ' word' }] },
      { spans: [{ text: 'some ' }, { text: 'italic', styles: ['italic'] }, { text: ' text' }] },
    ]);
    expect(convertClean(input)).toBe(
      'Hello **bold** world\nan *underlined* word\nsome *italic* text\n',
    );
  });
});
