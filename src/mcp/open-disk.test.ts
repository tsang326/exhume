import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { bytesOf, diskWith } from '../test-support/mcp/images';
import { recordingFs } from '../test-support/mcp/recording-fs';
import { callTool } from '../test-support/mcp/rpc';
import { makeWorkspace, type Workspace } from '../test-support/mcp/workspace';
import { NOTICE } from './envelope';
import { nodeFs } from './fs-layer';
import { MAX_REPORT_ENTRIES } from './limits';
import { createServer } from './server';

let ws: Workspace;

beforeEach(() => {
  ws = makeWorkspace();
});

afterEach(() => {
  ws.cleanup();
});

function asRecord(v: unknown): Record<string, unknown> {
  expect(typeof v).toBe('object');
  expect(v).not.toBeNull();
  return v as Record<string, unknown>;
}

function open(server: ReturnType<typeof createServer>, image: string): Record<string, unknown> {
  const res = callTool(server, 'open_disk', { image });
  expect(res.isError).toBe(false);
  return asRecord(res.output);
}

describe('open_disk', () => {
  it('reports a small image: members, counts, entry fields, envelope', () => {
    ws.write(
      'notes.img',
      diskWith([
        { name: 'A.TXT', content: bytesOf('alive file\r\n') },
        { name: 'B.TXT', content: bytesOf('another\r\n') },
        { name: 'GONE.TXT', content: bytesOf('deleted file\r\n'), deleted: true },
      ]),
    );
    const out = open(createServer(ws.root), 'notes.img');

    expect(Object.keys(out)).toEqual([
      'untrusted',
      'notice',
      'volume',
      'totalEntries',
      'counts',
      'entries',
      'truncated',
      'warnings',
      'warningsOmitted',
    ]);
    expect(out.untrusted).toBe(true);
    expect(out.notice).toBe(NOTICE);
    expect(out.totalEntries).toBe(3);
    expect(out.truncated).toBe(false);
    expect(out.warningsOmitted).toBe(0);
    expect(Array.isArray(out.warnings)).toBe(true);

    const volume = asRecord(out.volume);
    expect(typeof volume.label).toBe('string');
    expect(volume.geometrySource).not.toBe('none');

    const counts = asRecord(out.counts);
    expect(Object.keys(counts).sort()).toEqual(['alive', 'lost', 'partial', 'recovered']);
    const total = Number(counts.alive) + Number(counts.recovered) + Number(counts.partial) + Number(counts.lost);
    expect(total).toBe(3);
    expect(counts.alive).toBe(2);

    const entries = out.entries as Record<string, unknown>[];
    expect(entries).toHaveLength(3);
    const paths = entries.map((e) => e.path);
    expect(paths).toContain('/A.TXT');
    expect(paths).toContain('/B.TXT');
    for (const e of entries) {
      expect(typeof e.id).toBe('number');
      expect(typeof e.path).toBe('string');
      expect(['file', 'directory']).toContain(e.kind);
      expect(['alive', 'recovered', 'partial', 'lost']).toContain(e.state);
      expect(typeof e.size).toBe('number');
      expect(e.date === null || typeof e.date === 'string').toBe(true);
    }
    const a = entries.find((e) => e.path === '/A.TXT');
    expect(a?.state).toBe('alive');
    expect(a?.kind).toBe('file');
    expect(a?.size).toBe(12);
  });

  it('succeeds with zero Graves', () => {
    ws.write('empty.img', diskWith([]));
    const out = open(createServer(ws.root), 'empty.img');
    expect(out.totalEntries).toBe(0);
    expect(out.entries).toEqual([]);
    expect(out.counts).toEqual({ alive: 0, recovered: 0, partial: 0, lost: 0 });
    expect(out.truncated).toBe(false);
    expect(out.untrusted).toBe(true);
  });

  it('succeeds on random bytes with geometry source none', () => {
    const bytes = new Uint8Array(4096);
    let x = 0x2545f491;
    for (let i = 0; i < bytes.length; i++) {
      x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
      bytes[i] = x >>> 24;
    }
    ws.write('noise.img', bytes);
    const out = open(createServer(ws.root), 'noise.img');
    expect(asRecord(out.volume).geometrySource).toBe('none');
    expect(out.untrusted).toBe(true);
    expect(out.notice).toBe(NOTICE);
  });

  it('caps entries and sets truncated above 200 Graves', () => {
    const files = Array.from({ length: MAX_REPORT_ENTRIES + 10 }, (_, i) => ({
      name: `F${String(i).padStart(4, '0')}.TXT`,
      content: new Uint8Array(0),
    }));
    ws.write('many.img', diskWith(files, '1440K'));
    const out = open(createServer(ws.root), 'many.img');
    expect(out.totalEntries).toBe(MAX_REPORT_ENTRIES + 10);
    expect((out.entries as unknown[]).length).toBe(MAX_REPORT_ENTRIES);
    expect(out.truncated).toBe(true);
    const counts = asRecord(out.counts);
    expect(counts.alive).toBe(MAX_REPORT_ENTRIES + 10);
  });

  it('writes nothing and keeps no state between calls', () => {
    ws.write('notes.img', diskWith([{ name: 'A.TXT', content: bytesOf('hello\r\n') }]));
    const before = ws.tree();
    const { fs, calls } = recordingFs(nodeFs);
    const server = createServer(ws.root, { fs });

    const first = open(server, 'notes.img');
    const second = open(server, 'notes.img');
    expect(second).toEqual(first);

    // A changed file is seen by the next call: nothing is cached.
    ws.write('notes.img', diskWith([]));
    expect(open(server, 'notes.img').totalEntries).toBe(0);

    const writes = new Set(['openExclusive', 'write', 'mkdir', 'unlink']);
    expect(calls.filter((c) => writes.has(c.op))).toEqual([]);

    ws.write('notes.img', diskWith([{ name: 'A.TXT', content: bytesOf('hello\r\n') }]));
    expect(ws.tree().filter((l) => !l.startsWith('notes.img '))).toEqual(
      before.filter((l) => !l.startsWith('notes.img ')),
    );
  });
});
