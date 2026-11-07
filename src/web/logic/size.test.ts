import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { checkImageSize, formatBytes } from './size';
import { MAX_IMAGE_BYTES } from './limits';
import { numRuns } from '../../test-support/runs';

describe('checkImageSize examples', () => {
  it('accepts the boundaries 1 and the cap', () => {
    expect(checkImageSize(1)).toEqual({ ok: true });
    expect(checkImageSize(MAX_IMAGE_BYTES)).toEqual({ ok: true });
  });

  it('rejects 0 as empty and cap + 1 as too large', () => {
    const empty = checkImageSize(0);
    expect(empty.ok).toBe(false);
    if (!empty.ok) {
      expect(empty.reason).toBe('empty');
      expect(empty.message).toBe('This file is empty.');
    }
    const big = checkImageSize(MAX_IMAGE_BYTES + 1);
    expect(big.ok).toBe(false);
    if (!big.ok) expect(big.reason).toBe('too-large');
  });

  it('words the too-large message as in the requirements', () => {
    const r = checkImageSize(5 * 1_048_576);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toBe('This file is 5.0 MB. Floppy images up to 2.8 MB are supported.');
    }
  });
});

describe('formatBytes examples', () => {
  it('formats the stated shapes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(MAX_IMAGE_BYTES)).toBe('2.8 MB');
  });

  it('switches to MB by the rounded value, never 1024.0 KB', () => {
    expect(formatBytes(1_048_575)).toBe('1.0 MB');
  });

  it('never throws on odd input', () => {
    for (const v of [NaN, Infinity, -Infinity, -5, 1.5]) {
      expect(() => formatBytes(v)).not.toThrow();
      expect(formatBytes(v).length).toBeGreaterThan(0);
    }
  });
});

describe('size properties', () => {
  // Feature: graveyard-ui, Property 13: The size check accepts exactly 1 through the cap
  // **Validates: Requirements 4.3, 4.4, 4.10, 4.13**
  it('Property 13: accepts exactly 1..cap; rejections carry messages', () => {
    const sizes = fc.oneof(
      fc.integer({ min: -10, max: 10 }),
      fc.integer({ min: MAX_IMAGE_BYTES - 10, max: MAX_IMAGE_BYTES + 10 }),
      fc.integer({ min: -Number.MAX_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }),
      fc.constantFrom(1, MAX_IMAGE_BYTES, MAX_IMAGE_BYTES + 1),
    );
    fc.assert(
      fc.property(sizes, (n) => {
        const r = checkImageSize(n);
        const inRange = n >= 1 && n <= MAX_IMAGE_BYTES;
        if (r.ok !== inRange) return false;
        if (r.ok) return true;
        if (r.message.length === 0) return false;
        if (n === 0) return r.reason === 'empty';
        if (n < 0) return r.reason === 'invalid';
        return (
          r.reason === 'too-large' &&
          r.message.includes(formatBytes(n)) &&
          r.message.includes(formatBytes(MAX_IMAGE_BYTES))
        );
      }),
      { numRuns: numRuns(100) },
    );
  });

  // Feature: graveyard-ui, Property 13: The size check accepts exactly 1 through the cap
  // **Validates: Requirements 4.3, 4.4, 4.10, 4.13**
  it('Property 13: non-integers and NaN are invalid; custom caps are honoured', () => {
    const odd = fc.oneof(
      fc.constant(NaN),
      fc.constantFrom(Infinity, -Infinity),
      fc.double({ noNaN: true, noInteger: true }),
    );
    fc.assert(
      fc.property(odd, (n) => {
        const r = checkImageSize(n);
        return !r.ok && r.reason === 'invalid' && r.message.length > 0;
      }),
      { numRuns: numRuns(100) },
    );
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000 }),
        fc.integer({ min: -5, max: 10_010 }),
        (cap, n) => checkImageSize(n, cap).ok === (n >= 1 && n <= cap),
      ),
      { numRuns: numRuns(100) },
    );
  });

  // Feature: graveyard-ui, Property 14: Size formatting has the stated shape
  // **Validates: Requirements 4.5, 4.6, 4.9**
  it('Property 14: formatBytes has the stated shape', () => {
    const values = fc.oneof(
      fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
      fc.integer({ min: 0, max: 5000 }),
      fc.integer({ min: 1_048_000, max: 1_049_000 }),
      fc.integer({ min: 0, max: 20_000_000 }),
    );
    fc.assert(
      fc.property(values, (n) => {
        const s = formatBytes(n);
        if (s.length === 0 || s.includes('1024.0 KB')) return false;
        if (n < 1024) return s === `${n} B`;
        const m = /^(\d+\.\d) (KB|MB)$/.exec(s);
        if (m === null) return false;
        const shown = Number(m[1]);
        const divisor = m[2] === 'KB' ? 1024 : 1_048_576;
        if (m[2] === 'KB' && shown >= 1024) return false;
        return Math.abs(shown - n / divisor) <= 0.05 + 1e-9 * shown;
      }),
      { numRuns: numRuns(100) },
    );
  });
});
