import { describe, expect, it } from 'vitest';
import { encodeDosDate, encodeDosTime, encodeShortName, writeFatEntry } from '../../test-support/fat12/encode';
import { openDisk, readDisk, readGraveBytes } from './disk';
import { deriveLayout, type Geometry } from './geometry';
import { MAX_IMAGE_BYTES } from './limits';
import type { Grave } from './types';

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
const END = 0xfff;
const WHEN = { year: 2001, month: 2, day: 3, hour: 4, minute: 5, second: 6 };

function rec(name: string, o: { attr?: number; start?: number; size?: number; deleted?: boolean } = {}): Uint8Array {
  const r = new Uint8Array(32);
  r.set(encodeShortName(name), 0);
  if (o.deleted) r[0] = 0xe5;
  r[11] = o.attr ?? 0x20;
  const time = encodeDosTime(WHEN);
  const date = encodeDosDate(WHEN);
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

class Img {
  readonly image = new Uint8Array(FLOPPY.totalSectors * FLOPPY.bytesPerSector);
  private rootIndex = 0;
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
    this.fatBoth(0, 0xff0).fatBoth(1, END);
  }
  private fatBoth(c: number, v: number): this {
    for (let copy = 0; copy < 2; copy++) {
      const start = layout.fatStart + copy * layout.fatBytes;
      writeFatEntry(this.image.subarray(start, start + layout.fatBytes), c, v);
    }
    return this;
  }
  chain(...clusters: number[]): this {
    clusters.forEach((c, i) => this.fatBoth(c, i + 1 < clusters.length ? (clusters[i + 1] as number) : END));
    return this;
  }
  root(...records: Uint8Array[]): this {
    for (const r of records) this.image.set(r, layout.rootStart + this.rootIndex++ * 32);
    return this;
  }
  data(cluster: number, bytes: Uint8Array): this {
    this.image.set(bytes, layout.dataStart + (cluster - 2) * layout.clusterBytes);
    return this;
  }
  label(text: string): this {
    this.image.set(new TextEncoder().encode(text), 43);
    return this;
  }
}

const pattern = (n: number, seed = 1) => Uint8Array.from({ length: n }, (_, i) => (i * 7 + seed) & 0xff);
const codes = (w: { code: string }[]) => w.map((x) => x.code);

describe('openDisk input handling', () => {
  it('throws TypeError for anything that is not a Uint8Array', () => {
    for (const bad of [null, undefined, 'abc', new ArrayBuffer(512), [1, 2, 3], new Uint16Array(4), {}]) {
      expect(() => openDisk(bad as unknown as Uint8Array)).toThrow(TypeError);
    }
    expect(() => openDisk(null as unknown as Uint8Array)).toThrow('invalid input type: expected Uint8Array');
  });

  it('accepts a Node Buffer', () => {
    const img = new Img().root(rec('A.TXT', { start: 2, size: 3 })).chain(2).data(2, Uint8Array.of(1, 2, 3));
    const report = readDisk(Buffer.from(img.image));
    expect(report.files.map((g) => g.path)).toEqual(['/A.TXT']);
  });

  it('reports image-empty for zero bytes', () => {
    const r = readDisk(new Uint8Array(0));
    expect(codes(r.warnings)).toEqual(['image-empty']);
    expect(r.files).toEqual([]);
    expect(r.volume).toEqual({ label: '', geometrySource: 'none', geometry: null });
  });

  it('reports image-too-large above 2,949,120 bytes with no files', () => {
    const r = readDisk(new Uint8Array(MAX_IMAGE_BYTES + 1));
    expect(codes(r.warnings)).toEqual(['image-too-large']);
    expect(r.files).toEqual([]);
    expect(r.volume.geometry).toBeNull();
  });

  it('reports geometry-unknown below 512 bytes', () => {
    const r = readDisk(new Uint8Array(511));
    expect(codes(r.warnings)).toEqual(['geometry-unknown']);
    expect(r.files).toEqual([]);
  });
});

describe('openDisk scan and reads', () => {
  it('reads a live file back byte for byte across clusters', () => {
    const content = pattern(1300);
    const img = new Img().root(rec('A.TXT', { start: 3, size: 1300 })).chain(3, 7, 4);
    img.data(3, content.subarray(0, 512)).data(7, content.subarray(512, 1024)).data(4, content.subarray(1024));
    const handle = openDisk(img.image);
    const grave = handle.report.files[0] as Grave;
    expect(grave.state).toBe('alive');
    const res = handle.readBytes(grave);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(Array.from(res.bytes)).toEqual(Array.from(content));
      expect(res.warnings).toEqual([]);
    }
    expect(handle.report.volume.geometry?.dataClusters).toBe(layout.dataClusters);
  });

  it('returns an empty success for an empty live file', () => {
    const handle = openDisk(new Img().root(rec('E.TXT')).image);
    const res = handle.readBytes(handle.report.files[0] as Grave);
    expect(res).toEqual({ ok: true, bytes: new Uint8Array(0), warnings: [] });
  });

  it('fails for a directory', () => {
    const img = new Img().root(rec('D', { attr: 0x10, start: 2 })).chain(2);
    const handle = openDisk(img.image);
    expect(handle.readBytes(handle.report.files[0] as Grave)).toEqual({
      ok: false,
      error: 'directory has no file bytes',
    });
  });

  it('fails for a lost file', () => {
    const img = new Img().root(rec('L.TXT', { deleted: true, start: 5, size: 100 })).chain(5);
    const handle = openDisk(img.image);
    const g = handle.report.files[0] as Grave;
    expect(g.state).toBe('lost');
    expect(handle.readBytes(g)).toEqual({ ok: false, error: 'data is not recoverable' });
  });

  it('rejects forged graves without throwing', () => {
    const img = new Img().root(rec('A.TXT', { start: 2, size: 4 })).chain(2);
    const handle = openDisk(img.image);
    const real = handle.report.files[0] as Grave;
    const forged: unknown[] = [
      { ...real, id: NaN },
      { ...real, id: -1 },
      { ...real, id: 1e9 },
      { ...real, id: 0.5 },
      { ...real, path: '/B.TXT' },
      { ...real, size: 5 },
      { ...real, size: NaN },
      { ...real, startCluster: 3 },
      { ...real, kind: 'directory' },
      null,
      undefined,
      42,
      {},
    ];
    for (const f of forged) {
      expect(handle.readBytes(f as Grave)).toEqual({ ok: false, error: 'grave not found in this disk image' });
    }
  });

  it('recovers a deleted file from its stored run only', () => {
    const content = pattern(700, 9);
    const img = new Img().root(rec('D.TXT', { deleted: true, start: 6, size: 700 }));
    img.data(6, content.subarray(0, 512)).data(7, content.subarray(512));
    const handle = openDisk(img.image);
    const g = handle.report.files[0] as Grave;
    expect(g.state).toBe('recovered');
    const res = handle.readBytes(g);
    expect(res.ok).toBe(true);
    if (res.ok) expect(Array.from(res.bytes)).toEqual(Array.from(content));
  });

  it('caps a huge declared size and warns size-exceeds-disk with output-capped', () => {
    const img = new Img().root(rec('BIG.BIN', { start: 2, size: 0xffffffff })).chain(2).data(2, pattern(512));
    const handle = openDisk(img.image);
    const g = handle.report.files[0] as Grave;
    expect(g.size).toBe(0xffffffff);
    const res = openDisk(img.image).readBytes(g);
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.bytes.length).toBe(512);
      expect(codes(res.warnings)).toEqual(expect.arrayContaining(['size-exceeds-disk', 'output-capped']));
      expect(codes(res.warnings)).not.toContain('chain-short');
    }
    // the report was not changed by the read
    expect(handle.readBytes(g).ok).toBe(true);
    expect(codes(handle.report.warnings)).toContain('size-exceeds-disk');
  });

  it('warns fat-copies-differ once', () => {
    const img = new Img().root(rec('A.TXT', { start: 2, size: 1 })).chain(2);
    img.image[layout.fatStart + layout.fatBytes + 100] = 0x77;
    const r = readDisk(img.image);
    expect(codes(r.warnings).filter((c) => c === 'fat-copies-differ')).toHaveLength(1);
  });

  it('decodes the volume label', () => {
    expect(readDisk(new Img().label('MY DISK    ').image).volume.label).toBe('MY DISK');
    expect(readDisk(new Img().label('           ').image).volume.label).toBe('');
    const img = new Img();
    img.image[43] = 0x41;
    img.image[44] = 0x07;
    img.image[45] = 0x82;
    for (let i = 46; i < 54; i++) img.image[i] = 0x20;
    expect(readDisk(img.image).volume.label).toBe('A_é');
  });

  it('produces a report that survives a JSON round trip unchanged', () => {
    const img = new Img()
      .root(rec('A.TXT', { start: 2, size: 5 }), rec('D.TXT', { deleted: true, start: 9, size: 10 }))
      .chain(2);
    img.image[layout.fatStart + layout.fatBytes + 50] = 1;
    const report = readDisk(img.image);
    expect(JSON.parse(JSON.stringify(report))).toEqual(report);
    expect(JSON.stringify(report)).not.toContain('undefined');
  });

  it('never modifies the input image', () => {
    const img = new Img()
      .root(rec('A.TXT', { start: 2, size: 600 }), rec('X.TXT', { deleted: true, start: 8, size: 20 }))
      .chain(2, 3)
      .data(2, pattern(512));
    const before = img.image.slice();
    const handle = openDisk(img.image);
    for (const g of handle.report.files) handle.readBytes(g);
    readGraveBytes(img.image, handle.report.files[0] as Grave);
    expect(Buffer.compare(img.image, before)).toBe(0);
  });
});
