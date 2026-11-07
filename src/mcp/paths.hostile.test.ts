import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { numRuns } from '../test-support/runs';
import { recordingFs } from '../test-support/mcp/recording-fs';
import { makeWorkspace } from '../test-support/mcp/workspace';
import type { Workspace } from '../test-support/mcp/workspace';
import { nodeFs } from './fs-layer';
import { loadImage } from './paths';

const A_BYTES = Uint8Array.from([1, 2, 3, 4]);
const B_BYTES = Uint8Array.from([9, 8, 7]);

let ws: Workspace;
// A sibling directory outside the root that symlinks point into.
let outsideDir: string;

beforeAll(() => {
  ws = makeWorkspace();
  outsideDir = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'exhume-mcp-out-')));
  writeFileSync(join(outsideDir, 'secret.img'), Uint8Array.from([66, 66, 66]));
  ws.write('a.img', A_BYTES);
  ws.write('sub/b.img', B_BYTES);
  mkdirSync(join(ws.root, 'dir'));
  ws.symlink('link', 'sub');
  ws.symlink('linkfile', 'a.img');
  ws.symlink('esc', outsideDir);
  ws.symlink('devnull', '/dev/null');
  ws.symlink('dangling', 'nowhere');
  ws.symlink('loop', 'loop');
  symlinkSync(join(ws.root, 'a.img'), join(outsideDir, 'back'));
});

afterAll(() => {
  ws.cleanup();
  rmSync(outsideDir, { recursive: true, force: true });
});

function isInside(root: string, p: string): boolean {
  return p === root || p.startsWith(root + sep);
}

const NAMES = [
  '..', '.', '', 'a.img', 'sub', 'b.img', 'dir', 'link', 'linkfile', 'esc', 'devnull', 'dangling', 'loop', 'secret.img',
  'back', '...', '%2e%2e', '%2e', '%2F', '%2f..%2f', '..\\', '\\', '..\\..\\', 'a.img\\', '\u2025', '\u2024\u2024',
  '\u2215', '\uff0f', '\uff0e\uff0e', '\u2044', '\u29f8', '\u202e', 'a b', 'a'.repeat(255), 'a'.repeat(300), 'x'.repeat(5000),
];
const SEPARATORS = ['/', '//', '///', '\\', '/./', '/../', '/ /'];
const PREFIXES = ['', '/', '//', './', '../', '/etc/', '/dev/null/', '/tmp/', '~/', 'C:\\', '\\\\server\\share\\'];

const nameArb = fc.oneof({ weight: 4, arbitrary: fc.constantFrom(...NAMES) }, { weight: 1, arbitrary: fc.string({ maxLength: 12 }).filter((s) => !s.includes('\0')) });

type Pre = { kind: 'plain'; text: string } | { kind: 'root' } | { kind: 'outside' } | { kind: 'rootUp' };
const prefixArb: fc.Arbitrary<Pre> = fc.oneof(
  fc.constantFrom(...PREFIXES).map((text): Pre => ({ kind: 'plain', text })),
  fc.constant<Pre>({ kind: 'root' }),
  fc.constant<Pre>({ kind: 'outside' }),
  fc.constant<Pre>({ kind: 'rootUp' }),
);

const imageArgArb = fc
  .tuple(prefixArb, fc.array(fc.tuple(nameArb, fc.constantFrom(...SEPARATORS)), { maxLength: 8 }))
  .map(([pre, parts]) => {
    const head =
      pre.kind === 'plain' ? pre.text : pre.kind === 'root' ? ws.root + '/' : pre.kind === 'outside' ? outsideDir + '/' : ws.root + '/../';
    return head + parts.map(([n, s]) => n + s).join('').replace(/\0/g, '');
  });

const ALLOWED = new Set(['PATH_REJECTED', 'IMAGE_NOT_FOUND', 'IMAGE_UNREADABLE']);

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

describe('paths.hostile', () => {
  // Feature: mcp-server, Property 10: Image paths never escape the workspace
  // **Validates: Requirements 6.3, 6.4, 6.11, 6.12, 16.12**
  it('Property 10: hostile image arguments never reach a path outside the root', () => {
    fc.assert(
      fc.property(imageArgArb, (arg) => {
        const { fs, calls } = recordingFs(nodeFs);
        const out = loadImage(fs, ws.root, arg);
        const paths = calls.flatMap((c) => (c.path === undefined ? [] : [c.path]));
        if (!paths.every((p) => isInside(ws.root, p))) return false;
        if (!isInside(ws.root, resolve(ws.root, arg)) && calls.length !== 0) return false;
        if (out.ok) {
          return sameBytes(out.value, A_BYTES) || sameBytes(out.value, B_BYTES);
        }
        return ALLOWED.has(out.code);
      }),
      { numRuns: numRuns(300) },
    );
  });

  it('keeps the workspace tree unchanged', () => {
    const before = ws.tree();
    fc.assert(
      fc.property(imageArgArb, (arg) => {
        loadImage(nodeFs, ws.root, arg);
        return true;
      }),
      { numRuns: numRuns(50) },
    );
    expect(ws.tree()).toEqual(before);
  });

  it('rejects known escapes and accepts the plain files', () => {
    expect(loadImage(nodeFs, ws.root, '../x').ok).toBe(false);
    expect(loadImage(nodeFs, ws.root, join(outsideDir, 'secret.img')).ok).toBe(false);
    expect(loadImage(nodeFs, ws.root, 'esc/secret.img')).toEqual({ ok: false, code: 'PATH_REJECTED' });
    expect(loadImage(nodeFs, ws.root, 'link/b.img')).toEqual({ ok: false, code: 'PATH_REJECTED' });
    const ok = loadImage(nodeFs, ws.root, 'sub//./b.img');
    expect(ok.ok && sameBytes(ok.value, B_BYTES)).toBe(true);
  });
});
