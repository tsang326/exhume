import { describe, it, expect } from 'vitest';
import { isNarrow, NARROW_QUERY, type MatchMediaLike } from './layout';

describe('isNarrow', () => {
  it('uses the 760px query', () => {
    expect(NARROW_QUERY).toBe('(max-width: 760px)');
  });

  it('is false when matchMedia is missing', () => {
    expect(isNarrow(undefined)).toBe(false);
  });

  it('is false when matchMedia throws', () => {
    const mm: MatchMediaLike = () => {
      throw new Error('boom');
    };
    expect(isNarrow(mm)).toBe(false);
  });

  it('is true when the query matches, and asks for NARROW_QUERY', () => {
    const seen: string[] = [];
    const mm: MatchMediaLike = (q) => {
      seen.push(q);
      return { matches: true };
    };
    expect(isNarrow(mm)).toBe(true);
    expect(seen).toEqual([NARROW_QUERY]);
  });

  it('is false when the query does not match', () => {
    expect(isNarrow(() => ({ matches: false }))).toBe(false);
  });
});
