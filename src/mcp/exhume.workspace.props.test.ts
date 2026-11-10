import { statSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { makeFakeHome } from '../test-support/mcp/fake-home';
import type { FakeHome } from '../test-support/mcp/fake-home';
import { bytesOf, dbfFile, diskWith, pcxFile, wordstarFile } from '../test-support/mcp/images';
import { callTool } from '../test-support/mcp/rpc';
import { makeWorkspace } from '../test-support/mcp/workspace';
import { numRuns } from '../test-support/runs';
import { createWorkspaceServer } from './server';

const SAFE_NAME = /^[A-Za-z0-9._-]{1,64}$/;

interface Kind {
  file: string;
  ext: string;
  bytes: () => Uint8Array;
}

const KINDS: readonly Kind[] = [
  { file: 'NOTES.WS', ext: '.md', bytes: wordstarFile },
  { file: 'NOTES.DBF', ext: '.csv', bytes: dbfFile },
  { file: 'NOTES.PCX', ext: '.png', bytes: pcxFile },
  { file: 'NOTES.TXT', ext: '.txt', bytes: () => bytesOf('Hello from the grave.\r\n') },
];

type State = 'absent' | 'dir' | 'symlink' | 'file';

let fake: FakeHome;
beforeAll(() => {
  fake = makeFakeHome();
});
afterAll(() => {
  fake.cleanup();
});

describe('exhume in Workspace_Mode properties', () => {
  // Feature: power-workspace, Property 8: Exhume writes only into <workspace>/exhumed/ and never overwrites
  // **Validates: Requirements 6.6, 6.7, 6.8, 6.9, 6.10, 12.4**
  it('creates exactly one new safe file inside exhumed/ and never touches anything else', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...KINDS),
        fc.constantFrom<State>('absent', 'dir', 'dir', 'symlink', 'file'),
        fc.uniqueArray(fc.integer({ min: 0, max: 4 }), { maxLength: 5 }),
        fc.integer({ min: 1, max: 3 }),
        (kind, state, collide, calls) => {
          const w = makeWorkspace();
          const outside = makeWorkspace();
          try {
            w.write('disk.img', diskWith([{ name: kind.file, content: kind.bytes() }], '360K'));
            outside.write('victim.txt', 'precious');
            const nameOf = (n: number) => `NOTES${n > 0 ? `-${n}` : ''}${kind.ext}`;
            if (state === 'dir') {
              for (const n of collide) w.write(`exhumed/${nameOf(n)}`, `planted ${n}`);
              if (collide.length === 0) w.write('exhumed/other.txt', 'other');
            } else if (state === 'symlink') {
              w.symlink('exhumed', outside.root);
            } else if (state === 'file') {
              w.write('exhumed', 'not a directory');
            }
            const outsideBefore = outside.tree();
            const server = createWorkspaceServer({ homedir: () => fake.home });
            let current = w.tree();

            for (let k = 0; k < calls; k += 1) {
              const before = current;
              const r = callTool(server, 'exhume', {
                workspace: w.root,
                image: 'disk.img',
                path: `/${kind.file}`,
              });
              const after = w.tree();
              current = after;
              if (state === 'symlink' || state === 'file') {
                const out = r.output as { error?: string } | undefined;
                if (!r.isError || out?.error !== 'EXHUME_FAILED') return false;
                if (before.join('\n') !== after.join('\n')) return false;
                continue;
              }
              const out = r.output as { path?: string } | undefined;
              if (r.isError || typeof out?.path !== 'string') return false;
              if (!out.path.startsWith('exhumed/')) return false;
              const name = out.path.slice('exhumed/'.length);
              if (!SAFE_NAME.test(name) || !name.endsWith(kind.ext) || name.includes('/')) return false;
              if (!statSync(join(w.root, out.path)).isFile()) return false;
              // Every earlier line is still present (earlier files byte-identical), plus only new ones.
              if (!before.every((l) => after.includes(l))) return false;
              const added = after.filter((l) => !before.includes(l));
              const newFiles = added.filter((l) => l.startsWith(`exhumed/${name} file `));
              const expectedAdded = state === 'absent' && k === 0 ? 2 : 1;
              if (newFiles.length !== 1 || added.length !== expectedAdded) return false;
              if (before.some((l) => l.startsWith(`exhumed/${name} `))) return false;
            }
            return outside.tree().join('\n') === outsideBefore.join('\n');
          } finally {
            w.cleanup();
            outside.cleanup();
          }
        },
      ),
      { numRuns: numRuns(40) },
    );
  });
});
