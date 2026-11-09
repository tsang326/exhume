// Example tests for the WordStar gate and the binary-extension veto, with synthetic bytes only.
// Feature: real-disk-hardening. Validates: Requirements 1.2, 1.3, 1.5, 1.6, 1.7, 1.11, 1.12, 1.13
import { describe, expect, it } from 'vitest';
import { detectFormat } from './detect';
import { writeDbf } from '../../test-support/formats';

function ascii(text: string): number[] {
  return Array.from(text, (ch) => ch.charCodeAt(0));
}

/** Words with the high bit set on the last letter, joined by ordinary spaces: WordStar's word-final marking. */
function marked(words: string[]): number[] {
  const out: number[] = [];
  words.forEach((word, index) => {
    const bytes = ascii(word);
    bytes[bytes.length - 1] |= 0x80;
    out.push(...bytes);
    if (index < words.length - 1) out.push(0x20);
  });
  return out;
}

const SOFT_RETURN = [0x8d, 0x0a];
const HARD_RETURN = [0x0d, 0x0a];

/** A small synthetic WordStar document: dot command, style toggles, high-bit word ends, soft returns. */
const wsDocument = new Uint8Array([
  ...ascii('.PA'),
  ...HARD_RETURN,
  ...ascii('.LM 5'),
  ...HARD_RETURN,
  0x02,
  ...marked(['Synthetic', 'example', 'document']),
  0x02,
  ...SOFT_RETURN,
  ...marked(['with', 'justified', 'text', 'and']),
  0x13,
  ...marked(['underlined', 'words']),
  0x13,
  ...SOFT_RETURN,
  ...marked(['ending', 'here']),
  ...HARD_RETURN,
  0x1a,
]);

/** Deterministic pseudo-random bytes (LCG), no external input. */
function noise(length: number): Uint8Array {
  const out = new Uint8Array(length);
  let state = 0x2f6e2b1;
  for (let i = 0; i < length; i++) {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    out[i] = state >>> 24;
  }
  return out;
}

function withPrefix(prefix: number[], body: Uint8Array): Uint8Array {
  const out = new Uint8Array(prefix.length + body.length);
  out.set(prefix, 0);
  out.set(body, prefix.length);
  return out;
}

describe('detectFormat: WordStar gate and extension veto examples', () => {
  it('detects the synthetic document by content when the name is EXAMPLE.TXT', () => {
    expect(detectFormat(wsDocument, 'EXAMPLE.TXT')).toEqual({ format: 'wordstar', source: 'content' });
  });

  it.each(['NOTES.TXT', 'notes.txt', 'README', 'LETTER.DOC'])('detects the document by content with name %s', (name) => {
    expect(detectFormat(wsDocument, name)).toEqual({ format: 'wordstar', source: 'content' });
  });

  it('detects the document by content with no name at all', () => {
    expect(detectFormat(wsDocument)).toEqual({ format: 'wordstar', source: 'content' });
  });

  it('does not detect a document that starts with MZ, even with a trait', () => {
    expect(detectFormat(withPrefix(ascii('MZ'), wsDocument)).format).not.toBe('wordstar');
    expect(detectFormat(withPrefix(ascii('ZM'), wsDocument)).format).not.toBe('wordstar');
    expect(detectFormat(withPrefix(ascii('MZ'), wsDocument), 'PROG.TXT').format).not.toBe('wordstar');
  });

  it('does not detect a WordStar document named like a program', () => {
    expect(detectFormat(wsDocument, 'RUN.COM')).toEqual({ format: 'unknown', source: 'none' });
    expect(detectFormat(wsDocument, 'run.com').format).not.toBe('wordstar');
  });

  it('keeps dBase III content as dbase by content under a .DBF name', () => {
    const table = writeDbf({
      fields: [{ name: 'NAME', type: 'C', length: 4, decimals: 0 }],
      records: [{ deleted: false, values: [new Uint8Array([0x41, 0x42, 0x20, 0x20])] }],
    });
    expect(detectFormat(table, 'DATA.DBF')).toEqual({ format: 'dbase', source: 'content' });
  });

  it('does not report a dBase II header under .DBF as wordstar, even with a trait', () => {
    // First byte 0x02 is the dBase II version, not III, so the dBase content rule does not fire.
    const dbaseII = withPrefix([0x02, 0x00, 0x00, 0x00], new Uint8Array([...ascii('NAME'), ...SOFT_RETURN, ...ascii('AB')]));
    const result = detectFormat(dbaseII, 'OLD.DBF');
    expect(result.format).not.toBe('wordstar');
    expect(result).toEqual({ format: 'dbase', source: 'extension' });
  });

  it('does not detect random bytes named FREEDOS.001 as wordstar', () => {
    expect(detectFormat(noise(4096), 'FREEDOS.001').format).not.toBe('wordstar');
    // Even with a soft return planted in the noise, the gate rejects it.
    const planted = noise(4096);
    planted.set(SOFT_RETURN, 100);
    expect(detectFormat(planted, 'FREEDOS.001').format).not.toBe('wordstar');
    expect(detectFormat(planted).format).not.toBe('wordstar');
  });

  it('rejects a 15-byte file that has a trait and one odd byte', () => {
    const bytes = new Uint8Array([...ascii('hello world '), ...SOFT_RETURN.slice(0, 2), 0x01].slice(0, 15));
    expect(bytes.length).toBe(15);
    expect(detectFormat(bytes).format).not.toBe('wordstar');
    expect(detectFormat(bytes)).toEqual({ format: 'unknown', source: 'none' });
  });

  it('accepts the 2-byte soft return as wordstar', () => {
    expect(detectFormat(new Uint8Array(SOFT_RETURN))).toEqual({ format: 'wordstar', source: 'content' });
  });

  it('returns unknown for empty input and never wordstar', () => {
    expect(detectFormat(new Uint8Array(0))).toEqual({ format: 'unknown', source: 'none' });
    expect(detectFormat(new Uint8Array(0), 'EMPTY.TXT').format).toBe('text');
  });
});
