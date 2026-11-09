import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { decodeDosDateTime, isZeroDosDateTime } from './dates';
import { numRuns } from '../../test-support/runs';

/** Independent oracle: calendar validity via a Date.UTC round-trip. */
function oracle(dateWord: number, timeWord: number): string | null {
  const year = 1980 + Math.floor(dateWord / 512);
  const month = Math.floor(dateWord / 32) % 16;
  const day = dateWord % 32;
  const hour = Math.floor(timeWord / 2048);
  const minute = Math.floor(timeWord / 32) % 64;
  const sec2 = timeWord % 32;
  if (month < 1 || month > 12 || day < 1) return null;
  if (hour > 23 || minute > 59 || sec2 > 29) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return null;
  }
  const p = (n: number, w: number) => n.toString().padStart(w, '0');
  return `${p(year, 4)}-${p(month, 2)}-${p(day, 2)}T${p(hour, 2)}:${p(minute, 2)}:${p(sec2 * 2, 2)}`;
}

const word = fc.integer({ min: 0, max: 0xffff });
const dateFor = (year: number, month: number, day: number) =>
  ((year - 1980) << 9) | (month << 5) | day;

describe('decodeDosDateTime', () => {
  // Feature: fat12-core, Property 10: DOS date decoding matches an oracle
  // **Validates: Requirements 7.8, 7.9**
  it('matches the oracle for all 16-bit date and time words', () => {
    fc.assert(
      fc.property(word, word, (d, t) => decodeDosDateTime(d, t) === oracle(d, t)),
      { numRuns: numRuns(2000) },
    );
  });

  it('decodes the DOS epoch', () => {
    expect(decodeDosDateTime(0x0021, 0)).toBe('1980-01-01T00:00:00');
  });

  it('accepts Feb 29 in 2000 and rejects it in 2100', () => {
    expect(decodeDosDateTime(dateFor(2000, 2, 29), 0)).toBe('2000-02-29T00:00:00');
    expect(decodeDosDateTime(dateFor(2100, 2, 29), 0)).toBeNull();
  });

  it('decodes a maximum double-second of 29 as 58 seconds and rejects 30', () => {
    expect(decodeDosDateTime(0x0021, 29)).toBe('1980-01-01T00:00:58');
    expect(decodeDosDateTime(0x0021, 30)).toBeNull();
  });

  it('returns null for non-integer or out-of-range inputs', () => {
    expect(decodeDosDateTime(1.5, 0)).toBeNull();
    expect(decodeDosDateTime(0x0021, 0.5)).toBeNull();
    expect(decodeDosDateTime(0x10000, 0)).toBeNull();
    expect(decodeDosDateTime(0x0021, -1)).toBeNull();
    expect(decodeDosDateTime(NaN, 0)).toBeNull();
  });
});

describe('isZeroDosDateTime', () => {
  it('is true only when both words are zero', () => {
    expect(isZeroDosDateTime(0, 0)).toBe(true);
    expect(isZeroDosDateTime(0, 1)).toBe(false);
    expect(isZeroDosDateTime(0x0021, 0)).toBe(false);
    expect(isZeroDosDateTime(0xffff, 0xffff)).toBe(false);
  });

  it('leaves decodeDosDateTime(0, 0) as null, so only the caller exempts the pair', () => {
    expect(decodeDosDateTime(0, 0)).toBeNull();
  });
});
