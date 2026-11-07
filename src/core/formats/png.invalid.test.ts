import { describe, it } from 'vitest';
import fc from 'fast-check';
import { MAX_IMAGE_DIMENSION, MAX_IMAGE_PIXELS } from './limits';
import { encodePng } from './png';
import type { RgbaImage } from './types';
import { checkResultInvariants } from '../../test-support/formats/invariants';
import { numRuns } from '../../test-support/runs';

interface InvalidCase {
  input: unknown;
  /** True when a dimension or pixel limit is the cause of the failure. */
  limit: boolean;
}

const smallDim = fc.integer({ min: 1, max: 16 });
const goodRgba = (w: number, h: number): Uint8Array => new Uint8Array(w * h * 4);

// Non-object inputs.
const nonObject: fc.Arbitrary<InvalidCase> = fc
  .oneof(
    fc.constant(undefined),
    fc.constant(null),
    fc.double(),
    fc.string(),
    fc.boolean(),
    fc.bigInt(),
  )
  .map((input) => ({ input, limit: false }));

// A width or height that is not an integer >= 1.
const badDim: fc.Arbitrary<unknown> = fc.oneof(
  fc.double({ noInteger: true }),
  fc.integer({ min: -1000, max: 0 }),
  fc.constantFrom(NaN, Infinity, -Infinity),
  fc.string(),
  fc.constant(undefined),
  fc.constant(null),
);

const badDimensions: fc.Arbitrary<InvalidCase> = fc
  .tuple(badDim, smallDim, fc.boolean())
  .map(([bad, good, badIsWidth]) => ({
    input: badIsWidth
      ? { width: bad, height: good, rgba: goodRgba(good, good) }
      : { width: good, height: bad, rgba: goodRgba(good, good) },
    limit: false,
  }));

// Integer dimensions over the per-axis cap, with a short rgba (no huge allocation).
const overDimension: fc.Arbitrary<InvalidCase> = fc
  .tuple(
    fc.integer({ min: MAX_IMAGE_DIMENSION + 1, max: 2_000_000_000 }),
    fc.integer({ min: 1, max: 2_000_000_000 }),
    fc.boolean(),
    fc.uint8Array({ maxLength: 8 }),
  )
  .map(([big, other, bigIsWidth, rgba]) => ({
    input: bigIsWidth
      ? { width: big, height: other, rgba }
      : { width: other, height: big, rgba },
    limit: true,
  }));

// Each axis within the cap but the product over the pixel cap.
const overPixels: fc.Arbitrary<InvalidCase> = fc
  .integer({ min: Math.floor(MAX_IMAGE_PIXELS / MAX_IMAGE_DIMENSION) + 1, max: MAX_IMAGE_DIMENSION })
  .chain((w) =>
    fc
      .integer({ min: Math.floor(MAX_IMAGE_PIXELS / w) + 1, max: MAX_IMAGE_DIMENSION })
      .map((h) => ({ w, h })),
  )
  .map(({ w, h }) => ({
    input: { width: w, height: h, rgba: new Uint8Array(4) },
    limit: true,
  }));

// Valid dimensions, rgba of the wrong length.
const wrongLength: fc.Arbitrary<InvalidCase> = fc
  .tuple(smallDim, smallDim, fc.integer({ min: 0, max: 16 * 16 * 4 + 8 }))
  .filter(([w, h, len]) => len !== w * h * 4)
  .map(([width, height, len]) => ({
    input: { width, height, rgba: new Uint8Array(len) },
    limit: false,
  }));

// Valid dimensions, rgba of the wrong type.
const wrongRgbaType: fc.Arbitrary<InvalidCase> = fc
  .tuple(
    smallDim,
    smallDim,
    fc.oneof(
      fc.constant(undefined),
      fc.constant(null),
      fc.array(fc.integer({ min: 0, max: 255 })),
      fc.string(),
      fc.double(),
      fc.uint8Array({ maxLength: 16 }).map((a) => new Uint8ClampedArray(a)),
      fc.uint8Array({ maxLength: 16 }).map((a) => a.buffer),
    ),
  )
  .map(([width, height, rgba]) => ({ input: { width, height, rgba }, limit: false }));

const invalidCase: fc.Arbitrary<InvalidCase> = fc.oneof(
  nonObject,
  badDimensions,
  overDimension,
  overPixels,
  wrongLength,
  wrongRgbaType,
);

/**
 * Feature: format-resurrection, Property 34: Invalid PNG input is rejected without allocation
 *
 * **Validates: Requirements 11.8**
 */
describe('Property 34: invalid PNG input is rejected without allocation', () => {
  it('returns ok:false with the PNG input error and never throws', () => {
    fc.assert(
      fc.property(invalidCase, ({ input, limit }) => {
        let result;
        try {
          result = encodePng(input as RgbaImage);
        } catch {
          return false;
        }
        if (result.ok) return false;
        if (result.error !== 'PNG input invalid') return false;
        if (checkResultInvariants(result).length !== 0) return false;
        const limitWarnings = result.warnings.filter((x) => x.code === 'limit-exceeded');
        return limit ? limitWarnings.length >= 1 : limitWarnings.length === 0;
      }),
      { numRuns: numRuns(200) },
    );
  });
});
