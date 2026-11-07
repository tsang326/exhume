// Feature: mcp-server, read_grave examples (Requirements 8.1 to 8.12, 16.6)
// **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9, 8.10, 8.11, 8.12, 16.6**
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writeFat12ImageWithLayout } from '../test-support/fat12';
import type { FileTree } from '../test-support/fat12';
import { writeWordStar } from '../test-support/formats';
import {
  bytesOf,
  dbfFile,
  diskWith,
  duplicatePathDisk,
  pcxFile,
  wordstarFile,
} from '../test-support/mcp/images';
import { callTool } from '../test-support/mcp/rpc';
import { makeWorkspace, type Workspace } from '../test-support/mcp/workspace';
import { MESSAGES, type ErrorCode } from './errors';
import { MAX_TEXT_CHARS } from './limits';
import { createServer } from './server';

let ws: Workspace;

beforeEach(() => {
  ws = makeWorkspace();
});

afterEach(() => {
  ws.cleanup();
});

function rec(v: unknown): Record<string, unknown> {
  expect(typeof v).toBe('object');
  expect(v).not.toBeNull();
  return v as Record<string, unknown>;
}

type Call = ReturnType<typeof callTool>;

function expectCode(r: Call, code: ErrorCode): void {
  expect(r.isError).toBe(true);
  expect(r.output).toEqual({ error: code, message: MESSAGES[code] });
}

function ok(r: Call): Record<string, unknown> {
  expect(r.isError).toBe(false);
  const out = rec(r.output);
  expect(out.untrusted).toBe(true);
  expect(typeof out.notice).toBe('string');
  return out;
}

function setup(image: Uint8Array): ReturnType<typeof createServer> {
  ws.write('disk.img', image);
  return createServer(ws.root);
}

function read(server: ReturnType<typeof createServer>, args: Record<string, unknown>): Call {
  return callTool(server, 'read_grave', { image: 'disk.img', ...args });
}

function entries(server: ReturnType<typeof createServer>): Record<string, unknown>[] {
  const out = ok(callTool(server, 'open_disk', { image: 'disk.img' }));
  return out.entries as Record<string, unknown>[];
}

function wordstarText(text: string): Uint8Array {
  return writeWordStar([{ spans: [{ text }] }]);
}

describe('read_grave conversions', () => {
  it('converts WordStar to Markdown', () => {
    const server = setup(diskWith([{ name: 'MEMO.WS', content: wordstarFile() }]));
    const out = ok(read(server, { path: '/MEMO.WS' }));
    expect(out.format).toBe('markdown');
    expect(out.extension).toBe('.md');
    expect(out.truncated).toBe(false);
    expect(String(out.text)).toContain('Dear reader');
    expect(String(out.text)).toContain('Second paragraph.');
    expect(out.totalChars).toBe(String(out.text).length);
    const grave = rec(out.grave);
    expect(grave.path).toBe('/MEMO.WS');
    expect(grave.state).toBe('alive');
  });

  it('converts dBase to CSV with readable rows', () => {
    const server = setup(diskWith([{ name: 'PEOPLE.DBF', content: dbfFile() }]));
    const out = ok(read(server, { path: '/PEOPLE.DBF' }));
    expect(out.format).toBe('csv');
    expect(out.extension).toBe('.csv');
    const rows = String(out.text).split(/\r?\n/).filter((l) => l !== '');
    expect(rows[0]).toBe('NAME,CITY');
    expect(rows).toContain('Ada,London');
    expect(rows).toContain('Grace,NYC');
    expect(rows).toContain('Linus,Helsinki');
  });

  it('converts PCX to PNG facts without pixel data', () => {
    const server = setup(diskWith([{ name: 'PIC.PCX', content: pcxFile() }]));
    const r = read(server, { path: '/PIC.PCX' });
    const out = ok(r);
    expect(out.format).toBe('png');
    expect(out.mime).toBe('image/png');
    expect(out.width).toBe(8);
    expect(out.height).toBe(4);
    expect(typeof out.bytes).toBe('number');
    expect(out.bytes as number).toBeGreaterThan(8);
    expect(out).not.toHaveProperty('text');
    expect(out).not.toHaveProperty('data');
    expect(out).not.toHaveProperty('base64');
    expect(r.line.length).toBeLessThan(2000);
  });
});

describe('read_grave failures', () => {
  it('rejects a directory', () => {
    const tree: FileTree = {
      children: [{ kind: 'directory', name: 'SUB', children: [{ kind: 'file', name: 'A.WS', content: wordstarFile() }] }],
    };
    const server = setup(writeFat12ImageWithLayout(tree, '1440K').image);
    expect(entries(server).some((e) => e.path === '/SUB' && e.kind === 'directory')).toBe(true);
    expectCode(read(server, { path: '/SUB' }), 'GRAVE_NOT_READABLE');
  });

  it('rejects a lost Grave', () => {
    const tree: FileTree = {
      children: [
        { kind: 'file', name: 'LIVE.BIN', content: new Uint8Array(1536).fill(7) },
        {
          kind: 'file',
          name: 'GONE.WS',
          content: wordstarFile(),
          deleted: true,
          placement: { startCluster: 2 },
        },
      ],
    };
    const server = setup(writeFat12ImageWithLayout(tree, '1440K').image);
    const lost = entries(server).find((e) => e.state === 'lost');
    expect(lost).toBeDefined();
    expectCode(read(server, { path: String(lost?.path) }), 'GRAVE_NOT_READABLE');
  });

  it('reports NO_CONVERTER for unknown content', () => {
    const server = setup(diskWith([{ name: 'PLAIN.TXT', content: bytesOf('plain text, nothing to detect') }]));
    expectCode(read(server, { path: '/PLAIN.TXT' }), 'NO_CONVERTER');
  });

  it('reports CONVERSION_FAILED for a recognised but damaged file', () => {
    const server = setup(diskWith([{ name: 'BAD.DBF', content: dbfFile().subarray(0, 40) }]));
    expectCode(read(server, { path: '/BAD.DBF' }), 'CONVERSION_FAILED');
  });

  it('reports GRAVE_NOT_FOUND for an unknown path', () => {
    const server = setup(diskWith([{ name: 'MEMO.WS', content: wordstarFile() }]));
    expectCode(read(server, { path: '/NOPE.WS' }), 'GRAVE_NOT_FOUND');
    expectCode(read(server, { path: '/memo.ws' }), 'GRAVE_NOT_FOUND');
  });
});

describe('read_grave states and caps', () => {
  it('returns content of a partial Grave with its state and reason', () => {
    const content = wordstarFile();
    const tree: FileTree = { children: [{ kind: 'file', name: 'CUT.WS', content }] };
    const image = writeFat12ImageWithLayout(tree, '1440K', {
      damage: [{ type: 'size-exceeds-chain', path: '/CUT.WS', extraBytes: 100 }],
    }).image;
    const server = setup(image);
    const out = ok(read(server, { path: '/CUT.WS' }));
    const grave = rec(out.grave);
    expect(grave.state).toBe('partial');
    expect(typeof grave.reason).toBe('string');
    expect(String(grave.reason).length).toBeGreaterThan(0);
    expect(String(out.text)).toContain('Dear reader');
    expect(Array.isArray(out.warnings)).toBe(true);
  });

  it('truncates a text longer than MAX_TEXT_CHARS and reports the total', () => {
    const big = wordstarText('x'.repeat(MAX_TEXT_CHARS + 5000));
    const server = setup(diskWith([{ name: 'BIG.WS', content: big }]));
    const out = ok(read(server, { path: '/BIG.WS' }));
    expect(out.truncated).toBe(true);
    expect(String(out.text).length).toBe(MAX_TEXT_CHARS);
    expect(out.totalChars as number).toBeGreaterThan(MAX_TEXT_CHARS);
  });
});

describe('read_grave selection', () => {
  function twoMemos(): ReturnType<typeof createServer> {
    return setup(
      diskWith([
        { name: '_EPORT.WS', content: wordstarText('alive version') },
        { name: 'REPORT.WS', content: wordstarText('deleted version'), deleted: true },
        { name: 'OTHER.WS', content: wordstarText('other file') },
      ]),
    );
  }

  it('selects each duplicate by id', () => {
    const server = twoMemos();
    const dup = entries(server).filter((e) => e.path === '/_EPORT.WS');
    expect(dup).toHaveLength(2);
    const texts = dup.map((e) => {
      const out = ok(read(server, { path: '/_EPORT.WS', id: e.id }));
      expect(rec(out.grave).id).toBe(e.id);
      return String(out.text);
    });
    expect(texts.some((t) => t.includes('alive version'))).toBe(true);
    expect(texts.some((t) => t.includes('deleted version'))).toBe(true);
  });

  it('selects the first Grave when id is absent', () => {
    const server = twoMemos();
    const first = entries(server).find((e) => e.path === '/_EPORT.WS');
    const out = ok(read(server, { path: '/_EPORT.WS' }));
    expect(rec(out.grave).id).toBe(first?.id);
    expect(String(out.text)).toContain('alive version');
  });

  it('reports GRAVE_NOT_FOUND for an id with another path or no Grave', () => {
    const server = twoMemos();
    const other = entries(server).find((e) => e.path === '/OTHER.WS');
    expectCode(read(server, { path: '/_EPORT.WS', id: other?.id }), 'GRAVE_NOT_FOUND');
    expectCode(read(server, { path: '/_EPORT.WS', id: 9999 }), 'GRAVE_NOT_FOUND');
  });

  it('reports INVALID_ARGUMENTS for a negative, fractional or string id', () => {
    const server = twoMemos();
    for (const id of [-1, 0.5, '0']) {
      expectCode(read(server, { path: '/_EPORT.WS', id }), 'INVALID_ARGUMENTS');
    }
  });

  it('keeps duplicate-path ids stable on the provided duplicate disk', () => {
    const server = setup(duplicatePathDisk());
    const dup = entries(server).filter((e) => e.path === '/_EPORT.TXT');
    expect(dup).toHaveLength(2);
    // Plain text has no converter, but the selection itself succeeds (not GRAVE_NOT_FOUND).
    for (const e of dup) expectCode(read(server, { path: '/_EPORT.TXT', id: e.id }), 'NO_CONVERTER');
  });

  it('selects a Grave by the shown path of a sanitized name', () => {
    const raw = 'ctl\u0001\u001b[31mred\u2028x.ws';
    const server = setup(
      diskWith([{ name: 'CTL.WS', longName: raw, content: wordstarText('sanitized name body') }]),
    );
    const shown = String(entries(server)[0]?.path);
    expect(shown).not.toBe('/' + raw);
    // eslint-disable-next-line no-control-regex
    expect(shown).not.toMatch(/[\u0000-\u001f\u007f\u2028]/);
    const out = ok(read(server, { path: shown }));
    expect(String(out.text)).toContain('sanitized name body');
    expect(rec(out.grave).path).toBe(shown);
  });

  it('selects a Grave by the shown path of a capped name', () => {
    const tree: FileTree = {
      children: [
        {
          kind: 'directory',
          name: 'DEEP',
          longName: 'dirname',
          children: [
            { kind: 'file', name: 'LONG.WS', longName: 'f'.repeat(252) + '.ws', content: wordstarText('capped name body') },
          ],
        },
      ],
    };
    const server = setup(writeFat12ImageWithLayout(tree, '1440K').image);
    const file = entries(server).find((e) => e.kind === 'file');
    expect(file).toBeDefined();
    const shown = String(file?.path);
    expect(shown.length).toBeLessThanOrEqual(255);
    const out = ok(read(server, { path: shown }));
    expect(String(out.text)).toContain('capped name body');
  });
});
