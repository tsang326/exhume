// Hostile-input generators for the FAT12 reader fuzz properties (Requirements 11.3, 11.4).
//
// These arbitraries only PRODUCE inputs. They never call the reader (no src/core
// imports) and never use timed().
//
// `expectWarning` is deliberately conservative: it is true only when the reader
// is certain to report at least one warning, namely
//   - targeted defects made by the writer's damage option,
//   - empty images (length 0) and images over 2,949,120 bytes.
// Random bytes, mutated images and noise-filled regions can by chance still
// parse cleanly (or have nothing the reader must flag), so they use false.

import * as fc from 'fast-check';
import { expandContent } from './fat12/arbitraries';
import {
  STANDARD_GEOMETRY_NAMES,
  standardGeometry,
  writeFat12ImageWithLayout,
} from './fat12/index';
import type { DamageSpec, FileTree, LayoutResult, StandardGeometryName } from './fat12/index';

export interface HostileImage {
  family: string;
  image: Uint8Array;
  expectWarning: boolean;
}

const MAX_IMAGE_BYTES = 2_949_120;
const RANDOM_MAX_LENGTH = 2_097_152;

/** Image byte length of each standard (fallback) geometry. */
const FALLBACK_SIZES: number[] = STANDARD_GEOMETRY_NAMES.map((name) => {
  const g = standardGeometry(name);
  return g.totalSectors * g.bytesPerSector;
});

/** Each fallback size, its +-1 and +-512 neighbours, and 2,949,120 / 2,949,121. */
const BOUNDARY_LENGTHS: number[] = [
  ...new Set(
    [
      ...FALLBACK_SIZES.flatMap((s) => [s - 512, s - 1, s, s + 1, s + 512]),
      MAX_IMAGE_BYTES,
      MAX_IMAGE_BYTES + 1,
    ].filter((n) => n >= 0),
  ),
];

// ---------------------------------------------------------------------------
// (a) random bytes
// ---------------------------------------------------------------------------

function plantBpb(bytes: Uint8Array, name: StandardGeometryName): void {
  if (bytes.length < 512) return;
  const g = standardGeometry(name);
  const u16 = (o: number, v: number): void => {
    bytes[o] = v & 0xff;
    bytes[o + 1] = (v >>> 8) & 0xff;
  };
  u16(0x0b, g.bytesPerSector);
  bytes[0x0d] = g.sectorsPerCluster;
  u16(0x0e, g.reservedSectors);
  bytes[0x10] = g.fatCount;
  u16(0x11, g.rootEntryCount);
  u16(0x13, g.totalSectors);
  bytes[0x15] = g.mediaDescriptor;
  u16(0x16, g.sectorsPerFat);
}

const lengthArb: fc.Arbitrary<number> = fc.oneof(
  { weight: 6, arbitrary: fc.integer({ min: 0, max: 4096 }) },
  { weight: 3, arbitrary: fc.constantFrom(...BOUNDARY_LENGTHS) },
  { weight: 1, arbitrary: fc.integer({ min: 0, max: RANDOM_MAX_LENGTH }) },
);

/** Random bytes (expanded from a seed), optionally with a planted 0x55AA signature or plausible BPB. */
export const randomBytesArb: fc.Arbitrary<HostileImage> = fc
  .record({
    seed: fc.integer({ min: 0, max: 0xffffffff }),
    length: lengthArb,
    plant: fc.constantFrom('none', 'none', 'signature', 'bpb'),
    geometryName: fc.constantFrom(...STANDARD_GEOMETRY_NAMES),
  })
  .map(({ seed, length, plant, geometryName }): HostileImage => {
    const image = expandContent(seed, length);
    if (plant !== 'none' && length >= 512) {
      if (plant === 'bpb') plantBpb(image, geometryName);
      image[510] = 0x55;
      image[511] = 0xaa;
    }
    return {
      family: 'random-bytes',
      image,
      expectWarning: length === 0 || length > MAX_IMAGE_BYTES,
    };
  });

// ---------------------------------------------------------------------------
// Small writer-built base images (cheap: 360K or 720K)
// ---------------------------------------------------------------------------

const SMALL_GEOMETRIES = ['360K', '720K'] as const;

const fileContentArb = (min: number, max: number): fc.Arbitrary<Uint8Array> =>
  fc
    .record({
      seed: fc.integer({ min: 0, max: 0xffffffff }),
      length: fc.integer({ min, max }),
    })
    .map(({ seed, length }) => expandContent(seed, length));

/*
 * Fixed shape so damage specs can name paths:
 *   /A.BIN  /B.TXT  /D1/C.BIN  /D1/D2/E.BIN
 * A.BIN, C.BIN and E.BIN have at least one byte, hence at least one cluster.
 */
const baseArb = fc
  .record({
    geometryName: fc.constantFrom(...SMALL_GEOMETRIES),
    a: fileContentArb(1, 3000),
    b: fileContentArb(0, 600),
    c: fileContentArb(1, 2500),
    e: fileContentArb(1, 2500),
  })
  .map(({ geometryName, a, b, c, e }) => {
    const tree: FileTree = {
      children: [
        { kind: 'file', name: 'A.BIN', content: a },
        { kind: 'file', name: 'B.TXT', content: b },
        {
          kind: 'directory',
          name: 'D1',
          children: [
            { kind: 'file', name: 'C.BIN', content: c },
            {
              kind: 'directory',
              name: 'D2',
              children: [{ kind: 'file', name: 'E.BIN', content: e }],
            },
          ],
        },
      ],
    };
    return { tree, geometryName };
  });

interface Base {
  layout: LayoutResult;
}

const cleanBaseArb: fc.Arbitrary<Base> = baseArb.map(({ tree, geometryName }) => ({
  layout: writeFat12ImageWithLayout(tree, geometryName),
}));

const FILE_PATHS = ['/A.BIN', '/D1/C.BIN', '/D1/D2/E.BIN'] as const;

// ---------------------------------------------------------------------------
// (b) random byte writes into a valid image
// ---------------------------------------------------------------------------

/** A valid image with 1 to 64 byte writes, biased toward the boot sector, FAT, root dir and first data clusters. */
export const mutatedImageArb: fc.Arbitrary<HostileImage> = cleanBaseArb
  .chain((base) =>
    fc
      .array(
        fc.record({
          region: fc.constantFrom('boot', 'boot', 'fat', 'fat', 'root', 'root', 'data', 'data', 'any'),
          pos: fc.integer({ min: 0, max: 0x7fffffff }),
          value: fc.integer({ min: 0, max: 255 }),
        }),
        { minLength: 1, maxLength: 64 },
      )
      .map((writes) => ({ base, writes })),
  )
  .map(({ base, writes }): HostileImage => {
    const { offsets } = base.layout;
    const image = base.layout.image.slice();
    const regions: Record<string, [number, number]> = {
      boot: [0, 512],
      fat: [offsets.fatStart, offsets.fatBytes * offsets.fatCount],
      root: [offsets.rootStart, offsets.rootBytes],
      data: [offsets.dataStart, Math.min(image.length - offsets.dataStart, 4 * offsets.clusterBytes)],
      any: [0, image.length],
    };
    for (const w of writes) {
      const [start, size] = regions[w.region] ?? [0, image.length];
      if (size <= 0) continue;
      image[start + (w.pos % size)] = w.value;
    }
    return { family: 'byte-writes', image, expectWarning: false };
  });

// ---------------------------------------------------------------------------
// (c) randomized FAT region
// ---------------------------------------------------------------------------

/** Valid BPB and directories, FAT bytes replaced by PRNG bytes (cycles, bad links, bad clusters in bulk). */
export const fatNoiseArb: fc.Arbitrary<HostileImage> = fc
  .record({
    base: cleanBaseArb,
    seed: fc.integer({ min: 0, max: 0xffffffff }),
    // A smaller mask keeps links small, so in-range links and cycles are likely.
    mask: fc.constantFrom(0xff, 0x0f, 0x03, 0x01),
    copies: fc.constantFrom('all', 'first-only'),
    keepMedia: fc.boolean(),
  })
  .map(({ base, seed, mask, copies, keepMedia }): HostileImage => {
    const { offsets } = base.layout;
    const image = base.layout.image.slice();
    const noise = expandContent(seed, offsets.fatBytes);
    for (let i = 0; i < noise.length; i++) noise[i] = (noise[i] as number) & mask;
    for (let c = 0; c < offsets.fatCount; c++) {
      if (copies === 'first-only' && c > 0) break;
      const start = offsets.fatStart + c * offsets.fatBytes;
      const copy = noise.slice();
      if (keepMedia) copy.set(image.subarray(start, start + 3), 0);
      image.set(copy, start);
    }
    return { family: 'fat-noise', image, expectWarning: false };
  });

// ---------------------------------------------------------------------------
// (d) randomized directory region
// ---------------------------------------------------------------------------

/** Root directory and/or the first subdirectory cluster replaced by PRNG bytes. */
export const dirNoiseArb: fc.Arbitrary<HostileImage> = fc
  .record({
    base: cleanBaseArb,
    seed: fc.integer({ min: 0, max: 0xffffffff }),
    target: fc.constantFrom('root', 'subdir', 'both'),
    mask: fc.constantFrom(0xff, 0xff, 0x7f, 0x0f),
  })
  .map(({ base, seed, target, mask }): HostileImage => {
    const { offsets, nodes } = base.layout;
    const image = base.layout.image.slice();
    const fill = (start: number, size: number, s: number): void => {
      const noise = expandContent(s, size);
      for (let i = 0; i < size; i++) image[start + i] = (noise[i] as number) & mask;
    };
    if (target === 'root' || target === 'both') fill(offsets.rootStart, offsets.rootBytes, seed);
    if (target === 'subdir' || target === 'both') {
      const d1 = nodes.get('/D1');
      if (d1 !== undefined && d1.startCluster >= 2) {
        fill(
          offsets.dataStart + (d1.startCluster - 2) * offsets.clusterBytes,
          offsets.clusterBytes,
          seed ^ 0x9e3779b9,
        );
      }
    }
    return { family: 'dir-noise', image, expectWarning: false };
  });

// ---------------------------------------------------------------------------
// (e) targeted defects via the writer's damage option
// ---------------------------------------------------------------------------

const filePathArb = fc.constantFrom(...FILE_PATHS);

const defectArb: fc.Arbitrary<(imageBytes: number) => DamageSpec[]> = fc.oneof(
  // A lone cyclic chain is not detected when the declared size is covered before
  // the loop, so pair it with size-exceeds-chain so the loop is actually reached.
  fc
    .record({ path: filePathArb, extra: fc.integer({ min: 1, max: 100_000 }) })
    .map(({ path, extra }) => (): DamageSpec[] => [
      { type: 'cyclic-chain', path },
      { type: 'size-exceeds-chain', path, extraBytes: extra },
    ]),
  // Likewise: a bad link after the last needed cluster is never followed, so
  // pair it with size-exceeds-chain to force the reader to reach it.
  fc
    .record({ path: filePathArb, extra: fc.integer({ min: 1, max: 100_000 }) })
    .map(({ path, extra }) => (): DamageSpec[] => [
      { type: 'cluster-out-of-range', path },
      { type: 'size-exceeds-chain', path, extraBytes: extra },
    ]),
  // Non-root directory that has a subdirectory.
  fc.constant((): DamageSpec[] => [{ type: 'self-referencing-directory', path: '/D1' }]),
  // Declared size greater than the image size.
  fc
    .record({
      path: filePathArb,
      huge: fc.boolean(),
      k: fc.integer({ min: 1, max: 1000 }),
    })
    .map(({ path, huge, k }) => (imageBytes: number): DamageSpec[] => [
      { type: 'size-exceeds-chain', path, extraBytes: huge ? 0xffffffff : imageBytes + k },
    ]),
  fc
    .constantFrom(
      'bytesPerSector',
      'sectorsPerCluster',
      'fatCount',
      'rootEntryCount',
      'sectorsPerFat',
      'totalSectors',
    )
    .map((field) => (): DamageSpec[] => [{ type: 'invalid-bpb', field }]),
);

/** Writer-built images with one targeted defect; always expect at least one warning. */
export const targetedDefectArb: fc.Arbitrary<HostileImage> = fc
  .record({ base: baseArb, defect: defectArb })
  .map(({ base, defect }): HostileImage => {
    const g = standardGeometry(base.geometryName);
    const damage = defect(g.totalSectors * g.bytesPerSector);
    const { image } = writeFat12ImageWithLayout(base.tree, base.geometryName, { damage });
    return { family: 'targeted-defect', image, expectWarning: true };
  });

// ---------------------------------------------------------------------------
// Oversized images (> 2,949,120 bytes)
// ---------------------------------------------------------------------------

/** Mostly just over the limit; always warns (image-too-large). */
export const oversizedImageArb: fc.Arbitrary<HostileImage> = fc
  .record({
    seed: fc.integer({ min: 0, max: 0xffffffff }),
    length: fc.oneof(
      { weight: 2, arbitrary: fc.constant(MAX_IMAGE_BYTES + 1) },
      { weight: 2, arbitrary: fc.integer({ min: MAX_IMAGE_BYTES + 1, max: MAX_IMAGE_BYTES + 4096 }) },
      { weight: 1, arbitrary: fc.integer({ min: MAX_IMAGE_BYTES + 1, max: 3_500_000 }) },
    ),
  })
  .map(({ seed, length }): HostileImage => ({
    family: 'oversized',
    image: expandContent(seed, length),
    expectWarning: true,
  }));

// ---------------------------------------------------------------------------
// All families
// ---------------------------------------------------------------------------

/** Mixed hostile images; the 2 MB random family is a small minority by weight. */
export const hostileImageArb: fc.Arbitrary<HostileImage> = fc.oneof(
  { weight: 4, arbitrary: randomBytesArb },
  { weight: 4, arbitrary: mutatedImageArb },
  { weight: 3, arbitrary: fatNoiseArb },
  { weight: 3, arbitrary: dirNoiseArb },
  { weight: 4, arbitrary: targetedDefectArb },
  { weight: 1, arbitrary: oversizedImageArb },
);
