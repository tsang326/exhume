import { describe, expect, it } from 'vitest';
import { MAX_MESSAGE_CHARS } from './limits';
import { fill, LIMIT_EXCEEDED_TEMPLATES, limitExceededMessage, TEMPLATES } from './templates';

/** Replace each run of ASCII digits with '#'. */
function maskDigits(s: string): string {
  let out = '';
  let inRun = false;
  for (const ch of s) {
    const isDigit = ch >= '0' && ch <= '9';
    if (isDigit) {
      if (!inRun) out += '#';
      inRun = true;
    } else {
      out += ch;
      inRun = false;
    }
  }
  return out;
}

const all: Array<[string, string]> = [
  ...Object.entries(TEMPLATES),
  ...Object.entries(LIMIT_EXCEEDED_TEMPLATES),
];

describe('templates', () => {
  it('has a non-empty table', () => {
    expect(all.length).toBeGreaterThan(20);
  });

  it.each(all)('%s is short and brace-free after fill', (_name, template) => {
    const filled = fill(template, 4294967296, 16777216, 7, 0);
    const masked = maskDigits(filled);
    expect(masked.length).toBeLessThanOrEqual(MAX_MESSAGE_CHARS);
    expect(masked).not.toMatch(/[{}]/);
    expect(masked.length).toBeGreaterThan(0);
  });

  it('fill replaces placeholders with numbers', () => {
    expect(fill(TEMPLATES.recordsTruncated, 10, 3)).toBe('declared 10 records, read 3');
    expect(fill(TEMPLATES.warningsCapped, 100)).toBe('warnings capped at 100');
    expect(fill('{0} and {0}', 5)).toBe('5 and 5');
    expect(fill(TEMPLATES.errInternal)).toBe('conversion failed');
  });

  it('limitExceededMessage names the limit', () => {
    expect(limitExceededMessage('MAX_PNG_BYTES')).toBe('MAX_PNG_BYTES exceeded');
  });
});
