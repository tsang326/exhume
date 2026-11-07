import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { canvasBacking, frameDue } from './effects-math';
import { numRuns } from '../../test-support/runs';

const anyNum = fc.oneof(
  fc.double({ min: 0, max: 5000, noNaN: true }),
  fc.double({ noNaN: false }),
  fc.constantFrom(0, -1, 1e300, Infinity, NaN, 0.5),
);

describe('effects-math examples', () => {
  it('handles zero and huge input', () => {
    expect(canvasBacking(0, 0, 0)).toEqual({ width: 1, height: 1 });
    expect(canvasBacking(1e12, 1e12, 3)).toEqual({ width: 1080, height: 1080 });
    expect(canvasBacking(1000, 500, 1)).toEqual({ width: 1000, height: 500 });
  });

  it('frameDue boundary at 1000/30 ms', () => {
    expect(frameDue(0, 33)).toBe(false);
    expect(frameDue(0, 1000 / 30)).toBe(true);
  });
});

describe('effects-math properties', () => {
  // Feature: graveyard-ui, Property 35: Canvas size and frame rate stay within budget
  it('canvasBacking returns bounded integers', () => {
    // **Validates: Requirements 11.6**
    fc.assert(
      fc.property(anyNum, anyNum, anyNum, (w, h, d) => {
        const r = canvasBacking(w, h, d);
        return (
          Number.isInteger(r.width) &&
          Number.isInteger(r.height) &&
          r.width >= 1 &&
          r.width <= 1920 &&
          r.height >= 1 &&
          r.height <= 1080
        );
      }),
      { numRuns: numRuns(200) },
    );
  });

  // Feature: graveyard-ui, Property 35: Canvas size and frame rate stay within budget
  it('canvasBacking keeps the aspect ratio when scaled down', () => {
    // **Validates: Requirements 11.6**
    fc.assert(
      fc.property(
        fc.double({ min: 2000, max: 20000, noNaN: true }),
        fc.double({ min: 2000, max: 20000, noNaN: true }),
        fc.double({ min: 1, max: 3, noNaN: true }),
        (w, h, d) => {
          const r = canvasBacking(w, h, d);
          const want = w / h;
          const got = r.width / r.height;
          return Math.abs(got - want) / want < 0.01;
        },
      ),
      { numRuns: numRuns(200) },
    );
  });

  // Feature: graveyard-ui, Property 35: Canvas size and frame rate stay within budget
  it('frameDue is true only when the interval has elapsed, so at most 30 draws per second', () => {
    // **Validates: Requirements 11.6**
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1e6, noNaN: true }),
        fc.double({ min: 0, max: 1e6, noNaN: true }),
        (last, now) => !frameDue(last, now) || now - last >= 1000 / 30,
      ),
      { numRuns: numRuns(200) },
    );
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 5000, noNaN: true }), { maxLength: 400 }),
        (deltas) => {
          const times: number[] = [];
          let t = 0;
          for (const d of deltas) {
            t += d;
            times.push(t);
          }
          let last = -Infinity;
          const draws: number[] = [];
          for (const now of times) {
            if (frameDue(last, now)) {
              draws.push(now);
              last = now;
            }
          }
          return draws.every((s, i) => draws.filter((x, j) => j >= i && x < s + 1000).length <= 30);
        },
      ),
      { numRuns: numRuns(100) },
    );
  });
});
