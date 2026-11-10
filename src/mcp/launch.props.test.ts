// Feature: power-workspace, Property 11: Launch arguments are classified by a fixed rule
// **Validates: Requirements 3.1, 3.4, 3.5, 8.3, 8.4, 8.5, 12.8**

import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { numRuns } from '../test-support/runs';
import { nodeFs } from './fs-layer';
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
  // Default_Mode is unchanged: realpath('') is the process working directory, so `--root ""`
  // has always started the server there. The model must agree with that, not with a stricter rule.
  if (path === '') return true;
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
