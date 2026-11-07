import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { writeWordStar } from '../test-support/formats/index';
import { dbfFile, diskWith, longName, pcxFile, wordstarFile } from '../test-support/mcp/images';
import { faultyFs } from '../test-support/mcp/recording-fs';
import { callTool } from '../test-support/mcp/rpc';
import { makeWorkspace } from '../test-support/mcp/workspace';
import type { Workspace } from '../test-support/mcp/workspace';
import { MAX_EXHUME_NAME_CHARS, MAX_SUFFIX } from './limits';
import { nodeFs } from './fs-layer';
import type { FileLayer } from './fs-layer';
import { createServer } from './server';

const spaces: Workspace[] = [];
function space(): Workspace {
  const w = makeWorkspace();
  spaces.push(w);
  return w;
}
afterEach(() => {
  for (const w of spaces.splice(0)) w.cleanup();
});

function errorOf(output: unknown): unknown {
  return (output as { error?: unknown }).error;
}

function wsDoc(text: string): Uint8Array {
  return writeWordStar([{ spans: [{ text }] }]);
}

function exhumedFiles(w: Workspace): string[] {
  const dir = join(w.root, 'exhumed');
  return existsSync(dir) ? readdirSync(dir).sort() : [];
}

function setup(files: Parameters<typeof diskWith>[0], fs?: FileLayer) {
  const w = space();
  w.write('disk.img', diskWith(files));
  return { w, server: createServer(w.root, fs === undefined ? undefined : { fs }) };
}

const NOTES = [{ name: 'NOTES.WS', content: wordstarFile() }];

describe('exhume tool', () => {
  it('rejects destination arguments with INVALID_ARGUMENTS and writes nothing', () => {
    const { w, server } = setup(NOTES);
    const before = w.tree();
    for (const key of ['dest', 'name', 'folder']) {
      const r = callTool(server, 'exhume', { image: 'disk.img', path: '/NOTES.WS', [key]: 'x' });
      expect(r.isError).toBe(true);
      expect(errorOf(r.output)).toBe('INVALID_ARGUMENTS');
    }
    expect(w.tree()).toEqual(before);
  });

  it('creates the file in exhumed/ with the right extension and content; result members are exact', () => {
    const { w, server } = setup(NOTES);
    const r = callTool(server, 'exhume', { image: 'disk.img', path: '/NOTES.WS' });
    expect(r.isError).toBe(false);
    const out = r.output as Record<string, unknown>;
    expect(Object.keys(out).sort()).toEqual(
      ['untrusted', 'notice', 'path', 'bytes', 'format', 'mime', 'id', 'state'].sort(),
    );
    expect(out.untrusted).toBe(true);
    expect(out.path).toBe('exhumed/NOTES.md');
    expect(out.format).toBe('markdown');
    const data = readFileSync(join(w.root, 'exhumed', 'NOTES.md'));
    expect(out.bytes).toBe(data.length);
    expect(data.toString('utf8')).toContain('Dear reader');
    expect(exhumedFiles(w)).toEqual(['NOTES.md']);
  });

  it('uses .csv for dBase and .png for PCX', () => {
    const { w, server } = setup([
      { name: 'PEOPLE.DBF', content: dbfFile() },
      { name: 'PIC.PCX', content: pcxFile() },
    ]);
    const a = callTool(server, 'exhume', { image: 'disk.img', path: '/PEOPLE.DBF' });
    const b = callTool(server, 'exhume', { image: 'disk.img', path: '/PIC.PCX' });
    expect((a.output as { path: string }).path).toBe('exhumed/PEOPLE.csv');
    expect((b.output as { path: string }).path).toBe('exhumed/PIC.png');
    expect(readFileSync(join(w.root, 'exhumed', 'PEOPLE.csv'), 'utf8')).toContain('Ada');
    const png = readFileSync(join(w.root, 'exhumed', 'PIC.png'));
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG');
  });

  it('gives EXHUME_FAILED when exhumed is a symlink', () => {
    const { w, server } = setup(NOTES);
    const outside = space();
    w.symlink('exhumed', outside.root);
    const r = callTool(server, 'exhume', { image: 'disk.img', path: '/NOTES.WS' });
    expect(r.isError).toBe(true);
    expect(errorOf(r.output)).toBe('EXHUME_FAILED');
    expect(outside.tree()).toEqual([]);
  });

  it('gives EXHUME_FAILED when exhumed is a file', () => {
    const { w, server } = setup(NOTES);
    w.write('exhumed', 'plain file');
    const r = callTool(server, 'exhume', { image: 'disk.img', path: '/NOTES.WS' });
    expect(errorOf(r.output)).toBe('EXHUME_FAILED');
    expect(readFileSync(join(w.root, 'exhumed'), 'utf8')).toBe('plain file');
  });

  it('never follows a planted dangling symlink', () => {
    const { w, server } = setup(NOTES);
    const outside = space();
    const target = join(outside.root, 'missing.md');
    w.symlink('exhumed/NOTES.md', target);
    const r = callTool(server, 'exhume', { image: 'disk.img', path: '/NOTES.WS' });
    expect(r.isError).toBe(false);
    expect((r.output as { path: string }).path).toBe('exhumed/NOTES-1.md');
    expect(existsSync(target)).toBe(false);
    expect(outside.tree()).toEqual([]);
  });

  it('never follows a planted link to an outside file', () => {
    const { w, server } = setup(NOTES);
    const outside = space();
    const target = outside.write('victim.md', 'precious');
    w.symlink('exhumed/NOTES.md', target);
    const r = callTool(server, 'exhume', { image: 'disk.img', path: '/NOTES.WS' });
    expect(r.isError).toBe(false);
    expect(readFileSync(target, 'utf8')).toBe('precious');
    expect(outside.tree().length).toBe(1);
  });

  it('removes the partial file after a failed write', () => {
    const w = space();
    w.write('disk.img', diskWith(NOTES));
    const server = createServer(w.root, { fs: faultyFs(nodeFs, [{ kind: 'writeFail' }]) });
    const r = callTool(server, 'exhume', { image: 'disk.img', path: '/NOTES.WS' });
    expect(r.isError).toBe(true);
    expect(errorOf(r.output)).toBe('EXHUME_FAILED');
    expect(exhumedFiles(w)).toEqual([]);
  });

  it('does not delete a swapped name after a failed write', () => {
    const w = space();
    w.write('disk.img', diskWith(NOTES));
    let created = '';
    const swapping: FileLayer = {
      ...nodeFs,
      openExclusive: (p) => {
        created = p;
        return nodeFs.openExclusive(p);
      },
      write: () => {
        // Keep the original inode alive under another name, so the new file cannot reuse it.
        renameSync(created, created + '.moved');
        writeFileSync(created, 'someone else');
        throw Object.assign(new Error('EIO'), { code: 'EIO' });
      },
    };
    const server = createServer(w.root, { fs: swapping });
    const r = callTool(server, 'exhume', { image: 'disk.img', path: '/NOTES.WS' });
    expect(errorOf(r.output)).toBe('EXHUME_FAILED');
    expect(readFileSync(join(w.root, 'exhumed', 'NOTES.md'), 'utf8')).toBe('someone else');
  });

  it('allows MAX_SUFFIX + 1 calls for the same Grave and fails the next one', () => {
    const { w, server } = setup(NOTES);
    const paths: string[] = [];
    for (let i = 0; i <= MAX_SUFFIX; i++) {
      const r = callTool(server, 'exhume', { image: 'disk.img', path: '/NOTES.WS' });
      expect(r.isError).toBe(false);
      paths.push((r.output as { path: string }).path);
    }
    expect(new Set(paths).size).toBe(MAX_SUFFIX + 1);
    expect(paths[1]).toBe('exhumed/NOTES-1.md');
    expect(paths[MAX_SUFFIX]).toBe(`exhumed/NOTES-${MAX_SUFFIX}.md`);
    const last = callTool(server, 'exhume', { image: 'disk.img', path: '/NOTES.WS' });
    expect(last.isError).toBe(true);
    expect(errorOf(last.output)).toBe('EXHUME_FAILED');
    expect(exhumedFiles(w).length).toBe(MAX_SUFFIX + 1);
  });

  it('id selects exactly one Grave on a duplicate-path disk', () => {
    const { w, server } = setup([
      { name: '_OC.WS', content: wsDoc('alive body') },
      { name: 'DOC.WS', content: wsDoc('deleted body'), deleted: true },
    ]);
    const listing = callTool(server, 'open_disk', { image: 'disk.img' }).output as {
      entries: { id: number; path: string }[];
    };
    expect(listing.entries.length).toBe(2);
    expect(listing.entries[0]?.path).toBe(listing.entries[1]?.path);
    const shown = listing.entries[0]?.path as string;

    const second = callTool(server, 'exhume', { image: 'disk.img', path: shown, id: 1 });
    expect(second.isError).toBe(false);
    const file2 = (second.output as { path: string }).path;
    expect(readFileSync(join(w.root, file2), 'utf8')).toContain('deleted body');
    expect(readFileSync(join(w.root, file2), 'utf8')).not.toContain('alive body');

    const first = callTool(server, 'exhume', { image: 'disk.img', path: shown, id: 0 });
    const file1 = (first.output as { path: string }).path;
    expect(file1).not.toBe(file2);
    expect(readFileSync(join(w.root, file1), 'utf8')).toContain('alive body');
    expect(readFileSync(join(w.root, file1), 'utf8')).not.toContain('deleted body');
  });

  it('yields a Safe_Name for hostile file names', () => {
    const names = [
      'ctl\u0001\u0007\u001b[31mred\u007f.ws',
      'ansi\u001b[2J\u001b]0;t\u0007.ws',
      'sep\\back:colon*star?.ws',
      'bidi\u202Eexe\u2066x\u2069\u2028.ws',
      '\uFF46\uFF49\uFF4C\uFF45\u2215\u0430dmin.ws',
      '..hidden.ws',
      '-dash.ws',
      longName(255, 'q').slice(0, 251) + '.ws',
    ];
    const files = names.map((ln, i) => ({
      name: `H${i}.WS`,
      longName: ln,
      content: wsDoc(`doc ${i}`),
    }));
    const { w, server } = setup(files);
    const listing = callTool(server, 'open_disk', { image: 'disk.img' }).output as {
      entries: { id: number; path: string }[];
    };
    expect(listing.entries.length).toBe(names.length);
    for (const e of listing.entries) {
      const r = callTool(server, 'exhume', { image: 'disk.img', path: e.path, id: e.id });
      expect(r.isError).toBe(false);
      const rel = (r.output as { path: string }).path;
      expect(rel).toMatch(/^exhumed\/[A-Za-z0-9_][A-Za-z0-9._-]*\.md$/);
      expect(rel.length - 'exhumed/'.length).toBeLessThanOrEqual(MAX_EXHUME_NAME_CHARS);
      expect(existsSync(join(w.root, rel))).toBe(true);
    }
    expect(exhumedFiles(w).length).toBe(names.length);
    expect(readdirSync(w.root).sort()).toEqual(['disk.img', 'exhumed']);
  });
});
