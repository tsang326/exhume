import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { writeFatEntry } from '../../test-support/fat12/encode';
import { numRuns } from '../../test-support/runs';
import { makeByteView } from './bytes';
import { classifyFat, FatClass, type FatClassName, fatCopiesDiffer, readFatEntry } from './fat';
import { deriveLayout, type Geometry } from './geometry';

// 1.44 MB floppy: 2 FATs of 9 sectors each.
const FLOPPY: Geometry = {
  bytesPerSector: 512,
  sectorsPerCluster: 1,
  reservedSectors: 1,
  fatCount: 2,
  rootEntryCount: 224,
  totalSectors: 2880,
  sectorsPerFat: 9,
  mediaDescriptor: 0xf0,
};
const layout = deriveLayout(FLOPPY);
const IMAGE_BYTES = FLOPPY.totalSectors * FLOPPY.bytesPerSector;
// Largest entry index whose two bytes both fit inside one FAT copy.
const MAX_N = 3070 + 1; // floor(3*3071/2)+1 = 4607 < 4608
const value12 = fc.integer({ min: 0, max: 0xfff });

describe('FAT12 entry codec', () => {
  // Feature: fat12-core, Property 5: FAT12 entry codec round trip
  // **Validates: Requirements 4.1, 4.5**
  it('Property 5: round trip keeps the neighbour sharing a byte unchanged', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: MAX_N - 1 }),
        value12,
        value12,
        value12,
        (n, value, left, right) => {
          const image = new Uint8Array(IMAGE_BYTES);
          const fat = image.subarray(layout.fatStart, layout.fatStart + layout.fatBytes);
          writeFatEntry(fat, n - 1, left);
          writeFatEntry(fat, n + 1, right);
          writeFatEntry(fat, n, value);
          const view = makeByteView(image);
          return (
            readFatEntry(view, layout, n) === value &&
            readFatEntry(view, layout, n - 1) === left &&
            readFatEntry(view, layout, n + 1) === right
          );
        },
      ),
      { numRuns: numRuns(100) },
    );
  });

  // Feature: fat12-core, Property 5: FAT12 entry codec round trip
  it('Property 5: entries outside the first FAT copy read as undefined', () => {
    const view = makeByteView(new Uint8Array(IMAGE_BYTES));
    expect(readFatEntry(view, layout, MAX_N)).toBe(0);
    fc.assert(
      fc.property(fc.integer({ min: MAX_N + 1, max: 10_000_000 }), (n) => {
        return readFatEntry(view, layout, n) === undefined;
      }),
      { numRuns: numRuns(100) },
    );
    expect(readFatEntry(view, layout, -1)).toBeUndefined();
    expect(readFatEntry(view, layout, 1.5)).toBeUndefined();
  });
});

describe('fatCopiesDiffer', () => {
  const build = (g: Geometry): { image: Uint8Array; view: ReturnType<typeof makeByteView> } => {
    const image = new Uint8Array(g.totalSectors * g.bytesPerSector);
    const l = deriveLayout(g);
    for (let i = 0; i < l.fatBytes; i++) {
      const b = (i * 7) & 0xff;
      image[l.fatStart + i] = b;
      if (g.fatCount === 2) image[l.fatStart + l.fatBytes + i] = b;
    }
    return { image, view: makeByteView(image) };
  };

  it('is false for identical copies', () => {
    expect(fatCopiesDiffer(build(FLOPPY).view, layout)).toBe(false);
  });

  it('is true when one byte differs', () => {
    const { image, view } = build(FLOPPY);
    image[layout.fatStart + layout.fatBytes + 100] ^= 0x01;
    expect(fatCopiesDiffer(view, layout)).toBe(true);
  });

  it('is false when there is a single FAT', () => {
    const g = { ...FLOPPY, fatCount: 1 };
    expect(fatCopiesDiffer(build(g).view, deriveLayout(g))).toBe(false);
  });
});

describe('FAT value classification', () => {
  // Independent oracle written as a range table.
  const oracle = (v: number): FatClassName => {
    const table: Array<[number, number, FatClassName]> = [
      [0x000, 0x000, 'free'],
      [0x001, 0x001, 'reserved'],
      [0x002, 0xfef, 'next'],
      [0xff0, 0xff6, 'reserved'],
      [0xff7, 0xff7, 'bad'],
      [0xff8, 0xfff, 'end'],
    ];
    const hit = table.filter(([lo, hi]) => v >= lo && v <= hi);
    return hit[0][2];
  };

  // Feature: fat12-core, Property 6: FAT value classification partitions the 12-bit range
  // **Validates: Requirements 4.2**
  it('Property 6: classifyFat matches the oracle for any 12-bit value', () => {
    fc.assert(
      fc.property(value12, (v) => classifyFat(v) === oracle(v)),
      { numRuns: numRuns(100) },
    );
  });

  it('Property 6: exhaustive over all 4096 values and boundaries', () => {
    const mismatches: number[] = [];
    for (let v = 0; v <= 0xfff; v++) if (classifyFat(v) !== oracle(v)) mismatches.push(v);
    expect(mismatches).toEqual([]);
    expect(classifyFat(0x000)).toBe(FatClass.Free);
    expect(classifyFat(0x002)).toBe(FatClass.Next);
    expect(classifyFat(0xfef)).toBe(FatClass.Next);
    expect(classifyFat(0xff0)).toBe(FatClass.Reserved);
    expect(classifyFat(0xff7)).toBe(FatClass.Bad);
    expect(classifyFat(0xff8)).toBe(FatClass.End);
    expect(classifyFat(0xfff)).toBe(FatClass.End);
  });
});
