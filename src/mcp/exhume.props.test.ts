import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { openDisk } from '../core/fat12/index';
import { convertAuto } from '../core/formats/index';
import { encodePcx, writeDbf, writeWordStar } from '../test-support/formats/index';
import { bytesOf, diskWith, wordstarFile } from '../test-support/mcp/images';
import { callTool } from '../test-support/mcp/rpc';
import { makeWorkspace } from '../test-support/mcp/workspace';
import type { Workspace } from '../test-support/mcp/workspace';
import { numRuns } from '../test-support/runs';
import { exhumeBase, exhumeName } from './exhume-writer';
import { MAX_EXHUME_NAME_CHARS, MAX_SUFFIX, MAX_TEXT_CHARS } from './limits';
import { sanitizeText, viewPath } from './sanitize';
import { createServer } from './server';

/** Runs `body` with a fresh workspace and removes it afterwards, also when the body throws. */
function withSpace<T>(body: (w: Workspace) => T): T {
  const w = makeWorkspace();
  try {
    return body(w);
  } finally {
    w.cleanup();
  }
}

type Ext = '.md' | '.csv' | '.png';
const EXTS: readonly Ext[] = ['.md', '.csv', '.png'];
const SAFE_NAME = /^[A-Za-z0-9._-]{1,64}$/;
const SAFE_CHAR = /^[A-Za-z0-9._-]$/;

/** Step-by-step reference for the file name, written independently of exhume-writer.ts. */
function referenceName(gravePath: string, n: number, ext: Ext): string {
  const parts = gravePath.split('/');
  let seg = parts[parts.length - 1] ?? '';
  const dot = seg.lastIndexOf('.');
  if (dot > 0) seg = seg.slice(0, dot);
  let chars = Array.from(seg).map((c) => (SAFE_CHAR.test(c) ? c : '_'));
  while (chars[0] === '.') chars = chars.slice(1);
  if (chars[0] === '-') chars[0] = '_';
  let base = chars.join('');
  if (base === '') base = 'grave';
  const room = 64 - ('-99'.length + ext.length);
  base = base.slice(0, room);
  return base + (n > 0 ? `-${n}` : '') + ext;
}

const unitArb = fc.oneof(
  { arbitrary: fc.constantFrom('/', '\\', '.', '-', ' ', ':', '*', '\u0000', '\u001b', '\u202E', '\u2028', '\uFF0F', '\u2215', '\uD800', '\uDC00'), weight: 3 },
  { arbitrary: fc.integer({ min: 0x01, max: 0x7e }).map((c) => String.fromCharCode(c)), weight: 3 },
  { arbitrary: fc.integer({ min: 0xa0, max: 0x10ffff }).filter((c) => c < 0xd800 || c > 0xdfff).map((c) => String.fromCodePoint(c)), weight: 3 },
);
const segmentArb = fc.oneof(
  fc.string({ unit: unitArb, maxLength: 40 }),
  fc.constantFrom('', '.', '..', '...', '-', '--x', 'CON', 'NUL', 'aux.txt', 'COM1', '.hidden', 'a.b.c'),
  fc.integer({ min: 60, max: 400 }).map((n) => 'x'.repeat(n)),
  fc.integer({ min: 60, max: 400 }).map((n) => '\u00e9'.repeat(n) + '.ws'),
);
const gravePathArb = fc
  .array(segmentArb, { minLength: 1, maxLength: 5 })
  .map((segs) => '/' + segs.join('/'));

describe('exhume properties', () => {
  // Feature: mcp-server, Property 19: Exhumed file names are safe and the write stays inside exhumed/
  // **Validates: Requirements 9.3, 9.4, 9.10, 9.11**
  it('rebuilds every grave path into a Safe_Name equal to the reference', () => {
    fc.assert(
      fc.property(
        gravePathArb,
        fc.constantFrom(...EXTS),
        fc.integer({ min: 0, max: MAX_SUFFIX }),
        (path, ext, n) => {
          const name = exhumeName(exhumeBase(path, ext), n, ext);
          return (
            SAFE_NAME.test(name) &&
            name.length <= MAX_EXHUME_NAME_CHARS &&
            name !== '.' &&
            name !== '..' &&
            !name.startsWith('.') &&
            !name.startsWith('-') &&
            name.endsWith(ext) &&
            name === referenceName(path, n, ext)
          );
        },
      ),
      { numRuns: numRuns(300) },
    );
  });

  const hostileLongNameArb = fc
    .oneof(
      fc.string({ unit: unitArb.filter((c) => c !== '\u0000' && c !== '\uD800' && c !== '\uDC00' && c !== '/'), minLength: 1, maxLength: 30 }),
      fc.integer({ min: 200, max: 251 }).map((n) => 'q'.repeat(n)),
    )
    .map((s) => s.slice(0, 251).replace(/[\uD800-\uDFFF]/g, 'z') + '.ws');

  it('writes only a Safe_Name file directly inside exhumed/ for hostile disk names', () => {
    fc.assert(
      fc.property(hostileLongNameArb, (longName) => {
        return withSpace((w) => {
          const disk = diskWith([{ name: 'HOST.WS', longName, content: wordstarFile() }]);
          w.write('disk.img', disk);
          const grave = openDisk(disk).report.files.find((g) => g.kind !== 'directory');
          if (grave === undefined) return false;
          const server = createServer(w.root);
          const r = callTool(server, 'exhume', { image: 'disk.img', path: viewPath(grave.path), id: grave.id });
          const out = r.output as { path?: string } | undefined;
          if (r.isError || typeof out?.path !== 'string') return false;
          const expected = referenceName(grave.path, 0, '.md');
          if (out.path !== `exhumed/${expected}` || !SAFE_NAME.test(expected)) return false;
          const top = readdirSync(w.root).sort();
          const inside = readdirSync(join(w.root, 'exhumed'));
          return (
            top.length === 2 &&
            top[0] === 'disk.img' &&
            top[1] === 'exhumed' &&
            inside.length === 1 &&
            inside[0] === expected
          );
        });
      }),
      { numRuns: numRuns(25) },
    );
  });

  type Plant = 'file' | 'dir' | 'dangling' | 'outside';
  const plantsArb = fc.uniqueArray(
    fc.record({ n: fc.integer({ min: 0, max: 8 }), kind: fc.constantFrom<Plant>('file', 'dir', 'dangling', 'outside') }),
    { selector: (p) => p.n, maxLength: 9 },
  );
  const callsArb = fc.oneof(
    fc.integer({ min: 1, max: 120 }),
    fc.constantFrom(MAX_SUFFIX - 1, MAX_SUFFIX, MAX_SUFFIX + 1, MAX_SUFFIX + 2, 120),
  );

  // Feature: mcp-server, Property 20: Exhume never overwrites and caps its suffixes
  // **Validates: Requirements 9.6, 9.7, 9.12**
  it('never overwrites, never follows links, and fails after MAX_SUFFIX + 1 names', () => {
    const disk = diskWith([{ name: 'NOTES.WS', content: wordstarFile() }], '360K');
    const conv = convertAuto(wordstarFile(), 'NOTES.WS');
    if (!conv.ok || typeof conv.output !== 'string') throw new Error('fixture does not convert');
    const expectedText = conv.output;

    fc.assert(
      fc.property(callsArb, plantsArb, (calls, plants) => {
        const outside = makeWorkspace();
        try {
          return withSpace((w) => {
            w.write('disk.img', disk);
            mkdirSync(join(w.root, 'exhumed'));
            const nameOf = (n: number) => (n > 0 ? `NOTES-${n}.md` : 'NOTES.md');
            for (const p of plants) {
              const rel = `exhumed/${nameOf(p.n)}`;
              if (p.kind === 'file') w.write(rel, `planted ${p.n}`);
              else if (p.kind === 'dir') mkdirSync(join(w.root, rel));
              else if (p.kind === 'dangling') w.symlink(rel, join(outside.root, `missing-${p.n}.md`));
              else w.symlink(rel, outside.write(`victim-${p.n}.md`, `precious ${p.n}`));
            }
            const outsideBefore = outside.tree();
            const plantedBefore = w.tree().filter((l) => l.startsWith('exhumed/'));
            const planted = new Set(plants.map((p) => nameOf(p.n)));
            const freeNames: string[] = [];
            for (let n = 0; n <= MAX_SUFFIX; n += 1) if (!planted.has(nameOf(n))) freeNames.push(nameOf(n));

            const server = createServer(w.root);
            const created: string[] = [];
            for (let k = 0; k < calls; k += 1) {
              const r = callTool(server, 'exhume', { image: 'disk.img', path: '/NOTES.WS' });
              const out = r.output as { path?: string; error?: string } | undefined;
              if (k < freeNames.length) {
                if (r.isError || out?.path !== `exhumed/${freeNames[k]}`) return false;
                created.push(freeNames[k] as string);
              } else if (!r.isError || out?.error !== 'EXHUME_FAILED') {
                return false;
              }
            }

            const after = w.tree();
            const top = readdirSync(w.root).sort();
            if (top.length !== 2 || top[0] !== 'disk.img' || top[1] !== 'exhumed') return false;
            if (readdirSync(join(w.root, 'exhumed')).length !== plants.length + created.length) return false;
            if (!plantedBefore.every((l) => after.includes(l))) return false;
            if (outside.tree().join('\n') !== outsideBefore.join('\n')) return false;
            return created.every(
              (name) => readFileSync(join(w.root, 'exhumed', name), 'utf8') === expectedText,
            );
          });
        } finally {
          outside.cleanup();
        }
      }),
      { numRuns: numRuns(10) },
    );
  });

  // A line that starts with '.' plus two ASCII letters is a WordStar dot command. detect.ts counts it as a
  // WordStar trait before it looks at the .TXT name, so the grave would not be a text grave. Keep such lines out
  // by pushing a leading '.' one column right.
  const noDotCommand = (line: string): string => (line.startsWith('.') ? ` ${line}` : line);
  const textLineArb = fc
    .string({
      unit: fc.integer({ min: 0x20, max: 0x7e }).map((c) => String.fromCharCode(c)),
      maxLength: 60,
    })
    .map(noDotCommand);
  const textBodyArb = fc
    .tuple(fc.array(textLineArb, { maxLength: 8 }), fc.constantFrom('\r\n', '\n', '\r'))
    .map(([lines, eol]) => 'a' + lines.join(eol) + eol);
  const textLongNameArb = fc
    .oneof(
      fc.string({ unit: unitArb.filter((c) => c !== '\u0000' && c !== '\uD800' && c !== '\uDC00' && c !== '/'), minLength: 1, maxLength: 30 }),
      fc.integer({ min: 200, max: 251 }).map((n) => 'q'.repeat(n)),
    )
    .map((s) => s.slice(0, 251).replace(/[\uD800-\uDFFF]/g, 'z') + '.txt');

  // Feature: plain-text, Property 17: exhume writes one safe .txt file
  // **Validates: Requirements 5.3, 5.4**
  const writesSafeTxt = (body: string, longName: string): boolean =>
        withSpace((w) => {
          const content = bytesOf(body);
          const disk = diskWith([{ name: 'NOTE.TXT', longName, content }]);
          w.write('disk.img', disk);
          const grave = openDisk(disk).report.files.find((g) => g.kind !== 'directory');
          if (grave === undefined) return false;
          const conv = convertAuto(content, 'NOTE.TXT');
          if (!conv.ok || typeof conv.output !== 'string' || conv.mime !== 'text/plain') return false;
          const expected = Buffer.from(conv.output, 'utf8');

          const server = createServer(w.root);
          const args = { image: 'disk.img', path: viewPath(grave.path), id: grave.id };
          const paths: string[] = [];
          for (let k = 0; k < 2; k += 1) {
            const r = callTool(server, 'exhume', args);
            const out = r.output as { path?: string; format?: string; mime?: string; bytes?: number } | undefined;
            if (r.isError || typeof out?.path !== 'string') return false;
            if (out.format !== 'text' || out.mime !== 'text/plain') return false;
            if (!out.path.startsWith('exhumed/') || paths.includes(out.path)) return false;
            const name = out.path.slice('exhumed/'.length);
            if (!SAFE_NAME.test(name) || !name.endsWith('.txt')) return false;
            paths.push(out.path);
            const inside = readdirSync(join(w.root, 'exhumed'));
            if (inside.length !== k + 1 || !inside.includes(name)) return false;
            const data = readFileSync(join(w.root, out.path));
            if (out.bytes !== data.length || !data.equals(expected)) return false;
          }
          return readdirSync(w.root).sort().join('|') === 'disk.img|exhumed';
        });

  it('writes one new safe .txt file per call for a text grave and never replaces one', () => {
    fc.assert(
      fc.property(textBodyArb, textLongNameArb, (body, longName) => writesSafeTxt(body, longName)),
      { numRuns: numRuns(25) },
    );
  });

  // Former counterexample: lines ['', '.AA'] with long name ' .txt' gave the body "a\r\n.AA\r\n",
  // which detect.ts reads as WordStar. The generator now shifts the '.' right.
  it('keeps a dot-command-looking line a text line (deterministic example)', () => {
    const body = 'a' + ['', noDotCommand('.AA')].join('\r\n') + '\r\n';
    expect(body).toBe('a\r\n .AA\r\n');
    expect(writesSafeTxt(body, ' .txt')).toBe(true);
  });

  const wordArb = fc.stringMatching(/^[A-Za-z]{1,10}$/);
  const pad = (text: string, length: number): Uint8Array => {
    const out = new Uint8Array(length).fill(0x20);
    out.set(bytesOf(text).subarray(0, length));
    return out;
  };
  interface Fixture {
    ext: string;
    bytes: Uint8Array;
  }
  const fixtureArb: fc.Arbitrary<Fixture> = fc.oneof(
    fc
      .array(fc.array(wordArb, { minLength: 1, maxLength: 6 }).map((w) => w.join(' ')), { minLength: 1, maxLength: 4 })
      .map((paras) => ({ ext: 'WS', bytes: writeWordStar(paras.map((text) => ({ spans: [{ text }] }))) })),
    fc.constant(0).map(() => ({
      ext: 'WS',
      bytes: writeWordStar([{ spans: [{ text: 'word '.repeat(Math.ceil((MAX_TEXT_CHARS + 500) / 5)) }] }]),
    })),
    fc.array(fc.tuple(wordArb, wordArb), { minLength: 1, maxLength: 5 }).map((rows) => ({
      ext: 'DBF',
      bytes: writeDbf({
        fields: [
          { name: 'NAME', type: 'C', length: 10, decimals: 0 },
          { name: 'CITY', type: 'C', length: 10, decimals: 0 },
        ],
        records: rows.map(([a, b]) => ({ deleted: false, values: [pad(a, 10), pad(b, 10)] })),
      }),
    })),
    fc
      .record({ w: fc.integer({ min: 1, max: 24 }), h: fc.integer({ min: 1, max: 12 }), seed: fc.nat(255) })
      .map(({ w, h, seed }) => {
        const indices = new Uint8Array(w * h);
        for (let i = 0; i < indices.length; i += 1) indices[i] = (i + seed) % 2;
        const palette = new Uint8Array(48);
        palette.set([0, 0, 0, 255, 255, 255], 0);
        return { ext: 'PCX', bytes: encodePcx({ mode: 'mono', width: w, height: h, indices, palette }) };
      }),
  );

  // Feature: mcp-server, Property 21: Exhumed bytes equal the full converter output of the selected grave
  // **Validates: Requirements 8.14, 9.1, 9.8, 9.13, 16.11**
  it('writes exactly the full convertAuto output of the selected grave', () => {
    fc.assert(
      fc.property(fc.array(fixtureArb, { minLength: 1, maxLength: 3 }), fc.nat(), (fixtures, pick) => {
        return withSpace((w) => {
          const files = fixtures.map((f, i) => ({ name: `F${i}.${f.ext}`, content: f.bytes }));
          const disk = diskWith(files);
          w.write('disk.img', disk);
          const graves = openDisk(disk).report.files.filter((g) => g.kind !== 'directory');
          const chosen = graves[pick % graves.length];
          const fixture = fixtures[Number(/F(\d+)\./.exec(chosen?.path ?? '')?.[1])];
          if (chosen === undefined || fixture === undefined) return false;
          const name = chosen.path.slice(chosen.path.lastIndexOf('/') + 1);
          const expected = convertAuto(fixture.bytes, name);
          if (!expected.ok) return false;

          const server = createServer(w.root);
          const args = { image: 'disk.img', path: viewPath(chosen.path), id: chosen.id };
          const r = callTool(server, 'exhume', args);
          const out = r.output as { path?: string; bytes?: number } | undefined;
          if (r.isError || typeof out?.path !== 'string' || !out.path.startsWith('exhumed/')) return false;
          const data = readFileSync(join(w.root, out.path));
          if (out.bytes !== data.length) return false;

          if (typeof expected.output === 'string') {
            const full = Buffer.from(expected.output, 'utf8');
            if (!data.equals(full)) return false;
            const read = callTool(server, 'read_grave', args).output as { text?: string } | undefined;
            return (
              typeof read?.text === 'string' &&
              sanitizeText(data.toString('utf8'), { multiline: true }).startsWith(read.text)
            );
          }
          return data.equals(Buffer.from(expected.output));
        });
      }),
      { numRuns: numRuns(30) },
    );
  });
});
