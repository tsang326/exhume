import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_PNG_BYTES, PNG_STORED_BLOCK_MAX } from './limits';
import { encodePng } from './png';
import { rgbaBlockImageArb, rgbaImageArb } from '../../test-support/formats/arbitraries';
import { pngSizeFromFirstPrinciples } from '../../test-support/formats/oracles';
import { decodePng } from '../../test-support/formats/png-decoder';
import { numRuns } from '../../test-support/runs';

describe('encodePng size', () => {
  // Feature: format-resurrection, Property 32: PNG size is exact and bounded
  // **Validates: Requirements 11.9, 11.10**
  it('Property 32: PNG size is exact and bounded', () => {
    fc.assert(
      fc.property(rgbaImageArb(300, 100), (img) => {
        const result = encodePng(img);
        if (!result.ok) return false;
        const len = result.output.length;
        return len === pngSizeFromFirstPrinciples(img.width, img.height) && len <= MAX_PNG_BYTES;
      }),
      { numRuns: numRuns(100) },
    );
  });
});

function blocksFor(width: number, height: number) {
  const result = encodePng({ width, height, rgba: new Uint8Array(width * height * 4) });
  if (!result.ok) throw new Error('encodePng failed');
  return { filtered: height * (1 + width * 4), blocks: decodePng(result.output).storedBlocks };
}

describe('encodePng stored-block boundaries', () => {
  // Feature: format-resurrection, Property 33: Stored-block boundaries
  // **Validates: Requirements 11.14**
  it('Property 33: Stored-block boundaries', () => {
    fc.assert(
      fc.property(rgbaBlockImageArb, (img) => {
        const result = encodePng(img);
        if (!result.ok) return false;
        const { storedBlocks: blocks } = decodePng(result.output);
        const filtered = img.height * (1 + img.width * 4);
        const expected = Math.ceil(filtered / PNG_STORED_BLOCK_MAX);
        if (blocks.length !== expected) return false;
        if (filtered <= PNG_STORED_BLOCK_MAX) return blocks.length === 1 && blocks[0]?.final === true;
        const last = blocks.length - 1;
        return blocks.every((b, i) =>
          i < last ? !b.final && b.len === PNG_STORED_BLOCK_MAX : b.final,
        );
      }),
      { numRuns: numRuns(100) },
    );
  });

  // 65,535 is reachable only as 51 rows of 321 pixels (outside the arbitrary's width range).
  it('exactly 65,535 filtered bytes is one final block', () => {
    const { filtered, blocks } = blocksFor(321, 51);
    expect(filtered).toBe(65_535);
    expect(blocks).toEqual([{ final: true, len: 65_535 }]);
  });

  it('65,534 filtered bytes (just under) is one final block', () => {
    const { filtered, blocks } = blocksFor(264, 62);
    expect(filtered).toBe(65_534);
    expect(blocks).toEqual([{ final: true, len: 65_534 }]);
  });

  // Filtered lengths 65,536 and 65,537 are unreachable: h*(1+4w) is never a power of two
  // and 65,537 is prime, so 65,538 is the nearest reachable length above the boundary.
  it('65,538 filtered bytes splits into a full block and a 3-byte final block', () => {
    const { filtered, blocks } = blocksFor(248, 66);
    expect(filtered).toBe(65_538);
    expect(blocks).toEqual([
      { final: false, len: 65_535 },
      { final: true, len: 3 },
    ]);
  });
});
