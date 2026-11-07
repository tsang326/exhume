import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { numRuns } from '../../test-support/runs';
import { nextFocusIndex } from './focus-order';

describe('nextFocusIndex', () => {
  it('returns -1 for an empty list', () => {
    expect(nextFocusIndex(0, -1, false)).toBe(-1);
    expect(nextFocusIndex(0, -1, true)).toBe(-1);
  });

  it('moves into the list from outside', () => {
    expect(nextFocusIndex(4, -1, false)).toBe(0);
    expect(nextFocusIndex(4, -1, true)).toBe(3);
  });

  it('wraps at both ends and steps in between', () => {
    expect(nextFocusIndex(3, 2, false)).toBe(0);
    expect(nextFocusIndex(3, 0, true)).toBe(2);
    expect(nextFocusIndex(3, 1, false)).toBe(2);
    expect(nextFocusIndex(3, 1, true)).toBe(0);
  });

  it('keeps a single item focused', () => {
    expect(nextFocusIndex(1, 0, false)).toBe(0);
    expect(nextFocusIndex(1, 0, true)).toBe(0);
  });

  // Feature: graveyard-ui, Property 33: Tab focus wraps inside the dialog
  // **Validates: Requirements 12.8**
  it('Property 33: Tab focus wraps inside the dialog', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 200 }).chain((n) =>
          fc.record({
            n: fc.constant(n),
            i: fc.integer({ min: -1, max: n - 1 }),
            back: fc.boolean(),
          }),
        ),
        ({ n, i, back }) => {
          const r = nextFocusIndex(n, i, back);
          if (!(Number.isInteger(r) && r >= 0 && r <= n - 1)) return false;
          if (!back && i === n - 1 && r !== 0) return false;
          if (back && i === 0 && r !== n - 1) return false;
          if (i === -1 && r !== (back ? n - 1 : 0)) return false;
          return true;
        },
      ),
      { numRuns: numRuns(200) },
    );
  });

  // Feature: graveyard-ui, Property 33: Tab focus wraps inside the dialog
  // **Validates: Requirements 12.8**
  it('Property 33: an empty list always gives -1', () => {
    fc.assert(
      fc.property(fc.integer({ min: -1, max: 50 }), fc.boolean(), (i, back) => {
        return nextFocusIndex(0, i, back) === -1;
      }),
      { numRuns: numRuns(50) },
    );
  });
});
