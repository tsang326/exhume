import { describe, expect, it } from 'vitest';
import { writeFatEntry } from '../../test-support/fat12/encode';
import { makeByteView } from './bytes';
import { makeScanContext, type ChainResult } from './chain';
import { deriveLayout, type Geometry } from './geometry';
import { gradeDeleted, gradeLive } from './grade';
import { MAX_REASON_CHARS } from './limits';
import { makeWarningSink } from './warnings';

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
const CB = layout.clusterBytes; // 512

function setup(links: Record<number, number> = {}, cut?: number) {
  const image = new Uint8Array(FLOPPY.totalSectors * FLOPPY.bytesPerSector);
  const fat = image.subarray(layout.fatStart, layout.fatStart + layout.fatBytes);
  for (const [c, v] of Object.entries(links)) writeFatEntry(fat, Number(c), v);
  const view = makeByteView(cut === undefined ? image : image.subarray(0, cut));
  const ctx = makeScanContext(view, layout, makeWarningSink());
  return { ctx, claimed: new Uint8Array(layout.maxCluster + 1) };
}

const file = (size: number, startCluster: number) => ({ size, startCluster, isDirectory: false });

describe('gradeDeleted', () => {
  it('deleted directory is lost with contents not listed', () => {
    const { ctx, claimed } = setup();
    const g = gradeDeleted(ctx, claimed, { size: 0, startCluster: 5, isDirectory: true }, 'D');
    expect(g.state).toBe('lost');
    expect(g.reason).toContain('contents are not listed');
    expect(g.run).toEqual([]);
  });

  it('size 0 is recovered and empty, ignoring an invalid start cluster', () => {
    const { ctx, claimed } = setup();
    const g = gradeDeleted(ctx, claimed, file(0, 0xffff), 'E');
    expect(g).toEqual({ state: 'recovered', reason: 'file is empty', run: [] });
  });

  it.each([0, 1, layout.maxCluster + 1, 0xffff])('start cluster %i is invalid -> lost', (start) => {
    const { ctx, claimed } = setup();
    const g = gradeDeleted(ctx, claimed, file(10, start), 'F');
    expect(g.state).toBe('lost');
    expect(g.reason).toContain('invalid');
  });

  it('allocated start cluster is lost (reused)', () => {
    const { ctx, claimed } = setup({ 5: 0xfff });
    const g = gradeDeleted(ctx, claimed, file(10, 5), 'F');
    expect(g.state).toBe('lost');
    expect(g.reason).toContain('reused');
  });

  it('unreadable FAT entry at start is lost', () => {
    const { ctx, claimed } = setup({}, layout.fatStart + 4);
    const g = gradeDeleted(ctx, claimed, file(10, 100), 'F');
    expect(g.state).toBe('lost');
    expect(g.reason).toContain('unreadable');
  });

  it('free contiguous run is recovered and marked in claimed', () => {
    const { ctx, claimed } = setup();
    const g = gradeDeleted(ctx, claimed, file(CB * 2 + 1, 10), 'F');
    expect(g.state).toBe('recovered');
    expect(g.run).toEqual([10, 11, 12]);
    expect(g.reason).toContain('contiguous and unallocated');
    expect([claimed[9], claimed[10], claimed[11], claimed[12], claimed[13]]).toEqual([0, 1, 1, 1, 0]);
  });

  it('exact multiple of cluster size does not need an extra cluster', () => {
    const { ctx, claimed } = setup();
    const g = gradeDeleted(ctx, claimed, file(CB * 2, 10), 'F');
    expect(g.run).toEqual([10, 11]);
  });

  it('later allocated cluster gives partial with the free count', () => {
    const { ctx, claimed } = setup({ 12: 0xfff });
    const g = gradeDeleted(ctx, claimed, file(CB * 4, 10), 'F');
    expect(g.state).toBe('partial');
    expect(g.run).toEqual([10, 11]);
    expect(g.reason).toContain('2 of 4');
    expect(g.reason).toContain('cluster 12 is allocated');
    expect(claimed[10]).toBe(1);
    expect(claimed[12]).toBe(0);
  });

  it('run beyond the last data cluster is partial (run exceeds disk)', () => {
    const { ctx, claimed } = setup();
    const start = layout.maxCluster - 1;
    const g = gradeDeleted(ctx, claimed, file(CB * 5, start), 'F');
    expect(g.state).toBe('partial');
    expect(g.run).toEqual([start, start + 1]);
    expect(g.reason).toContain('exceeds the disk');
  });

  it('huge declared size never produces a run longer than the disk allows', () => {
    const { ctx, claimed } = setup();
    const g = gradeDeleted(ctx, claimed, file(0xffffffff, 2), 'F');
    expect(g.state).toBe('partial');
    expect(g.run).toHaveLength(layout.maxCluster - 1);
  });

  it('run ending exactly at maxCluster is recovered', () => {
    const { ctx, claimed } = setup();
    const g = gradeDeleted(ctx, claimed, file(CB * 2, layout.maxCluster - 1), 'F');
    expect(g.state).toBe('recovered');
  });

  describe('claimed overlap', () => {
    it('later entry whose start is claimed is lost; earlier keeps its grade', () => {
      const { ctx, claimed } = setup();
      const first = gradeDeleted(ctx, claimed, file(CB * 3, 20), 'A');
      const second = gradeDeleted(ctx, claimed, file(CB * 2, 21), 'B');
      expect(first.state).toBe('recovered');
      expect(second.state).toBe('lost');
      expect(second.reason).toContain('overlaps');
    });

    it('later entry that runs into a claimed cluster is partial and names the overlap', () => {
      const { ctx, claimed } = setup();
      gradeDeleted(ctx, claimed, file(CB * 2, 22), 'A');
      const second = gradeDeleted(ctx, claimed, file(CB * 4, 20), 'B');
      expect(second.state).toBe('partial');
      expect(second.run).toEqual([20, 21]);
      expect(second.reason).toContain('overlaps');
    });

    it('identical entries: second is lost', () => {
      const { ctx, claimed } = setup();
      gradeDeleted(ctx, claimed, file(CB, 30), 'A');
      expect(gradeDeleted(ctx, claimed, file(CB, 30), 'B').state).toBe('lost');
    });

    it('lost entries do not claim clusters', () => {
      const { ctx, claimed } = setup({ 40: 0xfff });
      gradeDeleted(ctx, claimed, file(CB * 3, 40), 'A');
      expect(claimed.every((b) => b === 0)).toBe(true);
    });
  });

  it('reasons are clamped to MAX_REASON_CHARS', () => {
    const { ctx, claimed } = setup();
    const g = gradeDeleted(ctx, claimed, file(10, -1e300), 'F');
    expect(g.reason.length).toBeLessThanOrEqual(MAX_REASON_CHARS);
  });
});

describe('gradeLive', () => {
  const chain = (clusters: number[], end: ChainResult['end']): ChainResult => ({ clusters, end });
  const { ctx } = setup();

  it('clean chains are undefined', () => {
    expect(gradeLive(chain([2, 3], 'end'), CB * 2, ctx)).toBeUndefined();
    expect(gradeLive(chain([2, 3], 'enough'), CB * 2, ctx)).toBeUndefined();
  });

  it('chain longer than size is normal slack', () => {
    expect(gradeLive(chain([2, 3, 4], 'end'), CB, ctx)).toBeUndefined();
  });

  it('zero-length file is never damaged', () => {
    expect(gradeLive(chain([], 'range'), 0, ctx)).toBeUndefined();
    expect(gradeLive(chain([2], 'cycle'), 0, ctx)).toBeUndefined();
  });

  it.each(['cycle', 'range', 'bad', 'truncated', 'oob'] as const)('%s with clusters read is partial', (end) => {
    const g = gradeLive(chain([2], end), CB * 3, ctx);
    expect(g?.state).toBe('partial');
    expect(g?.reason).toContain(end);
  });

  it('damaged chain with no clusters read is lost', () => {
    expect(gradeLive(chain([], 'range'), CB, ctx)?.state).toBe('lost');
  });

  it('chain-short (end with too few clusters) is partial', () => {
    const g = gradeLive(chain([2], 'end'), CB * 3, ctx);
    expect(g?.state).toBe('partial');
    expect(g?.reason).toContain('1 of 3');
  });

  it('size exceeding disk capacity is damaged (partial) even with end marker', () => {
    const g = gradeLive(chain([2, 3], 'end'), 0xffffffff, ctx);
    expect(g?.state).toBe('partial');
    expect(g?.reason).toContain('exceeds disk');
    expect(g?.reason.length).toBeLessThanOrEqual(MAX_REASON_CHARS);
  });
});
