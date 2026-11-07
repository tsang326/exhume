import { describe, expect, it } from 'vitest';
import { MAX_CONVERT_INPUT_BYTES } from './limits';
import { convertPlainText, runPlainText } from './plaintext';
import { TEMPLATES, fill } from './templates';
import type { TextResult } from './types';
import { checkResultInvariants } from '../../test-support/formats/invariants';

function bytes(...parts: Array<string | number[]>): Uint8Array {
  const out: number[] = [];
  for (const p of parts) {
    if (typeof p === 'string') for (let i = 0; i < p.length; i++) out.push(p.charCodeAt(i));
    else out.push(...p);
  }
  return Uint8Array.from(out);
}

function ok(result: TextResult): { output: string; codes: string[]; messages: string[] } {
  expect(checkResultInvariants(result)).toEqual([]);
  if (!result.ok) throw new Error('expected success: ' + result.error);
  expect(result.mime).toBe('text/plain');
  expect(result.extension).toBe('.txt');
  return {
    output: result.output,
    codes: result.warnings.map((w) => w.code),
    messages: result.warnings.map((w) => w.message),
  };
}

function clean(input: Uint8Array): string {
  const r = ok(convertPlainText(input));
  expect(r.codes).toEqual([]);
  return r.output;
}

describe('convertPlainText examples', () => {
  it('turns CR LF into one LF', () => {
    expect(clean(bytes('a', [0x0d, 0x0a], 'b', [0x0d, 0x0a]))).toBe('a\nb\n');
  });

  it('turns a lone CR into LF', () => {
    expect(clean(bytes('a', [0x0d], 'b'))).toBe('a\nb');
  });

  it('keeps a lone LF', () => {
    expect(clean(bytes('a', [0x0a], 'b'))).toBe('a\nb');
  });

  it('turns CR CR LF into two line breaks', () => {
    expect(clean(bytes('a', [0x0d, 0x0d, 0x0a], 'b'))).toBe('a\n\nb');
  });

  it('keeps a tab', () => {
    expect(clean(bytes('a', [0x09], 'b'))).toBe('a\tb');
  });

  it('keeps a form feed without a warning', () => {
    expect(clean(bytes('a', [0x0c], 'b'))).toBe('a\fb');
  });

  it('stops at the first EOF byte and ignores what follows', () => {
    expect(clean(bytes('abc', [0x1a], 'secret', [0x01, 0x1a]))).toBe('abc');
  });

  it('does not warn about control bytes after the EOF byte', () => {
    expect(clean(bytes('ok', [0x1a, 0x01, 0x02]))).toBe('ok');
  });

  it('decodes high-half bytes as CP437', () => {
    expect(clean(bytes([0xc4, 0x82, 0x80, 0xe9, 0xff]))).toBe('\u2500\u00e9\u00c7\u0398\u00a0');
  });

  it('returns an empty text with no warnings for an empty file', () => {
    expect(clean(new Uint8Array(0))).toBe('');
  });

  it('drops control bytes and counts them in one warning', () => {
    const r = ok(convertPlainText(bytes('a', [0x01, 0x02, 0x00], 'b', [0x1f], 'c')));
    expect(r.output).toBe('abc');
    expect(r.codes).toEqual(['control-codes-dropped']);
    expect(r.messages).toEqual([fill(TEMPLATES.controlCodesDropped, 4)]);
  });

  it('drops DEL as a control byte', () => {
    const r = ok(convertPlainText(bytes('a', [0x7f], 'b')));
    expect(r.output).toBe('ab');
    expect(r.messages).toEqual([fill(TEMPLATES.controlCodesDropped, 1)]);
  });

  it('warns input-truncated when the input is over the limit', () => {
    const input = new Uint8Array(MAX_CONVERT_INPUT_BYTES + 1).fill(0x41);
    const r = ok(convertPlainText(input));
    expect(r.codes).toEqual(['input-truncated']);
    expect(r.output.length).toBe(MAX_CONVERT_INPUT_BYTES);
  });

  it('rejects input that is not a Uint8Array', () => {
    const bad: unknown[] = ['text', [65, 66], null, undefined, 42, {}, new ArrayBuffer(4)];
    for (const value of bad) {
      expect(() => convertPlainText(value as Uint8Array)).toThrow(TypeError);
    }
  });

  it('caps the output at a character boundary and warns output-capped', () => {
    // Each 0xC4 decodes to U+2500, three UTF-8 bytes. A cap of 7 fits two.
    const r = ok(runPlainText(new Uint8Array(10).fill(0xc4), 7));
    expect(r.output).toBe('\u2500\u2500');
    expect(r.codes).toEqual(['output-capped']);
    expect(r.messages).toEqual([fill(TEMPLATES.outputCappedText, 7)]);
  });

  it('does not warn when the output exactly fits the cap', () => {
    const r = ok(runPlainText(bytes('abcd'), 4));
    expect(r.output).toBe('abcd');
    expect(r.codes).toEqual([]);
  });
});
