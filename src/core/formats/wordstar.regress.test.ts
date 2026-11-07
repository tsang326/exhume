import { describe, expect, it } from 'vitest';
import { convertWordStar } from './wordstar';

function conv(s: string): string {
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  const r = convertWordStar(bytes);
  if (!r.ok) throw new Error('expected success: ' + r.error);
  return r.output;
}

describe('wordstar line-start escapes', () => {
  it.each([' -', '  # x', ' + x', ' 1. x', 'a - b'])('passes %j through unchanged', (s) => {
    expect(conv(s + '\r\n')).toBe(s + '\n');
  });

  it.each([
    ['-', '\\-'],
    ['# x', '\\# x'],
    ['+ x', '\\+ x'],
    ['1. x', '1\\. x'],
  ])('escapes %j at line start', (s, expected) => {
    expect(conv(s + '\r\n')).toBe(expected + '\n');
  });
});
