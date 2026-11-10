import * as fc from 'fast-check';

/**
 * Small byte arrays biased toward WordStar control bytes, dots, markers and text.
 * Shared by the WordStar output and paragraph tests. Not reachable from `index.ts`.
 */
export const wsBiasedArb: fc.Arbitrary<Uint8Array> = fc
  .array(
    fc.oneof(
      { weight: 4, arbitrary: fc.integer({ min: 0x20, max: 0x7e }) },
      { weight: 3, arbitrary: fc.constantFrom(0x02, 0x13, 0x19, 0x0d, 0x0a, 0x8d, 0x8a, 0x09, 0x20, 0x1a, 0x00, 0x1f, 0x2e) },
      { weight: 2, arbitrary: fc.constantFrom(0x2a, 0x5f, 0x23, 0x2d, 0x31, 0x29, 0x5c) },
      { weight: 1, arbitrary: fc.integer({ min: 0, max: 255 }) },
    ),
    { maxLength: 300 },
  )
  .map((a) => Uint8Array.from(a));
