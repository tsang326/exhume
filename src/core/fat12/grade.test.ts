import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { numRuns } from '../../test-support/runs';
import { writeFatEntry } from '../../test-support/fat12/encode';
import {
  writeFat12ImageWithLayout,
  type FileNode,
  type DirNode,
  type TreeNode,
} from '../../test-support/fat12';
import { MAX_REASON_CHARS } from './limits';
import { openDisk } from './index';
import type { Grave } from './types';

// 1440K: 512-byte clusters, 2847 data clusters, maxCluster 2848.
const CB = 512;
const MAX_CLUSTER = 2848;

/** Deterministic, non-uniform bytes so a wrong slice is detected. */
function bytes(n: number, seed: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (i * 31 + seed * 7 + 1) & 0xff;
  return out;
}

function file(name: string, content: Uint8Array, extra: Partial<FileNode> = {}): FileNode {
  return { kind: 'file', name, content, ...extra };
}

function build(children: TreeNode[]) {
  const layout = writeFat12ImageWithLayout({ children }, '1440K');
  const handle = openDisk(layout.image);
  return { layout, handle, image: layout.image };
}

/** Deleted entries show their first character as '_'. */
function find(files: Grave[], nodePath: string): Grave {
  const i = nodePath.lastIndexOf('/') + 1;
  const wanted = nodePath.slice(0, i) + '_' + nodePath.slice(i + 1);
  const g = files.find((f) => f.path === wanted);
  if (!g) throw new Error(`no grave ${wanted}; have ${files.map((f) => f.path).join(',')}`);
  return g;
}

function patchU16(image: Uint8Array, offset: number, value: number): void {
  image[offset] = value & 0xff;
  image[offset + 1] = (value >> 8) & 0xff;
}

function patchU32(image: Uint8Array, offset: number, value: number): void {
  patchU16(image, offset, value & 0xffff);
  patchU16(image, offset + 2, (value >>> 16) & 0xffff);
}

function expectCleanReason(g: Grave): void {
  expect(g.reason).toBeDefined();
  const r = g.reason as string;
  expect(r.length).toBeGreaterThanOrEqual(1);
  expect(r.length).toBeLessThanOrEqual(MAX_REASON_CHARS);
  // Numeric templates only: no disk-derived names.
  expect(r).toMatch(/^[A-Za-z0-9 ,;.]+$/);
  expect(r).not.toMatch(/GONE|LIVE|ONE|DIR/);
}

describe('undelete grading examples (writer + reader)', () => {
  it('recovers a contiguous deleted file byte for byte', () => {
    const content = bytes(3 * CB - 100, 1);
    const { handle } = build([file('GONE.TXT', content, { deleted: true })]);
    const g = find(handle.report.files, '/GONE.TXT');
    expect(g.state).toBe('recovered');
    expectCleanReason(g);
    const r = handle.readBytes(g);
    expect(r.ok).toBe(true);
    if (r.ok) expect(Array.from(r.bytes)).toEqual(Array.from(content));
  });

  it('grades an empty deleted file recovered and says it is empty', () => {
    const { handle } = build([file('GONE.TXT', new Uint8Array(0), { deleted: true })]);
    const g = find(handle.report.files, '/GONE.TXT');
    expect(g.state).toBe('recovered');
    expect(g.reason).toContain('empty');
    expectCleanReason(g);
    const r = handle.readBytes(g);
    expect(r.ok && r.bytes.length).toBe(0);
  });

  it('grades a deleted file partial when a live file cuts its run', () => {
    const content = bytes(4 * CB, 2);
    // Allocation: PART (deleted) 2..5, LIVE 6..8. PART's declared size is then
    // patched to 6 clusters, so its run is cut by LIVE after 4 free clusters.
    const { layout, image } = build([
      file('PART.BIN', content, { deleted: true }),
      file('LIVE.BIN', bytes(3 * CB, 4)),
    ]);
    patchU32(image, (layout.nodes.get('/PART.BIN')?.entryOffset ?? 0) + 28, 6 * CB);
    const disk = openDisk(image);
    const g = find(disk.report.files, '/PART.BIN');
    expect(g.state).toBe('partial');
    expect(g.reason).toContain('4 of 6');
    expectCleanReason(g);
    const r = disk.readBytes(g);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.bytes.length).toBe(4 * CB);
      expect(r.bytes.length).toBeLessThanOrEqual(g.size);
      expect(Array.from(r.bytes)).toEqual(Array.from(content));
    }
  });

  it('grades a deleted file lost when its start cluster was reused', () => {
    const { handle } = build([
      file('LIVE.BIN', bytes(3 * CB, 5)),
      file('GONE.TXT', bytes(CB, 6), { deleted: true, placement: { startCluster: 3 } }),
    ]);
    const g = find(handle.report.files, '/GONE.TXT');
    expect(g.state).toBe('lost');
    expectCleanReason(g);
    expect(handle.readBytes(g)).toEqual({ ok: false, error: 'data is not recoverable' });
  });

  it('grades a deleted file lost for start cluster 0 or above maxCluster', () => {
    const { handle, layout, image } = build([
      file('GONE.TXT', bytes(600, 7), { deleted: true }),
      file('GONE2.TXT', bytes(600, 8), { deleted: true }),
    ]);
    patchU16(image, (layout.nodes.get('/GONE.TXT')?.entryOffset ?? 0) + 26, 0);
    patchU16(image, (layout.nodes.get('/GONE2.TXT')?.entryOffset ?? 0) + 26, MAX_CLUSTER + 1);
    void handle;
    const report = openDisk(image);
    for (const p of ['/GONE.TXT', '/GONE2.TXT']) {
      const g = find(report.report.files, p);
      expect(g.state).toBe('lost');
      expectCleanReason(g);
      expect(report.readBytes(g)).toEqual({ ok: false, error: 'data is not recoverable' });
    }
  });

  it('grades a run that passes the end of the disk partial and mentions the disk', () => {
    const content = bytes(2 * CB, 9);
    const { layout, image } = build([
      file('GONE.TXT', content, { deleted: true, placement: { startCluster: MAX_CLUSTER - 1 } }),
    ]);
    // Declare 4 clusters: only 2 exist before the end of the disk.
    patchU32(image, (layout.nodes.get('/GONE.TXT')?.entryOffset ?? 0) + 28, 4 * CB);
    const disk = openDisk(image);
    const g = find(disk.report.files, '/GONE.TXT');
    expect(g.state).toBe('partial');
    expect(g.reason).toContain('disk');
    expectCleanReason(g);
    const r = disk.readBytes(g);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.bytes.length).toBe(2 * CB);
      expect(r.bytes.length).toBeLessThanOrEqual(g.size);
      expect(Array.from(r.bytes)).toEqual(Array.from(content));
    }
  });

  it('grades a deleted directory lost and does not list its contents', () => {
    const dir: DirNode = {
      kind: 'directory',
      name: 'DIR',
      deleted: true,
      children: [file('INNER.TXT', bytes(100, 10))],
    };
    const { handle } = build([dir]);
    const g = find(handle.report.files, '/DIR');
    expect(g.kind).toBe('directory');
    expect(g.state).toBe('lost');
    expectCleanReason(g);
    expect(handle.report.files.filter((f) => f.path.startsWith(g.path + '/'))).toEqual([]);
    expect(handle.report.files.some((f) => f.path.includes('INNER'))).toBe(false);
  });

  it('keeps the earlier deleted file recovered when a later one claims its clusters', () => {
    const a = bytes(2 * CB, 11);
    const { handle } = build([
      file('FIRST.TXT', a, { deleted: true, placement: { startCluster: 10 } }),
      file('SECOND.TXT', bytes(2 * CB, 12), { deleted: true, placement: { startCluster: 10 } }),
      file('THIRD.TXT', bytes(3 * CB, 13), { deleted: true, placement: { startCluster: 9 } }),
    ]);
    const first = find(handle.report.files, '/FIRST.TXT');
    expect(first.state).toBe('recovered');
    // Later placed data overwrites the shared clusters on disk, so only the length is stable.
    const r = handle.readBytes(first);
    expect(r.ok && r.bytes.length).toBe(a.length);

    const second = find(handle.report.files, '/SECOND.TXT');
    expect(second.state).toBe('lost');
    expect(second.reason).toContain('overlap');
    expectCleanReason(second);

    // Starts on a free cluster (9) but runs into the claimed cluster 10.
    const third = find(handle.report.files, '/THIRD.TXT');
    expect(third.state).toBe('partial');
    expect(third.reason).toContain('overlap');
    expectCleanReason(third);
    const t = handle.readBytes(third);
    expect(t.ok && t.bytes.length).toBe(CB);
  });
});

// ---------------------------------------------------------------------------
// Property 14: reference model
// ---------------------------------------------------------------------------

// 160K: 1 sector per cluster, 64 root entries, 313 data clusters, maxCluster 314.
const P_CB = 512;
const P_MAX = 314;

interface DeletedSpec {
  start: number;
  size: number;
  isDir: boolean;
}

interface ModelResult {
  state: 'recovered' | 'partial' | 'lost';
  /** Keyword the reason must contain. */
  keyword: string;
  /** Bytes readable (recovered/partial) */
  length: number;
}

/** Independent reference model written from Requirement 8; does not reuse grade.ts. */
function model(allocated: Set<number>, specs: DeletedSpec[]): ModelResult[] {
  const claimed = new Set<number>();
  const out: ModelResult[] = [];
  for (const s of specs) {
    if (s.isDir) {
      out.push({ state: 'lost', keyword: 'not listed', length: 0 });
      continue;
    }
    if (s.size === 0) {
      out.push({ state: 'recovered', keyword: 'empty', length: 0 });
      continue;
    }
    if (s.start < 2 || s.start > P_MAX) {
      out.push({ state: 'lost', keyword: 'invalid', length: 0 });
      continue;
    }
    const needed = Math.ceil(s.size / P_CB);
    const limit = Math.min(needed, P_MAX - s.start + 1);
    let k = 0;
    let blockedBy: 'allocated' | 'claimed' | undefined;
    while (k < limit) {
      const c = s.start + k;
      if (allocated.has(c)) {
        blockedBy = 'allocated';
        break;
      }
      if (claimed.has(c)) {
        blockedBy = 'claimed';
        break;
      }
      k++;
    }
    if (k === 0) {
      out.push({
        state: 'lost',
        keyword: blockedBy === 'allocated' ? 'reused' : 'overlap',
        length: 0,
      });
      continue;
    }
    for (let i = 0; i < k; i++) claimed.add(s.start + i);
    const length = Math.min(s.size, k * P_CB);
    if (blockedBy !== undefined) {
      out.push({ state: 'partial', keyword: blockedBy === 'allocated' ? 'allocated' : 'overlap', length });
    } else if (limit < needed) {
      out.push({ state: 'partial', keyword: 'disk', length });
    } else {
      out.push({ state: 'recovered', keyword: 'contiguous', length });
    }
  }
  return out;
}

const startArb = fc.oneof(
  { weight: 2, arbitrary: fc.constantFrom(0, 1, 2, P_MAX - 1, P_MAX, P_MAX + 1, P_MAX + 5) },
  { weight: 6, arbitrary: fc.integer({ min: 2, max: 40 }) },
  { weight: 2, arbitrary: fc.integer({ min: P_MAX - 6, max: P_MAX + 2 }) },
);

const sizeArb = fc.oneof(
  { weight: 1, arbitrary: fc.constant(0) },
  { weight: 5, arbitrary: fc.integer({ min: 1, max: 6 * P_CB }) },
  { weight: 1, arbitrary: fc.integer({ min: 1, max: 20 * P_CB }) },
);

const specsArb: fc.Arbitrary<DeletedSpec[]> = fc.array(
  fc.record({
    start: startArb,
    size: sizeArb,
    isDir: fc.integer({ min: 0, max: 7 }).map((n) => n === 0),
  }),
  { minLength: 1, maxLength: 16 },
);

const allocatedArb = fc.uniqueArray(
  fc.oneof(
    { weight: 3, arbitrary: fc.integer({ min: 2, max: 45 }) },
    { weight: 1, arbitrary: fc.integer({ min: P_MAX - 8, max: P_MAX }) },
  ),
  { maxLength: 30 },
);

describe('undelete grading against a reference model', () => {
  // Feature: fat12-core, Property 14: Grading matches the reference model and is deterministic
  // **Validates: Requirements 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.11, 8.12**
  it('matches the reference model and is deterministic', () => {
    fc.assert(
      fc.property(allocatedArb, specsArb, (allocList, specs) => {
        const layout = writeFat12ImageWithLayout({ children: [] }, '160K');
        const image = layout.image;
        const { fatStart, fatBytes, fatCount, rootStart } = layout.offsets;
        const allocated = new Set(allocList);
        for (let copy = 0; copy < fatCount; copy++) {
          const fat = image.subarray(fatStart + copy * fatBytes, fatStart + (copy + 1) * fatBytes);
          for (const c of allocList) writeFatEntry(fat, c, c % 3 === 0 ? 0xff7 : 0xfff);
        }
        specs.forEach((s, i) => {
          const o = rootStart + i * 32;
          image.fill(0x20, o, o + 11);
          image[o] = 0xe5;
          image[o + 1] = 0x41 + (i % 26);
          image[o + 11] = s.isDir ? 0x10 : 0x20;
          image[o + 26] = s.start & 0xff;
          image[o + 27] = (s.start >> 8) & 0xff;
          const size = s.size;
          image[o + 28] = size & 0xff;
          image[o + 29] = (size >>> 8) & 0xff;
          image[o + 30] = (size >>> 16) & 0xff;
          image[o + 31] = (size >>> 24) & 0xff;
        });

        const expected = model(allocated, specs);
        const disk = openDisk(image);
        const again = openDisk(image);
        if (JSON.stringify(disk.report) !== JSON.stringify(again.report)) return false;

        const files = disk.report.files;
        if (files.length !== specs.length) return false;
        for (let i = 0; i < specs.length; i++) {
          const g = files[i] as Grave;
          const m = expected[i] as ModelResult;
          if (g.state !== m.state) return false;
          if (typeof g.reason !== 'string' || !g.reason.includes(m.keyword)) return false;
          const r = disk.readBytes(g);
          if (m.state === 'lost') {
            if (r.ok) return false;
          } else if (!r.ok || r.bytes.length !== m.length) {
            return false;
          }
        }
        return true;
      }),
      { numRuns: numRuns(100) },
    );
  });
});
