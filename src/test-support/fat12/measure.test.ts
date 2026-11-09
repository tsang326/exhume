import { describe, expect, it } from 'vitest';
import { capacityOf, fitTree, measureTree, pickGeometry, standardGeometry } from './measure';
import { FitError } from './errors';
import { layoutImage } from './layout';
import type { FileTree } from './types';

const file = (name: string, size: number) => ({
  kind: 'file' as const,
  name,
  content: new Uint8Array(size).fill(7),
});

describe('capacityOf', () => {
  it.each([
    ['160K', 313, 512],
    ['180K', 351, 512],
    ['320K', 315 - 0, 1024],
    ['360K', 354, 1024],
    ['720K', 713, 1024],
    ['1200K', 2371, 512],
    ['1440K', 2847, 512],
    ['2880K', 2863, 1024],
  ] as const)('%s', (name, clusters, bytes) => {
    const c = capacityOf(standardGeometry(name));
    expect(c.dataClusters).toBe(clusters);
    expect(c.clusterBytes).toBe(bytes);
    expect(c.dataBytes).toBe(clusters * bytes);
  });
});

describe('measureTree', () => {
  it('counts entries, clusters, files and depth', () => {
    const tree: FileTree = {
      volumeLabel: 'DISK',
      children: [
        file('A.TXT', 513),
        { ...file('B.TXT', 0), longName: 'A long file name.txt' },
        { kind: 'directory', name: 'SUB', children: [file('C.TXT', 10)] },
      ],
    };
    const m = measureTree(tree, standardGeometry('1440K'));
    expect(m.rootEntries).toBe(1 + 1 + (1 + 2) + 1);
    expect(m.clusters).toBe(2 + 0 + 1 + 1);
    expect(m.fileCount).toBe(3);
    expect(m.maxDepth).toBe(1);
    expect(m.nameProblems).toEqual([]);
  });

  it('keeps deleted nodes reserved but not in the live file count, and reports bad names', () => {
    const tree: FileTree = {
      children: [{ ...file('GONE.TXT', 600), deleted: true }, file('bad name', 1), file('X', 1), file('X', 1)],
    };
    const m = measureTree(tree, standardGeometry('1440K'));
    expect(m.clusters).toBe(2 + 1 + 1 + 1);
    expect(m.fileCount).toBe(3);
    expect(m.nameProblems).toHaveLength(2);
  });
});

describe('pickGeometry / fitTree', () => {
  it('picks 160K for a tiny tree', () => {
    expect(pickGeometry({ children: [file('A.TXT', 10)] })).toBe('160K');
  });

  it('returns undefined when nothing fits', () => {
    expect(pickGeometry({ children: [file('A.BIN', 3_000_000)] })).toBeUndefined();
  });

  it('shrinks an oversized tree until it fits 2880K', () => {
    const big: FileTree = {
      children: Array.from({ length: 64 }, (_, i) => file(`F${i}.BIN`, 65536)),
    };
    expect(pickGeometry(big)).toBeUndefined();
    const fitted = fitTree(big);
    expect(pickGeometry(fitted)).toBe('2880K');
    expect(fitted.children).toHaveLength(64);
    expect(fitTree(big)).toEqual(fitted);
  });

  it('leaves a fitting tree unchanged', () => {
    const t: FileTree = { children: [file('A.TXT', 10)] };
    expect(fitTree(t)).toBe(t);
  });

  it('counts slots as root entries and throws FitError(root-entry-count) when they overflow the root', () => {
    const children = Array.from({ length: 200 }, (_, i) => file(`F${i}.TXT`, 0));
    const slots = Array.from({ length: 25 }, () => ({ beforeChild: 0, fill: 'zero' as const }));
    const tree: FileTree = { children, slots };
    expect(measureTree(tree, standardGeometry('1440K')).rootEntries).toBe(225);
    expect(() => layoutImage(tree, standardGeometry('1440K'))).toThrow(
      expect.objectContaining({ limit: 'root-entry-count', limitValue: 224, requestedValue: 225 }),
    );
    expect(() => layoutImage(tree, standardGeometry('1440K'))).toThrow(FitError);
  });
});
