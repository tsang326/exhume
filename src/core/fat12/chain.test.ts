import { describe, expect, it } from 'vitest';
import { writeFatEntry } from '../../test-support/fat12/encode';
import { makeByteView } from './bytes';
import { makeScanContext, walkChain } from './chain';
import { deriveLayout, type Geometry, type Layout } from './geometry';
import { WarningCode } from './types';
import { makeWarningSink } from './warnings';

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

/** Build a context over a fresh image; `links` maps cluster -> FAT value. */
function setup(links: Record<number, number>, opts: { cut?: number; layout?: Layout } = {}) {
  const image = new Uint8Array(IMAGE_BYTES);
  const fat = image.subarray(layout.fatStart, layout.fatStart + layout.fatBytes);
  for (const [c, v] of Object.entries(links)) writeFatEntry(fat, Number(c), v);
  const view = makeByteView(opts.cut === undefined ? image : image.subarray(0, opts.cut));
  const sink = makeWarningSink();
  const ctx = makeScanContext(view, opts.layout ?? layout, sink);
  return { ctx, sink };
}

describe('walkChain', () => {
  it('follows a chain to an end marker without warnings', () => {
    const { ctx, sink } = setup({ 2: 3, 3: 4, 4: 0xfff });
    expect(walkChain(ctx, 2, Infinity, 'A')).toEqual({ clusters: [2, 3, 4], end: 'end' });
    expect(sink.list()).toEqual([]);
  });

  it('accepts any end-of-chain value 0xFF8..0xFFF', () => {
    const { ctx, sink } = setup({ 2: 0xff8 });
    expect(walkChain(ctx, 2, Infinity, 'A')).toEqual({ clusters: [2], end: 'end' });
    expect(sink.list()).toEqual([]);
  });

  it("returns 'enough' without warning when the chain is longer than needed", () => {
    const { ctx, sink } = setup({ 2: 3, 3: 4, 4: 5, 5: 0xfff });
    expect(walkChain(ctx, 2, 2, 'A')).toEqual({ clusters: [2, 3], end: 'enough' });
    expect(sink.list()).toEqual([]);
  });

  it('handles Infinity wantClusters on a long chain', () => {
    const links: Record<number, number> = {};
    for (let c = 2; c < 500; c++) links[c] = c + 1;
    links[500] = 0xfff;
    const { ctx, sink } = setup(links);
    const r = walkChain(ctx, 2, Infinity, 'A');
    expect(r.end).toBe('end');
    expect(r.clusters).toHaveLength(499);
    expect(sink.list()).toEqual([]);
  });

  it('detects a cycle and keeps clusters before the repeat', () => {
    const { ctx, sink } = setup({ 2: 3, 3: 4, 4: 3 });
    expect(walkChain(ctx, 2, Infinity, 'cyc')).toEqual({ clusters: [2, 3, 4], end: 'cycle' });
    expect(sink.list()).toHaveLength(1);
    expect(sink.list()[0]).toMatchObject({ code: WarningCode.ChainCycle, path: 'cyc' });
  });

  it('detects a self-referencing cluster', () => {
    const { ctx, sink } = setup({ 2: 2 });
    expect(walkChain(ctx, 2, Infinity, 'A')).toEqual({ clusters: [2], end: 'cycle' });
    expect(sink.list()[0].code).toBe(WarningCode.ChainCycle);
  });

  it('classifies link value 1 as reserved, not out of range (values below 2 are never followed)', () => {
    const { ctx, sink } = setup({ 2: 1 });
    expect(walkChain(ctx, 2, Infinity, 'A')).toEqual({ clusters: [2], end: 'bad' });
    expect(sink.list()[0].code).toBe(WarningCode.ChainBadCluster);
  });

  it('flags a link above maxCluster as cluster-out-of-range', () => {
    const { ctx, sink } = setup({ 2: layout.maxCluster + 1 });
    expect(walkChain(ctx, 2, Infinity, 'A')).toEqual({ clusters: [2], end: 'range' });
    expect(sink.list()[0].code).toBe(WarningCode.ClusterOutOfRange);
  });

  it('accepts a link exactly at maxCluster', () => {
    const { ctx, sink } = setup({ 2: layout.maxCluster, [layout.maxCluster]: 0xfff });
    expect(walkChain(ctx, 2, Infinity, 'A').end).toBe('end');
    expect(sink.list()).toEqual([]);
  });

  it('flags an out-of-range start cluster without collecting anything', () => {
    for (const start of [0, 1, layout.maxCluster + 1, -5, 2.5, NaN]) {
      const { ctx, sink } = setup({});
      expect(walkChain(ctx, start, Infinity, 'A')).toEqual({ clusters: [], end: 'range' });
      expect(sink.list()).toHaveLength(1);
      expect(sink.list()[0].code).toBe(WarningCode.ClusterOutOfRange);
    }
  });

  it.each([0xff7, 0xff0, 0x001])('flags link value 0x%s as chain-bad-cluster', (value) => {
    const { ctx, sink } = setup({ 2: 3, 3: value });
    expect(walkChain(ctx, 2, Infinity, 'A')).toEqual({ clusters: [2, 3], end: 'bad' });
    expect(sink.list()).toHaveLength(1);
    expect(sink.list()[0].code).toBe(WarningCode.ChainBadCluster);
  });

  it('flags a free value mid-chain as chain-truncated', () => {
    const { ctx, sink } = setup({ 2: 3, 3: 0 });
    expect(walkChain(ctx, 2, Infinity, 'A')).toEqual({ clusters: [2, 3], end: 'truncated' });
    expect(sink.list()).toHaveLength(1);
    expect(sink.list()[0].code).toBe(WarningCode.ChainTruncated);
  });

  it('reports out-of-bounds-read when the FAT entry lies beyond a tiny fatBytes', () => {
    const tiny: Layout = { ...layout, fatBytes: 6 };
    const { ctx, sink } = setup({ 2: 3, 3: 4 }, { layout: tiny });
    // Cluster 3 sits at byte 4..5 (readable); cluster 4 at 6..7 is outside.
    expect(walkChain(ctx, 2, Infinity, 'A')).toEqual({ clusters: [2, 3, 4], end: 'oob' });
    expect(sink.list()).toHaveLength(1);
    expect(sink.list()[0].code).toBe(WarningCode.OutOfBoundsRead);
  });

  it('reports out-of-bounds-read when the image is cut inside the FAT', () => {
    const { ctx, sink } = setup({ 2: 3, 3: 4, 4: 0xfff }, { cut: layout.fatStart + 6 });
    const r = walkChain(ctx, 2, Infinity, 'A');
    expect(r.end).toBe('oob');
    expect(r.clusters).toEqual([2, 3, 4]);
    expect(sink.list()).toHaveLength(1);
    expect(sink.list()[0].code).toBe(WarningCode.OutOfBoundsRead);
  });

  it('records exactly one warning per walk with the given path', () => {
    const { ctx, sink } = setup({ 2: 3, 3: 0 });
    walkChain(ctx, 2, Infinity, '/DIR/FILE.TXT');
    const list = sink.list();
    expect(list).toHaveLength(1);
    expect(list[0].path).toBe('/DIR/FILE.TXT');
  });

  it('gives two walks in sequence one warning each', () => {
    const { ctx, sink } = setup({ 2: 3, 3: 0, 10: 1 });
    walkChain(ctx, 2, Infinity, 'one');
    walkChain(ctx, 10, Infinity, 'two');
    const list = sink.list();
    expect(list.map((w) => [w.code, w.path])).toEqual([
      [WarningCode.ChainTruncated, 'one'],
      [WarningCode.ChainBadCluster, 'two'],
    ]);
  });

  it('does not treat clusters from an earlier walk as visited', () => {
    const { ctx, sink } = setup({ 2: 3, 3: 0xfff });
    expect(walkChain(ctx, 2, Infinity, 'A').end).toBe('end');
    expect(walkChain(ctx, 2, Infinity, 'B')).toEqual({ clusters: [2, 3], end: 'end' });
    expect(sink.list()).toEqual([]);
  });

  it('still detects cycles after many walks reuse the stamp array', () => {
    const { ctx, sink } = setup({ 2: 3, 3: 2, 5: 6, 6: 0xfff });
    for (let i = 0; i < 3000; i++) {
      expect(walkChain(ctx, 5, Infinity, 'ok').end).toBe('end');
      expect(walkChain(ctx, 2, Infinity, 'cyc')).toEqual({ clusters: [2, 3], end: 'cycle' });
    }
    expect(sink.list()).toHaveLength(3000);
  });

  it('survives walk id wrap-around and still detects cycles', () => {
    const { ctx } = setup({ 2: 3, 3: 2, 5: 6, 6: 0xfff });
    ctx.nextWalkId = 0xfffffffd;
    for (let i = 0; i < 6; i++) {
      expect(walkChain(ctx, 5, Infinity, 'ok').end).toBe('end');
      expect(walkChain(ctx, 2, Infinity, 'cyc').end).toBe('cycle');
    }
  });

  it('caps runaway walks at dataClusters steps and reports a cycle', () => {
    // Tiny layout: a long non-repeating chain longer than dataClusters is impossible,
    // so shrink dataClusters to force the cap on a chain that never ends.
    const capped: Layout = { ...layout, dataClusters: 3 };
    const { ctx, sink } = setup({ 2: 3, 3: 4, 4: 5, 5: 6 }, { layout: capped });
    const r = walkChain(ctx, 2, Infinity, 'A');
    expect(r).toEqual({ clusters: [2, 3, 4], end: 'cycle' });
    expect(sink.list()).toHaveLength(1);
    expect(sink.list()[0].code).toBe(WarningCode.ChainCycle);
  });
});
