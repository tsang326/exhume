import { describe, expect, it } from 'vitest';
import { csvCell, csvRow, formulaGuard, utf8Length } from './csv';

describe('formulaGuard', () => {
  it('prefixes a quote for = + - @ TAB CR', () => {
    for (const first of ['=', '+', '-', '@', '\t', '\r']) {
      expect(formulaGuard(first + 'x')).toBe("'" + first + 'x');
    }
  });

  it('leaves other text and empty text alone', () => {
    expect(formulaGuard('abc')).toBe('abc');
    expect(formulaGuard('')).toBe('');
    expect(formulaGuard('a=b')).toBe('a=b');
  });
});

describe('csvCell', () => {
  it('writes plain text without quotes', () => {
    expect(csvCell('hello world')).toBe('hello world');
  });

  it('quotes and doubles quotes', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('a\r\nb')).toBe('"a\r\nb"');
    expect(csvCell('a\nb')).toBe('"a\nb"');
  });

  it('does not guard unless asked (numeric cells)', () => {
    expect(csvCell('-12.5')).toBe('-12.5');
    expect(csvCell('-12.5', { guard: false })).toBe('-12.5');
  });

  it('guards before quoting so the apostrophe is inside the quotes', () => {
    expect(csvCell('=1,2', { guard: true })).toBe('"\'=1,2"');
    expect(csvCell('=SUM(A1)', { guard: true })).toBe("'=SUM(A1)");
  });
});

describe('csvRow', () => {
  it('joins with commas and always ends with CRLF', () => {
    expect(csvRow(['a', 'b', 'c'])).toBe('a,b,c\r\n');
    expect(csvRow(['a'])).toBe('a\r\n');
    expect(csvRow([])).toBe('\r\n');
  });
});

describe('utf8Length', () => {
  it('counts 1, 2 and 3 bytes by range', () => {
    expect(utf8Length('')).toBe(0);
    expect(utf8Length('abc')).toBe(3);
    expect(utf8Length('\u00e9')).toBe(2);
    expect(utf8Length('\u2591')).toBe(3);
  });
});
