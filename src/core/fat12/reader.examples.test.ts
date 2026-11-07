/**
 * Reader example tests (task 13.6). Images come from the test-only writer, then are
 * damaged either by writer damage options or by patching bytes through the layout offsets.
 * Every test asserts the warning code (and path), the state of the affected Grave, and that
 * an untouched control file stays alive with readable bytes.
 */

import { describe, expect, it } from 'vitest';
import { writeFat12ImageWithLayout } from '../../test-support/fat12';
import type { DirNode, FileNode, FileTree, Geometry, LayoutResult, TreeNode, WriteOptions } from '../../test-support/fat12';
import { writeFatEntry } from '../../test-support/fat12/encode';
import { openDisk, WarningCode } from './index';
import type { DiskHandle, Grave, Warning } from './index';

// ---- helpers ---------------------------------------------------------------

function pattern(n: number, seed: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (i * 7 + seed) & 0xff;
  return out;
}

function file(name: string, content: Uint8Array): FileNode {
  return { kind: 'file', name, content };
}

function dir(name: string, children: TreeNode[]): DirNode {
  return { kind: 'directory', name, children };
}

/** Control file used to prove other entries are unaffected. */
const CONTROL_PATH = '/CTRL.TXT';
const CONTROL = pattern(700, 3);
const control = (): FileNode => file('CTRL.TXT', CONTROL);

function build(tree: FileTree, options: WriteOptions = {}, geometry: Geometry | '1440K' = '1440K'): LayoutResult {
  return writeFat12ImageWithLayout(tree, geometry, options);
}

function node(layout: LayoutResult, path: string) {
  const info = layout.nodes.get(path);
  if (info === undefined) throw new Error(`test setup: no node ${path}`);
  return info;
}

function graveAt(handle: DiskHandle, path: string): Grave {
  const g = handle.report.files.find((f) => f.path === path);
  if (g === undefined) throw new Error(`no grave at ${path}; have ${handle.report.files.map((f) => f.path).join(', ')}`);
  return g;
}

function warningsOf(handle: DiskHandle, code: string): Warning[] {
  return handle.report.warnings.filter((w) => w.code === code);
}

function read(handle: DiskHandle, path: string): { bytes: Uint8Array; warnings: Warning[] } {
  const r = handle.readBytes(graveAt(handle, path));
  if (!r.ok) throw new Error(`read of ${path} failed: ${r.error}`);
  return r;
}

function expectControlAlive(handle: DiskHandle): void {
  expect(graveAt(handle, CONTROL_PATH).state).toBe('alive');
  expect(read(handle, CONTROL_PATH).bytes).toEqual(CONTROL);
}

function setU16(b: Uint8Array, o: number, v: number): void {
  b[o] = v & 0xff;
  b[o + 1] = (v >>> 8) & 0xff;
}

/** Set one FAT entry in every FAT copy. */
function setFatBoth(layout: LayoutResult, cluster: number, value: number): void {
  const { fatStart, fatBytes, fatCount } = layout.offsets;
  for (let c = 0; c < fatCount; c++) {
    const start = fatStart + c * fatBytes;
    writeFatEntry(layout.image.subarray(start, start + fatBytes), cluster, value);
  }
}

// ---- tests -----------------------------------------------------------------

describe('reader examples: image and FAT level', () => {
  it('image-empty: an empty image reports image-empty and no files', () => {
    const handle = openDisk(new Uint8Array(0));
    expect(handle.report.files).toEqual([]);
    expect(warningsOf(handle, WarningCode.ImageEmpty)).toHaveLength(1);
  });

  it('fat-copies-differ: one flipped byte in FAT 2 warns, nothing else changes', () => {
    const layout = build({ children: [file('A.TXT', pattern(1200, 1)), control()] });
    const { fatStart, fatBytes } = layout.offsets;
    layout.image[fatStart + fatBytes + 100] ^= 0xff;

    const handle = openDisk(layout.image);
    expect(warningsOf(handle, WarningCode.FatCopiesDiffer)).toHaveLength(1);
    expect(graveAt(handle, '/A.TXT').state).toBe('alive');
    expect(read(handle, '/A.TXT').bytes).toEqual(pattern(1200, 1));
    expectControlAlive(handle);
  });

  it('truncated FAT: a chain that runs past a short FAT reports out-of-bounds-read', () => {
    // A cut image fails BPB validation (total sectors * bps > length) and cannot exercise
    // FAT bounds. Instead: a valid image whose FAT is only 3 sectors (1024 entries) while the
    // data area holds 2859 clusters, and an entry patched to start at cluster 1500, whose
    // FAT entry lies outside the FAT.
    const geometry: Geometry = {
      bytesPerSector: 512,
      sectorsPerCluster: 1,
      reservedSectors: 1,
      fatCount: 2,
      rootEntryCount: 224,
      totalSectors: 2880,
      sectorsPerFat: 3,
      mediaDescriptor: 0xf0,
    };
    const layout = build({ children: [file('TRUNC.TXT', pattern(1000, 5)), control()] }, {}, geometry);
    const entry = node(layout, '/TRUNC.TXT').entryOffset;
    setU16(layout.image, entry + 26, 1500);

    const handle = openDisk(layout.image);
    const w = warningsOf(handle, WarningCode.OutOfBoundsRead);
    expect(w).toHaveLength(1);
    expect(w[0]?.path).toBe('/TRUNC.TXT');
    expect(graveAt(handle, '/TRUNC.TXT').state).toBe('partial');
    const r = read(handle, '/TRUNC.TXT');
    expect(r.bytes).toHaveLength(512);
    expect(r.warnings.some((x) => x.code === WarningCode.OutOfBoundsRead)).toBe(true);
    expectControlAlive(handle);
  });
});

describe('reader examples: cluster chains', () => {
  it('chain-bad-cluster: a link set to 0xFF7 in both FATs stops the chain', () => {
    const data = pattern(3 * 512, 9);
    const layout = build({ children: [file('BAD.TXT', data), control()] });
    setFatBoth(layout, node(layout, '/BAD.TXT').clusters[0] as number, 0xff7);

    const handle = openDisk(layout.image);
    const w = warningsOf(handle, WarningCode.ChainBadCluster);
    expect(w).toHaveLength(1);
    expect(w[0]?.path).toBe('/BAD.TXT');
    expect(graveAt(handle, '/BAD.TXT').state).toBe('partial');
    const r = read(handle, '/BAD.TXT');
    expect(r.bytes).toEqual(data.subarray(0, 512));
    expect(r.warnings.some((x) => x.code === WarningCode.ChainBadCluster)).toBe(true);
    expect(warningsOf(handle, WarningCode.FatCopiesDiffer)).toHaveLength(0);
    expectControlAlive(handle);
  });

  it('chain-truncated: a mid-chain link set to 0x000 ends the chain early', () => {
    const data = pattern(4 * 512, 11);
    const layout = build({ children: [file('CUT.TXT', data), control()] });
    setFatBoth(layout, node(layout, '/CUT.TXT').clusters[1] as number, 0x000);

    const handle = openDisk(layout.image);
    const w = warningsOf(handle, WarningCode.ChainTruncated);
    expect(w).toHaveLength(1);
    expect(w[0]?.path).toBe('/CUT.TXT');
    expect(graveAt(handle, '/CUT.TXT').state).toBe('partial');
    expect(read(handle, '/CUT.TXT').bytes).toEqual(data.subarray(0, 2 * 512));
    expectControlAlive(handle);
  });

  it('chain-short: declared size slightly above the chain, within capacity', () => {
    const data = pattern(2 * 512, 13);
    const layout = build(
      { children: [file('SHORT.TXT', data), control()] },
      { damage: [{ type: 'size-exceeds-chain', path: '/SHORT.TXT', extraBytes: 100 }] },
    );

    const handle = openDisk(layout.image);
    const w = warningsOf(handle, WarningCode.ChainShort);
    expect(w).toHaveLength(1);
    expect(w[0]?.path).toBe('/SHORT.TXT');
    expect(warningsOf(handle, WarningCode.SizeExceedsDisk)).toHaveLength(0);
    expect(graveAt(handle, '/SHORT.TXT').state).toBe('partial');
    const r = read(handle, '/SHORT.TXT');
    expect(r.bytes).toEqual(data);
    expect(r.warnings.some((x) => x.code === WarningCode.ChainShort)).toBe(true);
    expectControlAlive(handle);
  });

  it('size-exceeds-disk: declared size above data capacity, below the output cap', () => {
    const data = pattern(2 * 512, 15);
    const layout = build(
      { children: [file('BIG.TXT', data), control()] },
      { damage: [{ type: 'size-exceeds-chain', path: '/BIG.TXT', extraBytes: 3_000_000 }] },
    );

    const handle = openDisk(layout.image);
    const w = warningsOf(handle, WarningCode.SizeExceedsDisk);
    expect(w).toHaveLength(1);
    expect(w[0]?.path).toBe('/BIG.TXT');
    expect(warningsOf(handle, WarningCode.ChainShort)).toHaveLength(0);
    expect(graveAt(handle, '/BIG.TXT').state).toBe('partial');
    const r = read(handle, '/BIG.TXT');
    expect(r.bytes).toEqual(data);
    expect(r.warnings.map((x) => x.code)).toContain(WarningCode.SizeExceedsDisk);
    expect(r.warnings.map((x) => x.code)).not.toContain(WarningCode.OutputCapped);
    expectControlAlive(handle);
  });

  it('output-capped: declared size 0xFFFFFFFF gives output-capped and size-exceeds-disk', () => {
    const data = pattern(3 * 512, 17);
    const layout = build(
      { children: [file('HUGE.TXT', data), control()] },
      { damage: [{ type: 'size-exceeds-chain', path: '/HUGE.TXT', extraBytes: 0xffffffff }] },
    );

    const handle = openDisk(layout.image);
    const grave = graveAt(handle, '/HUGE.TXT');
    expect(grave.size).toBe(0xffffffff);
    expect(grave.state).toBe('partial');
    const r = read(handle, '/HUGE.TXT');
    const codes = r.warnings.map((x) => x.code);
    expect(codes).toContain(WarningCode.OutputCapped);
    expect(codes).toContain(WarningCode.SizeExceedsDisk);
    expect(r.bytes.length).toBeLessThanOrEqual(3 * 512);
    expect(r.bytes).toEqual(data);
    expectControlAlive(handle);
  });

  it('cyclic-chain: a chain that links back to its start reports chain-cycle', () => {
    // A cycle is only visible when the declared size needs more clusters than the chain
    // holds; a cyclic file whose size is covered by its first N clusters is fully readable
    // and the walk stops before reading the cyclic link. So grow the size first, then loop.
    const data = pattern(3 * 512, 19);
    const layout = build(
      { children: [file('LOOP.TXT', data), control()] },
      {
        damage: [
          { type: 'size-exceeds-chain', path: '/LOOP.TXT', extraBytes: 100 },
          { type: 'cyclic-chain', path: '/LOOP.TXT' },
        ],
      },
    );

    const handle = openDisk(layout.image);
    const w = warningsOf(handle, WarningCode.ChainCycle);
    expect(w).toHaveLength(1);
    expect(w[0]?.path).toBe('/LOOP.TXT');
    expect(graveAt(handle, '/LOOP.TXT').state).toBe('partial');
    expect(read(handle, '/LOOP.TXT').bytes).toEqual(data);
    expectControlAlive(handle);
  });

  it('cluster-out-of-range damage: a link past the last cluster is reported', () => {
    const data = pattern(3 * 512, 21);
    const layout = build(
      { children: [file('RANGE.TXT', data), control()] },
      { damage: [{ type: 'cluster-out-of-range', path: '/RANGE.TXT' }] },
    );

    const handle = openDisk(layout.image);
    const w = warningsOf(handle, WarningCode.ClusterOutOfRange);
    expect(w).toHaveLength(1);
    expect(w[0]?.path).toBe('/RANGE.TXT');
    expect(graveAt(handle, '/RANGE.TXT').state).toBe('partial');
    expect(read(handle, '/RANGE.TXT').bytes).toEqual(data.subarray(0, 512));
    expectControlAlive(handle);
  });
});

describe('reader examples: directories', () => {
  it('entries after a 0x00 terminator are ignored', () => {
    const layout = build({
      children: [file('A.TXT', pattern(10, 1)), file('B.TXT', pattern(10, 2)), file('C.TXT', pattern(10, 3))],
    });
    layout.image[node(layout, '/B.TXT').entryOffset] = 0x00;

    const handle = openDisk(layout.image);
    expect(handle.report.files.map((f) => f.path)).toEqual(['/A.TXT']);
    expect(graveAt(handle, '/A.TXT').state).toBe('alive');
    expect(read(handle, '/A.TXT').bytes).toEqual(pattern(10, 1));
  });

  it('directory-duplicate: two entries with the same directory cluster', () => {
    const layout = build({
      children: [
        dir('DIRA', [file('F.TXT', pattern(100, 1))]),
        dir('DIRB', [file('G.TXT', pattern(100, 2))]),
        control(),
      ],
    });
    setU16(layout.image, node(layout, '/DIRB').entryOffset + 26, node(layout, '/DIRA').startCluster);

    const handle = openDisk(layout.image);
    const w = warningsOf(handle, WarningCode.DirectoryDuplicate);
    expect(w).toHaveLength(1);
    expect(w[0]?.path).toBe('/DIRB');
    expect(graveAt(handle, '/DIRB').state).toBe('partial');
    expect(graveAt(handle, '/DIRA').state).toBe('alive');
    expect(graveAt(handle, '/DIRA/F.TXT').state).toBe('alive');
    expect(read(handle, '/DIRA/F.TXT').bytes).toEqual(pattern(100, 1));
    expect(handle.report.files.some((f) => f.path.startsWith('/DIRB/'))).toBe(false);
    expectControlAlive(handle);
  });

  it.each([
    ['0', (_l: LayoutResult) => 0],
    ['above the maximum', (l: LayoutResult) => l.offsets.dataClusters + 2],
  ])('directory start cluster %s: cluster-out-of-range and lost', (_label, pick) => {
    const layout = build({ children: [dir('DIRX', [file('IN.TXT', pattern(50, 4))]), control()] });
    setU16(layout.image, node(layout, '/DIRX').entryOffset + 26, pick(layout));

    const handle = openDisk(layout.image);
    const w = warningsOf(handle, WarningCode.ClusterOutOfRange);
    expect(w).toHaveLength(1);
    expect(w[0]?.path).toBe('/DIRX');
    const g = graveAt(handle, '/DIRX');
    expect(g.kind).toBe('directory');
    expect(g.state).toBe('lost');
    expect(handle.report.files.some((f) => f.path === '/DIRX/IN.TXT')).toBe(false);
    expectControlAlive(handle);
  });

  it('self-referencing-directory: a child pointing at its parent gives directory-loop', () => {
    const layout = build(
      { children: [dir('OUTER', [dir('INNER', [file('F.TXT', pattern(30, 6))]), file('SIDE.TXT', pattern(30, 7))]), control()] },
      { damage: [{ type: 'self-referencing-directory', path: '/OUTER' }] },
    );

    const handle = openDisk(layout.image);
    const w = warningsOf(handle, WarningCode.DirectoryLoop);
    expect(w).toHaveLength(1);
    expect(w[0]?.path).toBe('/OUTER/INNER');
    expect(graveAt(handle, '/OUTER/INNER').state).toBe('partial');
    expect(handle.report.files.some((f) => f.path === '/OUTER/INNER/F.TXT')).toBe(false);
    expect(graveAt(handle, '/OUTER').state).toBe('alive');
    expect(graveAt(handle, '/OUTER/SIDE.TXT').state).toBe('alive');
    expect(read(handle, '/OUTER/SIDE.TXT').bytes).toEqual(pattern(30, 7));
    expectControlAlive(handle);
  });

  it('17 nested directories: depth-exceeded, no path deeper than 16 components', () => {
    const name = (i: number): string => `D${String(i).padStart(2, '0')}`;
    let nested: DirNode = dir(name(17), [file('DEEP.TXT', pattern(10, 8))]);
    for (let i = 16; i >= 1; i--) {
      nested = dir(name(i), i === 1 ? [file('TOP.TXT', pattern(10, 9)), nested] : [nested]);
    }
    const layout = build({ children: [nested, control()] });

    const handle = openDisk(layout.image);
    const path16 = '/' + Array.from({ length: 16 }, (_, i) => name(i + 1)).join('/');
    const w = warningsOf(handle, WarningCode.DepthExceeded);
    expect(w).toHaveLength(1);
    expect(w[0]?.path).toBe(path16);
    expect(graveAt(handle, path16).state).toBe('partial');
    for (const f of handle.report.files) {
      expect(f.path.split('/').length - 1).toBeLessThanOrEqual(16);
    }
    expect(handle.report.files.some((f) => f.path.includes('D17'))).toBe(false);
    expect(graveAt(handle, '/D01/TOP.TXT').state).toBe('alive');
    expect(read(handle, '/D01/TOP.TXT').bytes).toEqual(pattern(10, 9));
    expect(graveAt(handle, '/D01/D02/D03/D04/D05/D06/D07/D08/D09/D10/D11/D12/D13/D14/D15').state).toBe('alive');
    expectControlAlive(handle);
  });

  it('volume label entry is not a file and the label is reported in volume.label', () => {
    const layout = build({ volumeLabel: 'MYDISK', children: [control()] });
    expect(layout.labelEntryOffset).toBeDefined();

    const handle = openDisk(layout.image);
    expect(handle.report.volume.label).toBe('MYDISK');
    expect(handle.report.files.map((f) => f.path)).toEqual([CONTROL_PATH]);
    expectControlAlive(handle);
  });

  it('date-invalid: an impossible month gives date null and a warning, file stays alive', () => {
    const layout = build({ children: [file('DATE.TXT', pattern(40, 2)), control()] });
    setU16(layout.image, node(layout, '/DATE.TXT').entryOffset + 24, ((2001 - 1980) << 9) | (13 << 5) | 1);

    const handle = openDisk(layout.image);
    const w = warningsOf(handle, WarningCode.DateInvalid);
    expect(w).toHaveLength(1);
    expect(w[0]?.path).toBe('/DATE.TXT');
    const g = graveAt(handle, '/DATE.TXT');
    expect(g.date).toBeNull();
    expect(g.state).toBe('alive');
    expect(read(handle, '/DATE.TXT').bytes).toEqual(pattern(40, 2));
    expect(graveAt(handle, CONTROL_PATH).date).toBe('1980-01-01T00:00:00');
    expectControlAlive(handle);
  });
});
