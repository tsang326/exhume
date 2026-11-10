// Feature: power-workspace, Property 11: Launch arguments are classified by a fixed rule
// **Validates: Requirements 3.1, 3.4, 3.5, 8.3, 8.4, 8.5, 12.8**

import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { numRuns } from '../test-support/runs';
import { type FileLayer, nodeFs } from './fs-layer';
import { WORKSPACE_FLAG, resolveLaunch } from './launch';

let tmp = '';
let dir = '';
let file = '';

beforeAll(() => {
  tmp = mkdtempSync(join(tmpdir(), 'exhume-launch-props-'));
  dir = join(tmp, 'ws');
  file = join(tmp, 'plain.txt');
  mkdirSync(dir);
  writeFileSync(file, 'x');
});

afterAll(() => {
  if (tmp) rmSync(tmp, { recursive: true, force: true });
});

function isExistingDir(path: string): boolean {
  // An empty or whitespace-only value is a launcher mistake (an unset variable), not a request
  // for the working directory, so the server must refuse to start.
  if (path.trim() === '') return false;
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Reference model of the fixed rule. */
function expected(argv: readonly string[]): 'workspace' | 'default' | 'invalid' {
  if (argv.length === 1 && argv[0] === WORKSPACE_FLAG) return 'workspace';
  if (argv.includes(WORKSPACE_FLAG)) return 'invalid';
  if (argv.length === 0) return 'default';
  if (argv.length === 2 && argv[0] === '--root' && isExistingDir(argv[1] as string)) {
    return 'default';
  }
  return 'invalid';
}

function actual(argv: readonly string[]): 'workspace' | 'default' | 'invalid' {
  const r = resolveLaunch(argv, dir, nodeFs);
  if (!r.ok) return 'invalid';
  return r.value.kind;
}

function token(): fc.Arbitrary<string> {
  return fc.oneof(
    fc.constant('--root'),
    fc.constant(WORKSPACE_FLAG),
    fc.constant(dir),
    fc.constant(file),
    fc.constant(join(tmp, 'missing')),
    fc.constantFrom('', ' ', '\t', '  \n', '\u00a0'),
    fc.string({ maxLength: 20 }),
  );
}

describe('launch classification', () => {
  it('classifies random string lists by the fixed rule', () => {
    fc.assert(
      fc.property(fc.array(fc.string({ maxLength: 30 }), { maxLength: 4 }), (argv) => {
        return actual(argv) === expected(argv);
      }),
      { numRuns: numRuns(100) },
    );
  });

  it('classifies structured lists (flag, --root, directory, repeats, permutations)', () => {
    fc.assert(
      fc.property(fc.array(token(), { maxLength: 5 }), (argv) => {
        return actual(argv) === expected(argv);
      }),
      { numRuns: numRuns(200) },
    );
  });

  it('rejects every list with the flag unless it is exactly [flag]', () => {
    fc.assert(
      fc.property(
        fc.array(token(), { maxLength: 4 }),
        fc.nat({ max: 4 }),
        (others, at) => {
          const argv = [...others];
          argv.splice(Math.min(at, argv.length), 0, WORKSPACE_FLAG);
          const r = resolveLaunch(argv, dir, nodeFs);
          if (argv.length === 1) return r.ok && r.value.kind === 'workspace';
          return !r.ok && r.code === 'INVALID_ARGUMENTS';
        },
      ),
      { numRuns: numRuns(100) },
    );
  });

  it('rejects an empty or whitespace-only --root without touching the file system', () => {
    fc.assert(
      fc.property(
        fc
          .array(fc.constantFrom(' ', '\t', '\n', '\r', '\u00a0', '\u2003', '\ufeff'))
          .map((parts) => parts.join('')),
        (w) => {
          const calls: string[] = [];
          const recordingFs: FileLayer = {
            lstat: (p) => (calls.push('lstat'), nodeFs.lstat(p)),
            realpath: (p) => (calls.push('realpath'), nodeFs.realpath(p)),
            openRead: (p) => (calls.push('openRead'), nodeFs.openRead(p)),
            openExclusive: (p) => (calls.push('openExclusive'), nodeFs.openExclusive(p)),
            fstat: (fd) => (calls.push('fstat'), nodeFs.fstat(fd)),
            read: (fd, b, o, l) => (calls.push('read'), nodeFs.read(fd, b, o, l)),
            write: (fd, b, o, l) => (calls.push('write'), nodeFs.write(fd, b, o, l)),
            close: (fd) => (calls.push('close'), nodeFs.close(fd)),
            mkdir: (p) => (calls.push('mkdir'), nodeFs.mkdir(p)),
            unlink: (p) => (calls.push('unlink'), nodeFs.unlink(p)),
          };
          const r = resolveLaunch(['--root', w], dir, recordingFs);
          return !r.ok && calls.length === 0;
        },
      ),
      { numRuns: numRuns(100) },
    );
  });

  it('accepts [] and [--root, existingDir] as default mode', () => {
    fc.assert(
      fc.property(fc.boolean(), (withRoot) => {
        const r = resolveLaunch(withRoot ? ['--root', dir] : [], dir, nodeFs);
        return r.ok && r.value.kind === 'default';
      }),
      { numRuns: numRuns(10) },
    );
  });
});
