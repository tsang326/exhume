import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { numRuns } from '../../test-support/runs';
import { makeByteView } from './bytes';
import { chooseGeometry, deriveLayout, FALLBACK_GEOMETRIES, isValidBpb, parseBpb } from './geometry';
import { makeWarningSink } from './warnings';

interface Bpb {
  bps: number;
  spc: number;
  res: number;
  fats: number;
  root: number;
  total: number;
  spf: number;
  media: number;
}

/** Build an image with hand-written BPB fields. */
function build(length: number, bpb: Bpb | null, opts: { signature?: boolean; fatByte?: number } = {}): Uint8Array {
  const img = new Uint8Array(length);
  const dv = new DataView(img.buffer);
  if (bpb) {
    dv.setUint16(0x0b, bpb.bps, true);
    img[0x0d] = bpb.spc;
    dv.setUint16(0x0e, bpb.res, true);
    img[0x10] = bpb.fats;
    dv.setUint16(0x11, bpb.root, true);
    dv.setUint16(0x13, bpb.total, true);
    img[0x15] = bpb.media;
    dv.setUint16(0x16, bpb.spf, true);
    if (length > bpb.res * bpb.bps) img[bpb.res * bpb.bps] = opts.fatByte ?? bpb.media;
  }
  if (opts.signature !== false && length >= 512) {
    img[510] = 0x55;
    img[511] = 0xaa;
  }
  return img;
}

const std = (b: Partial<Bpb> = {}): Bpb => ({
  bps: 512, spc: 1, res: 1, fats: 2, root: 224, total: 2880, spf: 9, media: 0xf0, ...b,
});

// [label, length, spc, root, total, spf, media] — literals independent of geometry.ts
const FALLBACKS: Array<[string, number, number, number, number, number, number]> = [
  ['160K', 163_840, 1, 64, 320, 1, 0xfe],
  ['180K', 184_320, 1, 64, 360, 2, 0xfc],
  ['320K', 327_680, 2, 112, 640, 1, 0xff],
  ['360K', 368_640, 2, 112, 720, 2, 0xfd],
  ['720K', 737_280, 2, 112, 1440, 3, 0xf9],
  ['1.2M', 1_228_800, 1, 224, 2400, 7, 0xf9],
  ['1.44M', 1_474_560, 1, 224, 2880, 9, 0xf0],
  ['2.88M', 2_949_120, 2, 240, 5760, 9, 0xf0],
];

function run(img: Uint8Array) {
  const sink = makeWarningSink();
  const choice = chooseGeometry(makeByteView(img), sink);
  return { choice, codes: sink.list().map((w) => w.code) };
}

describe('fallback geometries', () => {
  it('has exactly eight entries', () => {
    expect(FALLBACK_GEOMETRIES.size).toBe(8);
  });

  it.each(FALLBACKS)('%s: junk BPB selects fallback', (_l, length, spc, root, total, spf, media) => {
    const img = new Uint8Array(length);
    img[510] = 0x55;
    img[511] = 0xaa;
    img[512] = media; // FAT 1 first byte (reserved = 1 sector)
    const { choice, codes } = run(img);
    expect(choice.source).toBe('fallback');
    if (choice.source === 'none') throw new Error('unreachable');
    expect(choice.layout).toMatchObject({
      bytesPerSector: 512,
      sectorsPerCluster: spc,
      reservedSectors: 1,
      fatCount: 2,
      rootEntryCount: root,
      totalSectors: total,
      sectorsPerFat: spf,
      mediaDescriptor: media,
    });
    expect(choice.fat12).toBe(true);
    expect(codes).toContain('bpb-invalid');
  });
});

describe('chooseGeometry', () => {
  it('uses a valid BPB', () => {
    const { choice, codes } = run(build(1_474_560, std()));
    expect(choice.source).toBe('bpb');
    if (choice.source === 'none') throw new Error('unreachable');
    expect(choice.fat12).toBe(true);
    expect(choice.layout.totalSectors).toBe(2880);
    expect(codes).toEqual([]);
  });

  it('reports geometry-unknown for images below 512 bytes', () => {
    const { choice, codes } = run(new Uint8Array(100));
    expect(choice.source).toBe('none');
    expect(codes).toEqual(['geometry-unknown']);
  });

  it('reports geometry-unknown for unknown length with invalid BPB', () => {
    const { choice, codes } = run(build(10_000, null));
    expect(choice.source).toBe('none');
    expect(codes).toContain('geometry-unknown');
    expect(choice.rawLabel).toHaveLength(11);
  });

  it('reports not-fat12 for 4085 or more data clusters', () => {
    // dataStart = 1 + 2*2 + 14 = 19 sectors; (5000 - 19) / 1 = 4981 clusters
    const bpb = std({ total: 5000, spf: 2 });
    const { choice, codes } = run(build(5000 * 512, bpb));
    expect(choice.source).toBe('bpb');
    if (choice.source === 'none') throw new Error('unreachable');
    expect(choice.layout.dataClusters).toBe(4981);
    expect(choice.fat12).toBe(false);
    expect(codes).toEqual(['not-fat12']);
  });

  it('accepts exactly 4084 data clusters as FAT12', () => {
    const bpb = std({ total: 4084 + 19, spf: 2 });
    const { choice, codes } = run(build(bpb.total * 512, bpb));
    if (choice.source === 'none') throw new Error('unreachable');
    expect(choice.layout.dataClusters).toBe(4084);
    expect(choice.fat12).toBe(true);
    expect(codes).not.toContain('not-fat12');
  });

  it('adds boot-signature-missing without changing validation', () => {
    const { choice, codes } = run(build(1_474_560, std(), { signature: false }));
    expect(choice.source).toBe('bpb');
    expect(codes).toEqual(['boot-signature-missing']);
  });

  it('adds media-mismatch when FAT byte differs from descriptor', () => {
    const { choice, codes } = run(build(1_474_560, std(), { fatByte: 0xf8 }));
    expect(choice.source).toBe('bpb');
    expect(codes).toEqual(['media-mismatch']);
  });
});

describe('deriveLayout', () => {
  it('computes offsets for 1.44M', () => {
    const l = deriveLayout({
      bytesPerSector: 512, sectorsPerCluster: 1, reservedSectors: 1, fatCount: 2,
      rootEntryCount: 224, totalSectors: 2880, sectorsPerFat: 9, mediaDescriptor: 0xf0,
    });
    expect(l.fatStart).toBe(512);
    expect(l.rootStart).toBe(19 * 512);
    expect(l.dataStart).toBe(33 * 512);
    expect(l.dataClusters).toBe(2847);
    expect(l.maxCluster).toBe(2848);
  });
});

// Feature: fat12-core, Property 7: BPB validation and geometry selection
// **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.6, 3.7**
describe('Property 7: BPB validation and geometry selection', () => {
  // Independent literal list of the eight fallback image lengths (Requirement 3.5).
  const FALLBACK_LENGTHS = [163_840, 184_320, 327_680, 368_640, 737_280, 1_228_800, 1_474_560, 2_949_120];

  interface Fields {
    bps: number;
    spc: number;
    res: number;
    fats: number;
    root: number;
    total16: number;
    total32: number;
    spf: number;
    media: number;
  }

  /** Independent oracle for the nine conditions of Requirement 3.2. */
  function oracle(f: Fields, length: number): boolean {
    const total = f.total16 !== 0 ? f.total16 : f.total32;
    const bpsOk = [512, 1024, 2048, 4096].includes(f.bps);
    const spcOk = [1, 2, 4, 8, 16, 32, 64, 128].includes(f.spc);
    const resOk = f.res >= 1;
    const fatsOk = f.fats === 1 || f.fats === 2;
    const rootOk = f.root > 0;
    const spfOk = f.spf > 0;
    const totalOk = total > 0;
    if (!(bpsOk && spcOk && resOk && fatsOk && rootOk && spfOk && totalOk)) return false;
    if (total * f.bps > length) return false;
    const rootSectors = Math.floor((f.root * 32 + f.bps - 1) / f.bps);
    const dataStart = f.res + f.fats * f.spf + rootSectors;
    return dataStart < total;
  }

  const lengthArb = fc.oneof(
    { weight: 2, arbitrary: fc.constantFrom(...FALLBACK_LENGTHS) },
    { weight: 1, arbitrary: fc.integer({ min: 0, max: 511 }) },
    { weight: 1, arbitrary: fc.constantFrom(512, 513, 1024, 4096) },
    { weight: 4, arbitrary: fc.integer({ min: 512, max: 40_000 }) },
  );

  const fieldsArb = (length: number): fc.Arbitrary<Fields> => {
    const bps = fc.oneof(
      { weight: 6, arbitrary: fc.constantFrom(512, 1024, 2048, 4096) },
      { weight: 2, arbitrary: fc.constantFrom(0, 1, 256, 511, 513, 8192, 65_535) },
      { weight: 1, arbitrary: fc.integer({ min: 0, max: 65_535 }) },
    );
    const spc = fc.oneof(
      { weight: 6, arbitrary: fc.constantFrom(1, 2, 4, 8, 16, 32, 64, 128) },
      { weight: 2, arbitrary: fc.constantFrom(0, 3, 6, 129, 192, 255) },
      { weight: 1, arbitrary: fc.integer({ min: 0, max: 255 }) },
    );
    const res = fc.oneof(
      { weight: 4, arbitrary: fc.integer({ min: 1, max: 4 }) },
      { weight: 2, arbitrary: fc.constantFrom(0, 65_535) },
      { weight: 1, arbitrary: fc.integer({ min: 0, max: 65_535 }) },
    );
    const fats = fc.oneof(
      { weight: 6, arbitrary: fc.constantFrom(1, 2) },
      { weight: 2, arbitrary: fc.constantFrom(0, 3, 255) },
      { weight: 1, arbitrary: fc.integer({ min: 0, max: 255 }) },
    );
    const root = fc.oneof(
      { weight: 4, arbitrary: fc.constantFrom(1, 16, 64, 112, 224) },
      { weight: 2, arbitrary: fc.constantFrom(0, 65_535) },
      { weight: 1, arbitrary: fc.integer({ min: 0, max: 65_535 }) },
    );
    const spf = fc.oneof(
      { weight: 4, arbitrary: fc.integer({ min: 1, max: 9 }) },
      { weight: 2, arbitrary: fc.constantFrom(0, 65_535) },
      { weight: 1, arbitrary: fc.integer({ min: 0, max: 65_535 }) },
    );
    // Totals cluster around the image length in sectors to probe the length condition.
    const total = fc
      .tuple(fc.constantFrom(512, 1024, 2048, 4096), fc.integer({ min: -2, max: 2 }))
      .map(([b, d]) => Math.max(0, Math.floor(length / b) + d));
    const total16 = fc.oneof(
      { weight: 3, arbitrary: total.map((t) => Math.min(t, 65_535)) },
      { weight: 2, arbitrary: fc.constant(0) },
      { weight: 2, arbitrary: fc.integer({ min: 0, max: 40 }) },
      { weight: 1, arbitrary: fc.integer({ min: 0, max: 65_535 }) },
    );
    const total32 = fc.oneof(
      { weight: 3, arbitrary: total },
      { weight: 1, arbitrary: fc.constantFrom(0, 0xffff_ffff) },
      { weight: 1, arbitrary: fc.integer({ min: 0, max: 0xffff_ffff }) },
    );
    return fc.record({
      bps, spc, res, fats, root, total16, total32, spf, media: fc.integer({ min: 0, max: 255 }),
    });
  };

  const caseArb = lengthArb.chain((length) => fieldsArb(length).map((fields) => ({ length, fields })));

  function writeFields(length: number, f: Fields): Uint8Array {
    const img = new Uint8Array(length);
    if (length >= 0x24) {
      const dv = new DataView(img.buffer);
      dv.setUint16(0x0b, f.bps, true);
      img[0x0d] = f.spc;
      dv.setUint16(0x0e, f.res, true);
      img[0x10] = f.fats;
      dv.setUint16(0x11, f.root, true);
      dv.setUint16(0x13, f.total16, true);
      img[0x15] = f.media;
      dv.setUint16(0x16, f.spf, true);
      dv.setUint32(0x20, f.total32, true);
    }
    return img;
  }

  it('isValidBpb matches the oracle and chooseGeometry selects the right source', () => {
    fc.assert(
      fc.property(caseArb, ({ length, fields }) => {
        const img = writeFields(length, fields);
        const sink = makeWarningSink();
        const choice = chooseGeometry(makeByteView(img), sink);
        const codes = sink.list().map((w) => w.code);

        if (length < 512) {
          return choice.source === 'none' && codes.includes('geometry-unknown');
        }

        const valid = oracle(fields, length);
        const total = fields.total16 !== 0 ? fields.total16 : fields.total32;
        const geometry = {
          bytesPerSector: fields.bps,
          sectorsPerCluster: fields.spc,
          reservedSectors: fields.res,
          fatCount: fields.fats,
          rootEntryCount: fields.root,
          totalSectors: total,
          sectorsPerFat: fields.spf,
          mediaDescriptor: fields.media,
        };
        if (isValidBpb(geometry, length) !== valid) return false;
        const parsed = parseBpb(makeByteView(img));
        if (parsed === undefined || isValidBpb(parsed, length) !== valid) return false;

        if (valid) {
          return choice.source === 'bpb' && !codes.includes('bpb-invalid') && !codes.includes('geometry-unknown');
        }
        if (FALLBACK_LENGTHS.includes(length)) {
          return choice.source === 'fallback' && codes.includes('bpb-invalid') && !codes.includes('geometry-unknown');
        }
        return choice.source === 'none' && codes.includes('geometry-unknown') && !codes.includes('bpb-invalid');
      }),
      { numRuns: numRuns(100) },
    );
  });
});
