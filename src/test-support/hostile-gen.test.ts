import * as fc from 'fast-check';
import { describe, it } from 'vitest';
import { hostileImageArb, oversizedImageArb, targetedDefectArb } from './hostile';

describe('hostile generators (shape only)', () => {
  it('produce well-formed hostile images', () => {
    fc.assert(
      fc.property(
        hostileImageArb,
        (h) =>
          h.image instanceof Uint8Array &&
          h.family.length > 0 &&
          typeof h.expectWarning === 'boolean' &&
          h.image.length <= 3_500_000,
      ),
      { numRuns: 20 },
    );
  });

  it('targeted defects and oversized images expect a warning', () => {
    fc.assert(
      fc.property(
        fc.oneof(targetedDefectArb, oversizedImageArb),
        (h) => h.expectWarning && h.image.length > 0,
      ),
      { numRuns: 20 },
    );
  });
});
