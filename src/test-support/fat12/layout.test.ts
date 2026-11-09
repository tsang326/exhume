import { describe, expect, it } from 'vitest';
import { FitError } from './errors';
import { layoutImage } from './layout';
import { standardGeometry } from './measure';
import type { DirNode, FileNode, FileTree, NeverUsedSlot, TreeNode } from './types';

const g = standardGeometry('1440K');
// 1440K: FAT1 at 512, FAT2 at 5120, root at 9728, data at 16896, 512-byte clusters.
const FAT1 = 512;
const FAT2 = 5120;
const ROOT = 9728;
const DATA = 16896;

const file = (name: string, bytes: number[] | Uint8Array, extra: Partial<FileNode> = {}): FileNode => ({
  kind: 'file',
  name,
  content: Uint8Array.from(bytes),
  ...extra,
});
const dir = (name: string, children: TreeNode[], extra: Partial<DirNode> = {}): DirNode => ({
  kind: 'directory',
  name,
  children,
  ...extra,
});
const fill = (n: number, v: number): Uint8Array => new Uint8Array(n).fill(v);

function fatEntry(img: Uint8Array, base: number, n: number): number {
  const o = base + Math.floor((n * 3) / 2);
  const w = (img[o] as number) | ((img[o + 1] as number) << 8);
  return n % 2 === 0 ? w & 0xfff : w >> 4;
}
const u16 = (b: Uint8Array, o: number): number => (b[o] as number) | ((b[o + 1] as number) << 8);

describe('layoutImage', () => {
  it('writes the boot sector', () => {
    const { image } = layoutImage({ volumeLabel: 'MYDISK', children: [] }, g);
    expect([...image.subarray(0, 3)]).toEqual([0xeb, 0x3c, 0x90]);
    expect(String.fromCharCode(...image.subarray(3, 11))).toBe('EXHUME  ');
    expect(u16(image, 0x0b)).toBe(512);
    expect(image[0x0d]).toBe(1);
    expect(u16(image, 0x0e)).toBe(1);
    expect(image[0x10]).toBe(2);
    expect(u16(image, 0x11)).toBe(224);
    expect(u16(image, 0x13)).toBe(2880);
    expect(image[0x15]).toBe(0xf0);
    expect(u16(image, 0x16)).toBe(9);
    expect(image[0x26]).toBe(0x29);
    expect(String.fromCharCode(...image.subarray(43, 54))).toBe('MYDISK     ');
    expect(String.fromCharCode(...image.subarray(54, 62))).toBe('FAT12   ');
    expect(image[510]).toBe(0x55);
    expect(image[511]).toBe(0xaa);
    expect(image.length).toBe(2880 * 512);
  });

  it('uses NO NAME when there is no label, and writes the label root entry when present', () => {
    const none = layoutImage({ children: [] }, g);
    expect(String.fromCharCode(...none.image.subarray(43, 54))).toBe('NO NAME    ');
    const labelled = layoutImage({ volumeLabel: 'VOL', children: [file('A.TXT', [1])] }, g);
    expect(labelled.labelEntryOffset).toBe(ROOT);
    expect(labelled.image[ROOT]).toBe(0x56);
    expect(labelled.image[ROOT + 11]).toBe(0x08);
    expect(labelled.nodes.get('/A.TXT')?.entryOffset).toBe(ROOT + 32);
  });

  it('writes identical FAT copies with the media and end entries', () => {
    const { image } = layoutImage({ children: [file('A.TXT', fill(1000, 7))] }, g);
    expect(image.subarray(FAT1, FAT1 + 4608)).toEqual(image.subarray(FAT2, FAT2 + 4608));
    expect(fatEntry(image, FAT1, 0)).toBe(0xff0);
    expect(fatEntry(image, FAT1, 1)).toBe(0xfff);
    expect(fatEntry(image, FAT1, 2)).toBe(3);
    expect(fatEntry(image, FAT1, 3)).toBe(0xfff);
  });

  it('puts file bytes and entry fields where expected', () => {
    const content = fill(600, 0xab);
    const { image, nodes } = layoutImage(
      {
        children: [
          file('A.TXT', content, {
            modified: { year: 2001, month: 2, day: 3, hour: 4, minute: 5, second: 6 },
            attributes: { readOnly: true, archive: true },
          }),
          file('EMPTY.TXT', []),
        ],
      },
      g,
    );
    expect(image.subarray(DATA, DATA + 600)).toEqual(content);
    const a = nodes.get('/A.TXT');
    expect(a?.clusters).toEqual([2, 3]);
    const e = a?.entryOffset as number;
    expect(e).toBe(ROOT);
    expect(String.fromCharCode(...image.subarray(e, e + 11))).toBe('A       TXT');
    expect(image[e + 11]).toBe(0x21);
    expect(u16(image, e + 22)).toBe((4 << 11) | (5 << 5) | 3);
    expect(u16(image, e + 24)).toBe((21 << 9) | (2 << 5) | 3);
    expect(u16(image, e + 26)).toBe(2);
    expect(u16(image, e + 28)).toBe(600);
    const empty = nodes.get('/EMPTY.TXT');
    expect(empty?.startCluster).toBe(0);
    expect(u16(image, (empty?.entryOffset as number) + 26)).toBe(0);
    // Default date for the empty file: 1980-01-01 00:00:00.
    expect(u16(image, (empty?.entryOffset as number) + 24)).toBe((1 << 5) | 1);
    expect(u16(image, (empty?.entryOffset as number) + 22)).toBe(0);
  });

  it('allocates directories first in depth-first pre-order with . and .. entries', () => {
    const tree: FileTree = {
      children: [dir('SUB', [dir('IN', [file('X.BIN', [1])]), file('Y.BIN', [2])]), file('Z.BIN', [3])],
    };
    const { image, nodes, order } = layoutImage(tree, g);
    expect(order).toEqual(['/SUB', '/SUB/IN', '/SUB/IN/X.BIN', '/SUB/Y.BIN', '/Z.BIN']);
    expect(nodes.get('/SUB')?.startCluster).toBe(2);
    expect(nodes.get('/SUB/IN')?.startCluster).toBe(3);
    expect(nodes.get('/SUB/IN/X.BIN')?.startCluster).toBe(4);
    expect(nodes.get('/SUB/Y.BIN')?.startCluster).toBe(5);
    expect(nodes.get('/Z.BIN')?.startCluster).toBe(6);
    const sub = nodes.get('/SUB') as { dotOffset: number; dotDotOffset: number };
    expect(image[sub.dotOffset]).toBe(0x2e);
    expect(u16(image, sub.dotOffset + 26)).toBe(2);
    expect(image[sub.dotDotOffset + 1]).toBe(0x2e);
    expect(u16(image, sub.dotDotOffset + 26)).toBe(0);
    const inn = nodes.get('/SUB/IN') as { dotOffset: number; dotDotOffset: number };
    expect(u16(image, inn.dotOffset + 26)).toBe(3);
    expect(u16(image, inn.dotDotOffset + 26)).toBe(2);
  });

  it('writes long-name records before the 8.3 entry', () => {
    const { image, nodes } = layoutImage(
      { children: [file('SHORT.TXT', [1], { longName: 'A rather long file name.txt' })] },
      g,
    );
    const n = nodes.get('/SHORT.TXT');
    expect(n?.lfnOffsets).toEqual([ROOT, ROOT + 32, ROOT + 64]);
    expect(n?.entryOffset).toBe(ROOT + 96);
    expect(image[ROOT]).toBe(0x43);
    expect(image[ROOT + 64]).toBe(0x01);
    expect(image[ROOT + 11]).toBe(0x0f);
    const name11 = image.subarray(ROOT + 96, ROOT + 107);
    let sum = 0;
    for (const b of name11) sum = (((sum & 1) << 7) + (sum >> 1) + b) & 0xff;
    expect(image[ROOT + 13]).toBe(sum);
  });

  it('marks deleted entries 0xE5, clears their FAT entries and reserves their clusters', () => {
    const { image, nodes } = layoutImage(
      { children: [file('GONE.TXT', fill(600, 1), { deleted: true }), file('KEEP.TXT', fill(10, 2))] },
      g,
    );
    const gone = nodes.get('/GONE.TXT') as { entryOffset: number; clusters: number[] };
    expect(image[gone.entryOffset]).toBe(0xe5);
    expect(String.fromCharCode(...image.subarray(gone.entryOffset + 1, gone.entryOffset + 4))).toBe('ONE');
    expect(gone.clusters).toEqual([2, 3]);
    for (const base of [FAT1, FAT2]) {
      expect(fatEntry(image, base, 2)).toBe(0);
      expect(fatEntry(image, base, 3)).toBe(0);
      expect(fatEntry(image, base, 4)).toBe(0xfff);
    }
    expect(nodes.get('/KEEP.TXT')?.startCluster).toBe(4);
    expect(image.subarray(DATA, DATA + 600)).toEqual(fill(600, 1));
  });

  it('writes placed deleted data first so live data wins on overlap', () => {
    const { image, nodes } = layoutImage(
      {
        children: [
          file('LIVE.TXT', fill(512, 0x11)),
          file('OLD.TXT', fill(1024, 0x22), { deleted: true, placement: { startCluster: 2 } }),
        ],
      },
      g,
    );
    expect(nodes.get('/OLD.TXT')?.startCluster).toBe(2);
    expect(image.subarray(DATA, DATA + 512)).toEqual(fill(512, 0x11));
    expect(image.subarray(DATA + 512, DATA + 1024)).toEqual(fill(512, 0x22));
    // The live file still owns cluster 2; placed data did not touch the FAT.
    expect(fatEntry(image, FAT1, 2)).toBe(0xfff);
    expect(fatEntry(image, FAT1, 3)).toBe(0);
    expect(image[nodes.get('/OLD.TXT')?.entryOffset as number]).toBe(0xe5);
  });

  it('builds 17 levels of nesting', () => {
    let node: TreeNode = file('DEEP.TXT', [9]);
    for (let i = 17; i >= 1; i--) node = dir(`D${i}`, [node]);
    const { nodes, image } = layoutImage({ children: [node] }, g);
    let path = '';
    for (let i = 1; i <= 17; i++) path += `/D${i}`;
    expect(nodes.get(path)?.kind).toBe('directory');
    const deep = nodes.get(`${path}/DEEP.TXT`);
    expect(deep?.startCluster).toBe(19);
    expect(image[DATA + 17 * 512]).toBe(9);
  });

  it('is deterministic', () => {
    const tree: FileTree = {
      volumeLabel: 'X',
      children: [dir('A', [file('B.TXT', fill(700, 5), { longName: 'b long name' })]), file('C.TXT', [1])],
    };
    expect(layoutImage(tree, g).image).toEqual(layoutImage(tree, g).image);
  });

  it('throws FitError before writing for too many root entries', () => {
    const children = Array.from({ length: 225 }, (_, i) => file(`F${i}.TXT`, []));
    try {
      layoutImage({ children }, g);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(FitError);
      const f = e as FitError;
      expect(f.limit).toBe('root-entry-count');
      expect(f.limitValue).toBe(224);
      expect(f.requestedValue).toBe(225);
    }
  });

  it('throws FitError for too many clusters and for bad names', () => {
    expect(() => layoutImage({ children: [file('BIG.BIN', new Uint8Array(1_500_000))] }, g)).toThrow(
      expect.objectContaining({ limit: 'data-cluster-count' }),
    );
    expect(() => layoutImage({ children: [file('bad name', [])] }, g)).toThrow(
      expect.objectContaining({ limit: 'file-name-format' }),
    );
  });

  describe('never-used slots', () => {
    const slotBytes = (img: Uint8Array, o: number): Uint8Array => img.subarray(o, o + 32);
    const expectSlot = (img: Uint8Array, o: number, fillByte: number): void => {
      expect(img[o]).toBe(0xe5);
      expect([...slotBytes(img, o).subarray(1)]).toEqual(Array<number>(31).fill(fillByte));
    };

    it('writes f6 and zero slots at known root offsets, interleaved with entries', () => {
      const tree: FileTree = {
        children: [file('A.TXT', [1]), file('B.TXT', [2])],
        slots: [
          { beforeChild: 0, fill: 'f6' },
          { beforeChild: 1, fill: 'zero' },
          { beforeChild: 2, fill: 'f6' },
        ],
      };
      const { image, nodes } = layoutImage(tree, g);
      expectSlot(image, ROOT, 0xf6);
      expect(nodes.get('/A.TXT')?.entryOffset).toBe(ROOT + 32);
      expectSlot(image, ROOT + 64, 0x00);
      expect(nodes.get('/B.TXT')?.entryOffset).toBe(ROOT + 96);
      expectSlot(image, ROOT + 128, 0xf6);
    });

    it('writes slots inside a subdirectory after its dot entries', () => {
      const tree: FileTree = {
        children: [
          dir('SUB', [file('C.TXT', [3])], {
            slots: [
              { beforeChild: 0, fill: 'zero' },
              { beforeChild: 1, fill: 'f6' },
            ],
          }),
        ],
      };
      const { image, nodes } = layoutImage(tree, g);
      const sub = nodes.get('/SUB');
      const base = DATA + ((sub?.clusters[0] as number) - 2) * 512;
      expect(image[base]).toBe(0x2e);
      expect(image[base + 32]).toBe(0x2e);
      expectSlot(image, base + 64, 0x00);
      expect(nodes.get('/SUB/C.TXT')?.entryOffset).toBe(base + 96);
      expectSlot(image, base + 128, 0xf6);
    });

    it('gives a subdirectory an extra cluster when slots push it past one cluster', () => {
      const kids = Array.from({ length: 10 }, (_, i) => file(`F${i}.TXT`, []));
      const without = layoutImage({ children: [dir('SUB', kids)] }, g);
      expect(without.nodes.get('/SUB')?.clusters.length).toBe(1);
      const slots = Array.from({ length: 5 }, () => ({ beforeChild: 10, fill: 'f6' as const }));
      const withSlots = layoutImage({ children: [dir('SUB', kids, { slots })] }, g);
      const info = withSlots.nodes.get('/SUB');
      expect(info?.clusters.length).toBe(2);
      const base = DATA + ((info?.clusters[0] as number) - 2) * 512;
      // records: 2 dots + 10 children, then slots at record 12..16 (the last one in cluster 2)
      expectSlot(withSlots.image, base + 12 * 32, 0xf6);
      expectSlot(withSlots.image, base + 16 * 32, 0xf6);
    });

    it('throws RangeError for a bad beforeChild or a bad fill', () => {
      const c = [file('A.TXT', [1])];
      for (const beforeChild of [-1, 2, 0.5, Number.NaN]) {
        expect(() => layoutImage({ children: c, slots: [{ beforeChild, fill: 'f6' }] }, g)).toThrow(RangeError);
      }
      expect(() =>
        layoutImage({ children: [dir('D', c, { slots: [{ beforeChild: 2, fill: 'zero' }] })] }, g),
      ).toThrow(RangeError);
      const badFill = { beforeChild: 0, fill: 'ff' } as unknown as NeverUsedSlot;
      expect(() => layoutImage({ children: c, slots: [badFill] }, g)).toThrow(RangeError);
      expect(() => layoutImage({ children: [dir('D', c, { slots: [badFill] })] }, g)).toThrow(RangeError);
    });
  });
});
