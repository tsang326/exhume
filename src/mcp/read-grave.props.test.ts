import fc from 'fast-check';
import { afterAll, describe, expect, it } from 'vitest';
import { openDisk } from '../core/fat12/index';
import type { Grave } from '../core/fat12/index';
import { convertAuto } from '../core/formats/index';
import { numRuns } from '../test-support/runs';
import { makeWorkspace } from '../test-support/mcp/workspace';
import { callTool } from '../test-support/mcp/rpc';
import { bytesOf, diskWith, HOSTILE_LONG_NAMES } from '../test-support/mcp/images';
import type { DiskFile } from '../test-support/mcp/images';
import { encodePcx, writeDbf, writeWordStar } from '../test-support/formats/index';
import { MAX_TEXT_CHARS } from './limits';
import { sanitizeCapped, viewPath } from './sanitize';
import { createServer } from './server';

const ws = makeWorkspace();
afterAll(() => ws.cleanup());

interface GraveOut {
  grave?: { id?: number; path?: string };
  format?: string;
  text?: string;
  totalChars?: number;
  truncated?: boolean;
  untrusted?: boolean;
  width?: number;
  height?: number;
  bytes?: number;
  error?: string;
}

const PNG_SIG_LEN = 8;

function readOne(image: string, path: string, id?: number) {
  const server = createServer(ws.root);
  const args: Record<string, unknown> = { image, path };
  if (id !== undefined) args.id = id;
  const res = callTool(server, 'read_grave', args);
  return { ...res, out: (res.output ?? {}) as GraveOut };
}

const wordArb = fc.stringMatching(/^[A-Za-z]{1,10}$/);
const textArb = fc.array(wordArb, { minLength: 1, maxLength: 8 }).map((w) => w.join(' '));

function wordstarFileOf(paras: string[]): Uint8Array {
  return writeWordStar(paras.map((text) => ({ spans: [{ text }] })));
}

function padded(text: string, length: number): Uint8Array {
  const out = new Uint8Array(length).fill(0x20);
  out.set(bytesOf(text).subarray(0, length));
  return out;
}

function dbfFileOf(rows: [string, string][]): Uint8Array {
  return writeDbf({
    fields: [
      { name: 'NAME', type: 'C', length: 10, decimals: 0 },
      { name: 'CITY', type: 'C', length: 10, decimals: 0 },
    ],
    records: rows.map(([a, b]) => ({ deleted: false, values: [padded(a, 10), padded(b, 10)] })),
  });
}

function pcxFileOf(width: number, height: number, seed: number): Uint8Array {
  const indices = new Uint8Array(width * height);
  for (let i = 0; i < indices.length; i += 1) indices[i] = (i + seed) % 2;
  const palette = new Uint8Array(48);
  palette.set([0, 0, 0, 255, 255, 255], 0);
  return encodePcx({ mode: 'mono', width, height, indices, palette });
}

type Fixture = { name: string; bytes: Uint8Array };

const fixtureArb: fc.Arbitrary<Fixture> = fc.oneof(
  fc.array(textArb, { minLength: 1, maxLength: 4 }).map((paras) => ({
    name: 'MEMO.WS',
    bytes: wordstarFileOf(paras),
  })),
  fc
    .array(fc.tuple(wordArb, wordArb), { minLength: 1, maxLength: 5 })
    .map((rows) => ({ name: 'DATA.DBF', bytes: dbfFileOf(rows) })),
  fc
    .record({ w: fc.integer({ min: 1, max: 24 }), h: fc.integer({ min: 1, max: 12 }), seed: fc.nat(255) })
    .map(({ w, h, seed }) => ({ name: 'PIC.PCX', bytes: pcxFileOf(w, h, seed) })),
);

function firstGrave(bytes: Uint8Array): Grave {
  const g = openDisk(bytes).report.files[0];
  if (g === undefined) throw new Error('fixture has no grave');
  return g;
}

describe('read_grave properties', () => {
  // Feature: mcp-server, Property 17: read_grave agrees with convertAuto
  // **Validates: Requirements 8.1, 8.8, 8.9, 8.10, 8.13**
  it('returns what convertAuto returns for stored WordStar, dBase and PCX files', () => {
    fc.assert(
      fc.property(fixtureArb, (fx) => {
        const disk = diskWith([{ name: fx.name, content: fx.bytes }]);
        ws.write('p17.img', disk);
        const grave = firstGrave(disk);
        const expected = convertAuto(fx.bytes, fx.name);
        const r = readOne('p17.img', grave.path);
        if (!expected.ok) return r.isError;
        if (r.isError || r.out.untrusted !== true) return false;
        if (typeof expected.output === 'string') {
          const capped = sanitizeCapped(expected.output, { multiline: true }, MAX_TEXT_CHARS);
          return (
            r.out.text === capped.text &&
            r.out.totalChars === capped.total &&
            r.out.truncated === capped.truncated &&
            r.out.format === (expected.extension === '.csv' ? 'csv' : 'markdown') &&
            !('width' in r.out)
          );
        }
        const png = expected.output;
        const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
        return (
          r.out.format === 'png' &&
          r.out.width === view.getUint32(PNG_SIG_LEN + 8) &&
          r.out.height === view.getUint32(PNG_SIG_LEN + 12) &&
          r.out.bytes === png.length &&
          !('text' in r.out) &&
          !r.line.includes('base64')
        );
      }),
      { numRuns: numRuns(30) },
    );
  });

  const dupArb = fc.record({
    letters: fc.uniqueArray(fc.constantFrom('A', 'B', 'C', 'D', 'E', 'F'), { minLength: 1, maxLength: 4 }),
    alive: fc.boolean(),
    other: fc.boolean(),
    hostile: fc.boolean(),
  });

  // Feature: mcp-server, Property 18: Grave selection follows path and id
  // **Validates: Requirements 8.2, 8.3, 8.4, 8.5, 8.14**
  it('selects by path and id, with no fallback to another grave', () => {
    fc.assert(
      fc.property(dupArb, ({ letters, alive, other, hostile }) => {
        const files: DiskFile[] = [];
        if (alive) files.push({ name: '_EPORT.WS', content: wordstarFileOf(['alive content']) });
        letters.forEach((l, i) =>
          files.push({ name: `${l}EPORT.WS`, content: wordstarFileOf([`deleted content ${i}`]), deleted: true }),
        );
        if (other) files.push({ name: 'OTHER.WS', content: wordstarFileOf(['other content']) });
        if (hostile) {
          // The converter is chosen from the file name, so hostile long names end in .ws.
          [...HOSTILE_LONG_NAMES.map((ln) => ln.replace(/\.txt$/, '.ws')), 'q'.repeat(252) + '.ws'].forEach(
            (ln, i) =>
              files.push({ name: `HOST${i}.WS`, content: wordstarFileOf([`hostile ${i}`]), longName: ln }),
          );
        }
        const disk = diskWith(files);
        ws.write('p18.img', disk);
        const graves = openDisk(disk).report.files;
        const matches = (g: Grave, arg: string) => arg === g.path || arg === viewPath(g.path);
        const firstFor = (arg: string) => graves.findIndex((g) => matches(g, arg));

        for (const g of graves) {
          if (g.kind === 'directory') continue;
          for (const arg of [g.path, viewPath(g.path)]) {
            const byPath = readOne('p18.img', arg);
            const wantFirst = graves[firstFor(arg)];
            if (wantFirst === undefined) return false;
            if (byPath.isError || byPath.out.grave?.id !== wantFirst.id) return false;
            const byId = readOne('p18.img', arg, g.id);
            if (byId.isError || byId.out.grave?.id !== g.id) return false;
          }
        }

        // An id whose grave has another path, or that no grave has, never selects another grave.
        const first = graves.find((g) => g.kind !== 'directory');
        if (first === undefined) return false;
        const wrongId = graves.findIndex((g) => !matches(g, first.path));
        if (wrongId >= 0 && readOne('p18.img', first.path, wrongId).out.error !== 'GRAVE_NOT_FOUND') return false;
        if (readOne('p18.img', first.path, graves.length + 5).out.error !== 'GRAVE_NOT_FOUND') return false;

        // Case, wildcard and prefix differences do not match.
        const lower = first.path.toLowerCase();
        const mismatches = [lower === first.path ? first.path.toUpperCase() : lower, '/*', '/?EPORT.WS', first.path + '*'];
        for (const arg of mismatches) {
          if (graves.some((g) => matches(g, arg))) continue;
          if (readOne('p18.img', arg).out.error !== 'GRAVE_NOT_FOUND') return false;
        }
        return true;
      }),
      { numRuns: numRuns(25) },
    );
  });

  it('keeps the first-match rule on the duplicate-path example', () => {
    const disk = diskWith([
      { name: '_EPORT.WS', content: wordstarFileOf(['alive content']) },
      { name: 'REPORT.WS', content: wordstarFileOf(['deleted content']), deleted: true },
    ]);
    ws.write('dup.img', disk);
    const a = readOne('dup.img', '/_EPORT.WS');
    expect(a.out.grave?.id).toBe(0);
    expect(readOne('dup.img', '/_EPORT.WS', 1).out.grave?.id).toBe(1);
  });
});
