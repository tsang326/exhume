import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { visibleCount, hasMore, progressText } from './paging';
import { MAX_TOTAL_ENTRIES, PAGE_SIZE } from './limits';
import { numRuns } from '../../test-support/runs';

describe('paging', () => {
  // Feature: graveyard-ui, Property 19: Paging shows min(total, pages x 200) and grows by at most one page
  it('Property 19: visible count, growth, hasMore and progress text', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: MAX_TOTAL_ENTRIES }),
        fc.integer({ min: 1, max: 21 }),
        (total, pages) => {
          const v = visibleCount(total, pages);
          const grow = visibleCount(total, pages + 1) - v;
          return (
            v === Math.min(total, pages * PAGE_SIZE) &&
            grow >= 0 &&
            grow <= PAGE_SIZE &&
            hasMore(total, pages) === v < total &&
            progressText(v, total) === `${v} of ${total}` &&
            (total !== 0 || (v === 0 && !hasMore(total, pages)))
          );
        },
      ),
      { numRuns: numRuns(200) },
    );
  });

  it('reaches 4,096 entries at page 21 after 20 activations', () => {
    expect(visibleCount(4096, 20)).toBe(4000);
    expect(hasMore(4096, 20)).toBe(true);
    expect(visibleCount(4096, 21)).toBe(4096);
    expect(hasMore(4096, 21)).toBe(false);
    expect(progressText(200, 4096)).toBe('200 of 4096');
  });
});
