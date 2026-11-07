import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { sanitizeFileName, type DownloadExtension } from './filename';
import { numRuns } from '../../test-support/runs';

const EXTENSIONS: DownloadExtension[] = ['.md', '.csv', '.png', '.bin'];

// Step-by-step reference for Req 10.4 (a) to (h), written with string methods
// so it differs in shape from the implementation's loops.
function reference(name: string, ext: string): string {
  // (a)
  let s = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);
  // (b)
  const dot = s.lastIndexOf('.');
  if (dot >= 0) s = s.slice(0, dot);
  // (c)
  s = s
    .split('')
    .map((ch) => ('A' <= ch && ch <= 'Z') || ('a' <= ch && ch <= 'z') || ('0' <= ch && ch <= '9') || '._-'.includes(ch) ? ch : '_')
    .join('');
  // (d)
  while (s.startsWith('.')) s = s.slice(1);
  while (s.endsWith('.')) s = s.slice(0, -1);
  // (e)
  while (s.includes('..')) s = s.split('..').join('.');
  // (f)
  s = s.slice(0, 64 - ext.length);
  // (g)
  while (s.endsWith('.')) s = s.slice(0, -1);
  // Req 10.5
  if (s === '') s = 'grave';
  // (h)
  return s + ext;
}

describe('sanitizeFileName examples', () => {
  it('replaces the disk extension', () => {
    expect(sanitizeFileName('a.exe', '.md')).toBe('a.md');
  });

  it('appends the .txt extension for plain text downloads', () => {
    expect(sanitizeFileName('README.TXT', '.txt')).toBe('README.txt');
    expect(sanitizeFileName('', '.txt')).toBe('grave.txt');
  });

  it('keeps reserved device names', () => {
    expect(sanitizeFileName('CON', '.md')).toBe('CON.md');
    expect(sanitizeFileName('CON.TXT', '.md')).toBe('CON.md');
    expect(sanitizeFileName('NUL', '.bin')).toBe('NUL.bin');
  });

  it('falls back to grave for dots-only and empty names', () => {
    expect(sanitizeFileName('...', '.csv')).toBe('grave.csv');
    expect(sanitizeFileName('', '.png')).toBe('grave.png');
    expect(sanitizeFileName('.bashrc', '.bin')).toBe('grave.bin');
  });

  it('strips paths and unsafe characters', () => {
    expect(sanitizeFileName('C:\\dir\\sub/my file!.txt', '.md')).toBe('my_file_.md');
    expect(sanitizeFileName('../../etc/passwd', '.bin')).toBe('passwd.bin');
    expect(sanitizeFileName('a..b...c.x', '.md')).toBe('a.b.c.md');
  });

  it('truncates 300-character names to 64 in total', () => {
    const long = 'x'.repeat(300);
    for (const ext of EXTENSIONS) {
      const out = sanitizeFileName(long, ext);
      expect(out.length).toBe(64);
      expect(out.endsWith(ext)).toBe(true);
    }
    // truncation landing on a dot removes it
    const dotted = 'a'.repeat(59) + '.' + 'b'.repeat(50) + '.z';
    // stem limit is 64 - 3 = 61: 59 'a', '.', then one 'b'
    expect(sanitizeFileName(dotted, '.md')).toBe('a'.repeat(59) + '.b.md');
    const cutAtDot = 'a'.repeat(60) + '.' + 'b'.repeat(50) + '.z';
    expect(sanitizeFileName(cutAtDot, '.md')).toBe('a'.repeat(60) + '.md');
  });
});

describe('sanitizeFileName properties', () => {
  const nameArb = fc.oneof(
    fc.string({ maxLength: 400 }),
    fc.string({ unit: 'binary', maxLength: 200 }),
    fc.array(fc.constantFrom('.', '/', '\\', 'a', 'Z', '9', '_', '-', ' ', '\u00e9', '\ud83d'), { maxLength: 300 }).map((a) => a.join('')),
    fc.integer({ min: 0, max: 400 }).map((n) => 'q'.repeat(n)),
  );

  // Feature: graveyard-ui, Property 27: The file name sanitizer always yields a safe name
  // **Validates: Requirements 10.4, 10.5, 10.6, 10.7, 9.10**
  it('Property 27: result is safe and equals the reference implementation', () => {
    fc.assert(
      fc.property(nameArb, fc.constantFrom(...EXTENSIONS), (name, ext) => {
        const out = sanitizeFileName(name, ext);
        return (
          /^[A-Za-z0-9._-]{1,64}$/.test(out) &&
          !out.startsWith('.') &&
          !out.includes('..') &&
          out.endsWith(ext) &&
          out === reference(name, ext)
        );
      }),
      { numRuns: numRuns(200) },
    );
  });

  // Feature: graveyard-ui, Property 27: The file name sanitizer always yields a safe name
  // **Validates: Requirements 10.5, 10.7**
  it('Property 27: empty stems become grave and reserved stems are kept', () => {
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('.', '/', '\\'), { maxLength: 20 }).map((a) => a.join('')),
        fc.constantFrom('CON', 'NUL', 'PRN', 'AUX', 'COM1', 'LPT9'),
        fc.constantFrom(...EXTENSIONS),
        (dots, reserved, ext) =>
          sanitizeFileName(dots, ext) === 'grave' + ext && sanitizeFileName(reserved, ext) === reserved + ext,
      ),
      { numRuns: numRuns(100) },
    );
  });
});
