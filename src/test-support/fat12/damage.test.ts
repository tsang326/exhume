import { describe, expect, it } from 'vitest';
import { applyDamage } from './damage';
import { layoutImage } from './layout';
import type { LayoutResult } from './layout';
import { standardGeometry } from './measure';
import type { DamageSpec, FileTree } from './types';

const g = standardGeometry('1440K');

const tree: FileTree = {
  children: [
    { kind: 'file', name: 'BIG.BIN', content: new Uint8Array(1500).fill(7) },
    { kind: 'file', name: 'ONE.TXT', content: new Uint8Array(10).fill(1) },
    { kind: 'file', name: 'EMPTY', content: new Uint8Array(0) },
    {
      kind: 'file',
      name: 'LONGNA~1.TXT',
      longName: 'A long file name.txt',
      content: new Uint8Array(5).fill(2),
    },
    {
      kind: 'directory',
      name: 'DIR',
      children: [
        { kind: 'directory', name: 'SUB', children: [] },
        { kind: 'file', name: 'IN.TXT', content: new Uint8Array(3).fill(4) },
      ],
    },
  ],
};

function pair(spec: DamageSpec): { clean: LayoutResult; damaged: LayoutResult; diff: number[] } {
  const clean = layoutImage(tree, g);
  const damaged = layoutImage(tree, g);
  applyDamage(damaged, [spec]);
  const diff: number[] = [];
  for (let i = 0; i < clean.image.length; i++) {
    if (clean.image[i] !== damaged.image[i]) diff.push(i);
  }
  return { clean, damaged, diff };
}

function fatEntry(img: Uint8Array, base: number, n: number): number {
  const o = base + Math.floor((n * 3) / 2);
  const w = (img[o] as number) | ((img[o + 1] as number) << 8);
  return n % 2 === 0 ? w & 0xfff : w >> 4;
}

function fatCopiesIdentical(r: LayoutResult): boolean {
  const { fatStart, fatBytes, fatCount } = r.offsets;
  const first = r.image.subarray(fatStart, fatStart + fatBytes);
  for (let c = 1; c < fatCount; c++) {
    const other = r.image.subarray(fatStart + c * fatBytes, fatStart + (c + 1) * fatBytes);
    if (!first.every((v, i) => v === other[i])) return false;
  }
  return true;
}

const inFat = (r: LayoutResult, o: number, copy: number): boolean =>
  o >= r.offsets.fatStart + copy * r.offsets.fatBytes &&
  o < r.offsets.fatStart + (copy + 1) * r.offsets.fatBytes;

describe('applyDamage', () => {
  it('cyclic-chain links the last cluster to the first, in both FAT copies', () => {
    const { damaged, diff } = pair({ type: 'cyclic-chain', path: '/BIG.BIN' });
    const info = damaged.nodes.get('/BIG.BIN')!;
    expect(info.clusters.length).toBe(3);
    const f = damaged.offsets.fatStart;
    const last = info.clusters[2]!;
    expect(fatEntry(damaged.image, f, last)).toBe(info.clusters[0]);
    expect(fatEntry(damaged.image, f + damaged.offsets.fatBytes, last)).toBe(info.clusters[0]);
    expect(diff.length).toBeGreaterThan(0);
    expect(diff.every((o) => inFat(damaged, o, 0) || inFat(damaged, o, 1))).toBe(true);
    expect(fatCopiesIdentical(damaged)).toBe(true);
  });

  it('cyclic-chain on a one-cluster file points it at itself', () => {
    const { damaged } = pair({ type: 'cyclic-chain', path: '/ONE.TXT' });
    const c = damaged.nodes.get('/ONE.TXT')!.clusters[0]!;
    expect(fatEntry(damaged.image, damaged.offsets.fatStart, c)).toBe(c);
    expect(fatCopiesIdentical(damaged)).toBe(true);
  });

  it('cluster-out-of-range sets the first link to dataClusters + 2', () => {
    const { damaged, diff } = pair({ type: 'cluster-out-of-range', path: '/BIG.BIN' });
    const c = damaged.nodes.get('/BIG.BIN')!.clusters[0]!;
    const want = damaged.offsets.dataClusters + 2;
    expect(want).toBeLessThanOrEqual(0xfef);
    expect(fatEntry(damaged.image, damaged.offsets.fatStart, c)).toBe(want);
    expect(diff.every((o) => inFat(damaged, o, 0) || inFat(damaged, o, 1))).toBe(true);
    expect(fatCopiesIdentical(damaged)).toBe(true);
  });

  it('cluster-out-of-range throws when the disk is too large', () => {
    const big = { ...g, totalSectors: 8000, sectorsPerFat: 12, sectorsPerCluster: 1 };
    const r = layoutImage({ children: [{ kind: 'file', name: 'A', content: new Uint8Array(1) }] }, big);
    expect(() => applyDamage(r, [{ type: 'cluster-out-of-range', path: '/A' }])).toThrow(Error);
  });

  it('self-referencing-directory rewrites only the subdirectory start cluster', () => {
    const { clean, damaged, diff } = pair({ type: 'self-referencing-directory', path: '/DIR' });
    const sub = clean.nodes.get('/DIR/SUB')!;
    const dirStart = clean.nodes.get('/DIR')!.startCluster;
    expect(diff.length).toBeGreaterThan(0);
    expect(diff.every((o) => o >= sub.entryOffset + 26 && o < sub.entryOffset + 28)).toBe(true);
    const o = sub.entryOffset + 26;
    expect((damaged.image[o] as number) | ((damaged.image[o + 1] as number) << 8)).toBe(dirStart);
  });

  it.each([
    ['bytesPerSector', [0x0b, 0x0c]],
    ['sectorsPerCluster', [0x0d]],
    ['fatCount', [0x10]],
    ['rootEntryCount', [0x11, 0x12]],
    ['sectorsPerFat', [0x16, 0x17]],
    ['totalSectors', [0x13, 0x14]],
  ] as const)('invalid-bpb %s changes only its own bytes', (field, allowed) => {
    const { diff } = pair({ type: 'invalid-bpb', field });
    expect(diff.length).toBeGreaterThan(0);
    expect(diff.every((o) => (allowed as readonly number[]).includes(o))).toBe(true);
  });

  it('size-exceeds-chain changes only the size field', () => {
    const { clean, damaged, diff } = pair({ type: 'size-exceeds-chain', path: '/BIG.BIN', extraBytes: 512 });
    const e = clean.nodes.get('/BIG.BIN')!.entryOffset + 28;
    expect(diff.every((o) => o >= e && o < e + 4)).toBe(true);
    const size = [0, 1, 2, 3].reduce((s, i) => s + (damaged.image[e + i] as number) * 2 ** (8 * i), 0);
    expect(size).toBe(1536 + 512);
  });

  it('size-exceeds-chain caps at 0xFFFFFFFF', () => {
    const { damaged, clean } = pair({ type: 'size-exceeds-chain', path: '/ONE.TXT', extraBytes: 2 ** 32 });
    const e = clean.nodes.get('/ONE.TXT')!.entryOffset + 28;
    expect([...damaged.image.subarray(e, e + 4)]).toEqual([255, 255, 255, 255]);
  });

  it('lfn corrupt-checksum flips only the checksum bytes', () => {
    const { clean, diff } = pair({ type: 'lfn', path: '/LONGNA~1.TXT', mode: 'corrupt-checksum' });
    const offs = clean.nodes.get('/LONGNA~1.TXT')!.lfnOffsets;
    expect(offs.length).toBe(2);
    expect(diff).toEqual(offs.map((o) => o + 13));
  });

  it('lfn swap-order swaps the first two records', () => {
    const { clean, damaged, diff } = pair({ type: 'lfn', path: '/LONGNA~1.TXT', mode: 'swap-order' });
    const [a, b] = clean.nodes.get('/LONGNA~1.TXT')!.lfnOffsets as [number, number];
    expect(diff.every((o) => (o >= a && o < a + 32) || (o >= b && o < b + 32))).toBe(true);
    expect(damaged.image.slice(a, a + 32)).toEqual(clean.image.slice(b, b + 32));
    expect(damaged.image.slice(b, b + 32)).toEqual(clean.image.slice(a, a + 32));
  });

  it('lfn drop-last clears the 0x40 flag of the first record only', () => {
    const { clean, damaged, diff } = pair({ type: 'lfn', path: '/LONGNA~1.TXT', mode: 'drop-last' });
    const a = clean.nodes.get('/LONGNA~1.TXT')!.lfnOffsets[0]!;
    expect(diff).toEqual([a]);
    expect(damaged.image[a]).toBe((clean.image[a] as number) & ~0x40);
  });

  it('applies several specs in order', () => {
    const r = layoutImage(tree, g);
    applyDamage(r, [
      { type: 'cyclic-chain', path: '/BIG.BIN' },
      { type: 'size-exceeds-chain', path: '/ONE.TXT', extraBytes: 1 },
    ]);
    expect(fatCopiesIdentical(r)).toBe(true);
  });

  it('throws a plain Error naming a missing or wrong-kind path', () => {
    const r = layoutImage(tree, g);
    expect(() => applyDamage(r, [{ type: 'cyclic-chain', path: '/NOPE' }])).toThrow('/NOPE');
    expect(() => applyDamage(r, [{ type: 'cyclic-chain', path: '/DIR' }])).toThrow('/DIR');
    expect(() => applyDamage(r, [{ type: 'self-referencing-directory', path: '/BIG.BIN' }])).toThrow('/BIG.BIN');
    expect(() => applyDamage(r, [{ type: 'lfn', path: '/ONE.TXT', mode: 'drop-last' }])).toThrow('/ONE.TXT');
  });
});
