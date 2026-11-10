// Launch decision examples (Requirements 3.1, 3.4, 3.5, 8.3, 8.4, 8.5, 12.8).

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { nodeFs } from './fs-layer';
import { WORKSPACE_FLAG, resolveLaunch } from './launch';
import { recordingFs } from '../test-support/mcp/recording-fs';

const flag = WORKSPACE_FLAG;
const INVALID = { ok: false, code: 'INVALID_ARGUMENTS' };

let tmp = '';
let dir = '';
let cwd = '';

beforeEach(() => {
  tmp = realpathSync(mkdtempSync(join(tmpdir(), 'exhume-launch-')));
  dir = join(tmp, 'ws');
  cwd = join(tmp, 'cwd');
  mkdirSync(dir);
  mkdirSync(cwd);
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('resolveLaunch', () => {
  it('uses the working directory as root for no arguments', () => {
    expect(resolveLaunch([], cwd, nodeFs)).toEqual({
      ok: true,
      value: { kind: 'default', root: cwd },
    });
  });

  it('uses --root dir as Default_Mode', () => {
    expect(resolveLaunch(['--root', dir], cwd, nodeFs)).toEqual({
      ok: true,
      value: { kind: 'default', root: dir },
    });
  });

  it('selects Workspace_Mode for the flag alone, with zero file layer calls', () => {
    const { fs, calls } = recordingFs();
    expect(resolveLaunch([flag], cwd, fs)).toEqual({ ok: true, value: { kind: 'workspace' } });
    expect(calls).toEqual([]);
  });

  it.each([
    ['flag twice', [flag, flag]],
    ['flag then --root', [flag, '--root', 'DIR']],
    ['--root then flag', ['--root', 'DIR', flag]],
    ['--root with flag as value', ['--root', flag]],
    ['flag with extra argument', [flag, 'x']],
  ])('rejects %s', (_name, args) => {
    const argv = args.map((a) => (a === 'DIR' ? dir : a));
    expect(resolveLaunch(argv, cwd, nodeFs)).toEqual(INVALID);
  });

  // Bug condition exploration (Item A). Validates: Requirements 1.1, 1.2, 2.1, 2.2
  it.each(['', ' ', '   ', '\t', '\n', '\u00a0', '\u2003', '\ufeff'])(
    'rejects blank --root value %j',
    (v) => {
      expect(resolveLaunch(['--root', v], cwd, nodeFs)).toEqual(INVALID);
    },
  );

  it('keeps flag plus blank --root invalid', () => {
    expect(resolveLaunch([flag, '--root', ''], cwd, nodeFs)).toEqual(INVALID);
  });

  // Preservation (Item A). Validates: Requirements 3.1, 3.2, 3.3
  it('starts in a directory literally named " pad "', () => {
    const padded = join(dir, ' pad ');
    mkdirSync(padded);
    expect(resolveLaunch(['--root', padded], cwd, nodeFs)).toEqual({
      ok: true,
      value: { kind: 'default', root: padded },
    });
  });

  it('does not trim a leading space: " " + dir is rejected', () => {
    expect(resolveLaunch(['--root', ' ' + dir], cwd, nodeFs)).toEqual(INVALID);
  });

  it('rejects a lone stray argument', () => {
    expect(resolveLaunch(['x'], cwd, nodeFs)).toEqual(INVALID);
  });

  it('rejects a missing --root directory', () => {
    expect(resolveLaunch(['--root', join(tmp, 'missing')], cwd, nodeFs)).toEqual(INVALID);
  });

  it('rejects a file as --root', () => {
    const file = join(tmp, 'file.txt');
    writeFileSync(file, 'x');
    expect(resolveLaunch(['--root', file], cwd, nodeFs)).toEqual(INVALID);
  });
});
