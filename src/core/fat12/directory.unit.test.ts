import { describe, expect, it } from 'vitest';
import {
  buildLfnRecords,
  encodeDosDate,
  encodeDosTime,
  encodeShortName,
  lfnChecksum,
  writeFatEntry,
} from '../../test-support/fat12/encode';
import { makeByteView } from './bytes';
import { makeScanContext } from './chain';
import { walkDirectories } from './directory';
import { deriveLayout, type Geometry } from './geometry';
import { MAX_TOTAL_ENTRIES } from './limits';
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

const DIR = 0x10;
const VOL = 0x08;
const END = 0xfff;
const WHEN = { year: 2001, month: 2, day: 3, hour: 4, minute: 5, second: 6 };

function rec(
  name: string | Uint8Array,
  o: { attr?: number; start?: number; size?: number; date?: number; time?: number } = {},
): Uint8Array {
  const r = new Uint8Array(32);
  if (name === '.' || name === '..') {
    r.fill(0x20, 0, 11);
    r.set(new TextEncoder().encode(name), 0);
  } else {
    r.set(typeof name === 'string' ? encodeShortName(name) : name, 0);
  }
  r[11] = o.attr ?? 0x20;
  const time = o.time ?? encodeDosTime(WHEN);
  const date = o.date ?? encodeDosDate(WHEN);
  r[22] = time & 0xff;
  r[23] = time >> 8;
  r[24] = date & 0xff;
  r[25] = date >> 8;
  const start = o.start ?? 0;
  r[26] = start & 0xff;
  r[27] = start >> 8;
  const size = o.size ?? 0;
  r[28] = size & 0xff;
  r[29] = (size >>> 8) & 0xff;
  r[30] = (size >>> 16) & 0xff;
  r[31] = (size >>> 24) & 0xff;
  return r;
}

const dirRec = (name: string, start: number) => rec(name, { attr: DIR, start });

class Img {
  readonly image = new Uint8Array(FLOPPY.totalSectors * FLOPPY.bytesPerSector);
  private rootIndex = 0;
  private readonly subIndex = new Map<number, number>();
  constructor() {
    const b = this.image;
    b[0x0b] = 0x00;
    b[0x0c] = 0x02;
    b[0x0d] = 1;
    b[0x0e] = 1;
    b[0x10] = 2;
    b[0x11] = 224;
    b[0x13] = 0x40;
    b[0x14] = 0x0b;
    b[0x15] = 0xf0;
    b[0x16] = 9;
    b[510] = 0x55;
    b[511] = 0xaa;
  }
  fat(c: number, v: number): this {
    for (let copy = 0; copy < 2; copy++) {
      const start = layout.fatStart + copy * layout.fatBytes;
      writeFatEntry(this.image.subarray(start, start + layout.fatBytes), c, v);
    }
    return this;
  }
  chain(...clusters: number[]): this {
    clusters.forEach((c, i) => this.fat(c, i + 1 < clusters.length ? (clusters[i + 1] as number) : END));
    return this;
  }
  root(...records: Uint8Array[]): this {
    for (const r of records) this.image.set(r, layout.rootStart + this.rootIndex++ * 32);
    return this;
  }
  /** Append records to the next free slot of cluster `c` (slots continue across calls). */
  sub(c: number, ...records: Uint8Array[]): this {
    for (const r of records) {
      const i = this.subIndex.get(c) ?? 0;
      this.subIndex.set(c, i + 1);
      this.image.set(r, layout.dataStart + (c - 2) * layout.clusterBytes + i * 32);
    }
    return this;
  }
  scan() {
    const sink = makeWarningSink();
    const ctx = makeScanContext(makeByteView(this.image), layout, sink);
    const out = walkDirectories(ctx);
    return { ...out, warnings: sink.list() };
  }
}

const codes = (w: { code: string }[]) => w.map((x) => x.code);

describe('walkDirectories', () => {
  it('lists root entries with name, size, date, attributes and start cluster', () => {
    const img = new Img().root(rec('A.TXT', { attr: 0x21, start: 5, size: 100 }), rec('B', { attr: 0x06 }));
    img.chain(5);
    const { graves, records, warnings } = img.scan();
    expect(warnings).toEqual([]);
    expect(graves.map((g) => g.path)).toEqual(['/A.TXT', '/B']);
    expect(graves[0]).toEqual({
      id: 0,
      path: '/A.TXT',
      size: 100,
      date: '2001-02-03T04:05:06',
      state: 'alive',
      kind: 'file',
      attributes: { readOnly: true, hidden: false, system: false, archive: true },
      startCluster: 5,
    });
    expect(graves[1]?.attributes).toEqual({ readOnly: false, hidden: true, system: true, archive: false });
    expect(records[0]?.readPlan).toEqual({ kind: 'chain' });
    expect(records[1]?.readPlan).toEqual({ kind: 'none' });
  });

  it('descends depth-first in pre-order, building nested paths and skipping . and ..', () => {
    const img = new Img()
      .root(dirRec('DIR1', 2), rec('Z.TXT'))
      .sub(2, dirRec('.', 2), dirRec('..', 0), rec('A.TXT'), dirRec('SUB', 3))
      .sub(3, dirRec('.', 3), dirRec('..', 2), rec('B.TXT'));
    img.chain(2).chain(3);
    const { graves, warnings } = img.scan();
    expect(warnings).toEqual([]);
    expect(graves.map((g) => g.path)).toEqual(['/DIR1', '/DIR1/A.TXT', '/DIR1/SUB', '/DIR1/SUB/B.TXT', '/Z.TXT']);
    expect(graves.map((g) => g.kind)).toEqual(['directory', 'file', 'directory', 'file', 'file']);
    expect(graves.map((g) => g.id)).toEqual([0, 1, 2, 3, 4]);
  });

  it('stops a directory at a 0x00 entry', () => {
    const img = new Img().root(rec('A.TXT'));
    img.root(new Uint8Array(32), rec('HIDDEN.TXT'));
    expect(img.scan().graves.map((g) => g.path)).toEqual(['/A.TXT']);
  });

  it('omits the volume label', () => {
    const img = new Img().root(rec('MYDISK', { attr: VOL }), rec('A.TXT'));
    expect(img.scan().graves.map((g) => g.path)).toEqual(['/A.TXT']);
  });

  it('uses a valid long name', () => {
    const short = encodeShortName('LONGNA~1.TXT');
    const img = new Img().root(...buildLfnRecords('A long name.txt', lfnChecksum(short)), rec(short));
    const { graves, warnings } = img.scan();
    expect(graves.map((g) => g.path)).toEqual(['/A long name.txt']);
    expect(warnings).toEqual([]);
  });

  it('falls back to the 8.3 name with one lfn-invalid warning on a bad checksum', () => {
    const short = encodeShortName('LONGNA~1.TXT');
    const img = new Img().root(...buildLfnRecords('A long name.txt', lfnChecksum(short) ^ 0xff), rec(short));
    const { graves, warnings } = img.scan();
    expect(graves.map((g) => g.path)).toEqual(['/LONGNA~1.TXT']);
    expect(warnings).toEqual([expect.objectContaining({ code: 'lfn-invalid', path: '/LONGNA~1.TXT' })]);
  });

  it('warns once with the directory path for an orphan long name', () => {
    const img = new Img().root(...buildLfnRecords('orphan', 0), rec('MYDISK', { attr: VOL }), rec('A.TXT'));
    const { graves, warnings } = img.scan();
    expect(graves.map((g) => g.path)).toEqual(['/A.TXT']);
    expect(warnings).toEqual([expect.objectContaining({ code: 'lfn-invalid', path: '/' })]);
  });

  it('names and grades deleted entries', () => {
    const del = (name: string, o: Parameters<typeof rec>[1]) => {
      const r = rec(name, o);
      r[0] = 0xe5;
      return r;
    };
    const img = new Img().root(
      del('XELETED.TXT', { start: 10, size: 600 }), // clusters 10 and 11 are free
      del('XUSED.TXT', { start: 5, size: 10 }), // start cluster allocated
      del('XDIR', { attr: DIR, start: 20 }),
      del('XEMPTY.TXT', { start: 0, size: 0 }),
    );
    img.chain(5);
    const { graves, records, warnings } = img.scan();
    expect(warnings).toEqual([]);
    expect(graves.map((g) => [g.path, g.state, g.kind])).toEqual([
      ['/_ELETED.TXT', 'recovered', 'file'],
      ['/_USED.TXT', 'lost', 'file'],
      ['/_DIR', 'lost', 'directory'],
      ['/_EMPTY.TXT', 'recovered', 'file'],
    ]);
    expect(graves.every((g) => typeof g.reason === 'string' && g.reason.length > 0)).toBe(true);
    expect(records.map((r) => r.deleted)).toEqual([true, true, true, true]);
    expect(records[0]?.readPlan).toEqual({ kind: 'run', clusters: [10, 11] });
    expect(records[1]?.readPlan).toEqual({ kind: 'none' });
  });

  it('reports a second deleted file overlapping an earlier one as lost', () => {
    const del = (name: string, start: number) => {
      const r = rec(name, { start, size: 512 });
      r[0] = 0xe5;
      return r;
    };
    const { graves } = new Img().root(del('XA.TXT', 10), del('XB.TXT', 10)).scan();
    expect(graves.map((g) => g.state)).toEqual(['recovered', 'lost']);
  });

  it('reports a directory loop and does not read it again', () => {
    const img = new Img().root(dirRec('DIR1', 2)).sub(2, dirRec('SELF', 2), rec('A.TXT'));
    img.chain(2);
    const { graves, warnings } = img.scan();
    expect(graves.map((g) => [g.path, g.state])).toEqual([
      ['/DIR1', 'alive'],
      ['/DIR1/SELF', 'partial'],
      ['/DIR1/A.TXT', 'alive'],
    ]);
    expect(warnings).toEqual([expect.objectContaining({ code: 'directory-loop', path: '/DIR1/SELF' })]);
  });

  it('reports a duplicate directory that is not on the path', () => {
    const img = new Img().root(dirRec('ONE', 2), dirRec('TWO', 2)).sub(2, rec('A.TXT'));
    img.chain(2);
    const { graves, warnings } = img.scan();
    expect(graves.map((g) => [g.path, g.state])).toEqual([
      ['/ONE', 'alive'],
      ['/ONE/A.TXT', 'alive'],
      ['/TWO', 'partial'],
    ]);
    expect(warnings).toEqual([expect.objectContaining({ code: 'directory-duplicate', path: '/TWO' })]);
  });

  it('reports an invalid directory start cluster as lost', () => {
    const { graves, warnings } = new Img().root(dirRec('BAD', 0), dirRec('BAD2', 9999)).scan();
    expect(graves.map((g) => g.state)).toEqual(['lost', 'lost']);
    expect(codes(warnings)).toEqual(['cluster-out-of-range', 'cluster-out-of-range']);
    expect(warnings[0]?.path).toBe('/BAD');
  });

  it('lists but does not read a directory whose own path has 16 components', () => {
    // /D1/D2/.../D16: D(k) lives in cluster k + 1 and holds D(k+1).
    const img = new Img().root(dirRec('D1', 2));
    for (let k = 1; k <= 16; k++) {
      img.chain(k + 1);
      if (k < 16) img.sub(k + 1, dirRec(`D${k + 1}`, k + 2));
    }
    img.sub(17, rec('DEEP.TXT'));
    const { graves, warnings } = img.scan();
    expect(graves).toHaveLength(16);
    expect(graves[15]?.path.split('/')).toHaveLength(17);
    expect(graves[15]?.state).toBe('partial');
    expect(warnings).toEqual([expect.objectContaining({ code: 'depth-exceeded' })]);
  });

  it('marks a live file with a short chain as partial with chain-short', () => {
    const img = new Img().root(rec('A.TXT', { start: 5, size: 1500 }));
    img.chain(5, 6);
    const { graves, warnings } = img.scan();
    expect(graves[0]?.state).toBe('partial');
    expect(codes(warnings)).toEqual(['chain-short']);
  });

  it('emits size-exceeds-disk and suppresses chain-short', () => {
    const img = new Img().root(rec('A.TXT', { start: 5, size: 4_000_000 }));
    img.chain(5);
    const { graves, warnings } = img.scan();
    expect(graves[0]?.state).toBe('partial');
    expect(codes(warnings)).toEqual(['size-exceeds-disk']);
  });

  it('stops with exactly one entry-limit warning after 4096 records', () => {
    const clusters: number[] = [];
    for (let c = 2; c <= 300; c++) clusters.push(c);
    const img = new Img().root(dirRec('BIG', 2), rec('LATE.TXT'));
    img.chain(...clusters);
    for (const c of clusters) for (let i = 0; i < 16; i++) img.sub(c, rec('V', { attr: VOL }));
    const { graves, warnings } = img.scan();
    expect(codes(warnings)).toEqual(['entry-limit']);
    expect(graves.map((g) => g.path)).toEqual(['/BIG']);
    expect(MAX_TOTAL_ENTRIES).toBe(4096);
  });

  it('does not warn when the records read stay under the limit', () => {
    const clusters: number[] = [];
    for (let c = 2; c <= 256; c++) clusters.push(c); // 255 * 16 = 4080 records, plus 1 root record
    const img = new Img().root(dirRec('BIG', 2));
    img.chain(...clusters);
    for (const c of clusters) for (let i = 0; i < 16; i++) img.sub(c, rec('V', { attr: VOL }));
    expect(codes(img.scan().warnings)).toEqual([]);
  });

  it('adds date-invalid and sets date to null', () => {
    const img = new Img().root(rec('A.TXT', { date: (22 << 9) | (13 << 5) | 1 }));
    const { graves, warnings } = img.scan();
    expect(graves[0]?.date).toBeNull();
    expect(warnings).toEqual([expect.objectContaining({ code: 'date-invalid', path: '/A.TXT' })]);
  });
});
