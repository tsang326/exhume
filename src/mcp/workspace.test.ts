import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeFakeHome } from '../test-support/mcp/fake-home';
import type { FakeHome } from '../test-support/mcp/fake-home';
import { recordingFs } from '../test-support/mcp/recording-fs';
import { nodeFs } from './fs-layer';
import type { FileLayer } from './fs-layer';
import { MAX_ARG_CHARS, MAX_HOME_SEGMENTS } from './limits';
import {
  isAncestorOrSelf,
  omitKey,
  readWorkspaceArg,
  segmentsOf,
  validateWorkspace,
} from './workspace';

let fh: FakeHome;
beforeAll(() => {
  fh = makeFakeHome();
});
afterAll(() => {
  fh.cleanup();
});

const PATH_REJECTED = { ok: false, code: 'PATH_REJECTED' };
const INVALID = { ok: false, code: 'INVALID_ARGUMENTS' };

function validate(arg: string, homedir: () => string = () => fh.home) {
  const rec = recordingFs();
  const result = validateWorkspace(arg, { fs: rec.fs, homedir });
  return { result, calls: rec.calls };
}

describe('segment table (Requirements 5.2, 5.3, 5.4, 5.6, 5.7)', () => {
  it('rejects the filesystem root', () => {
    expect(validate('/').result).toEqual(PATH_REJECTED);
  });

  it('rejects every real ancestor of the home, and the home itself', () => {
    for (const dir of [...fh.ancestors, fh.home]) {
      expect(validate(dir).result).toEqual(PATH_REJECTED);
    }
  });

  it('rejects the parent directory of the temp tree (a "/Users"-like ancestor)', () => {
    const parent = join(fh.ancestors[2] as string, '..');
    expect(validate(parent).result).toEqual(PATH_REJECTED);
  });

  it('accepts a child of the home and returns its realpath', () => {
    expect(validate(fh.child).result).toEqual({ ok: true, value: fh.child });
  });

  it('accepts the sibling "home2" and the string-prefix sibling "hom"', () => {
    for (const s of fh.siblings) {
      expect(validate(s).result).toEqual({ ok: true, value: s });
    }
  });

  it('accepts an outside directory', () => {
    expect(validate(fh.outside).result).toEqual({ ok: true, value: fh.outside });
  });

  it.skipIf(!existsSync('/tmp'))('accepts /tmp when the fake home is elsewhere', () => {
    const r = validate('/tmp').result;
    expect(r.ok).toBe(true);
  });
});

describe('check order (Requirements 5.2, 5.3, 5.5, 7.1)', () => {
  it('step 1: empty and over-long values give INVALID_ARGUMENTS with no file system call', () => {
    for (const arg of ['', '/'.repeat(MAX_ARG_CHARS + 1)]) {
      const { result, calls } = validate(arg);
      expect(result).toEqual(INVALID);
      expect(calls).toHaveLength(0);
    }
  });

  it('step 2: relative paths are rejected without a file system call', () => {
    for (const arg of ['relative/dir', '.', '..', 'C:\\x', ' /abs']) {
      const { result, calls } = validate(arg);
      expect(result).toEqual(PATH_REJECTED);
      expect(calls).toHaveLength(0);
    }
  });

  it('step 3: control characters and NUL are rejected without a file system call', () => {
    for (const ch of ['\u0000', '\u0001', '\n', '\r', '\t', '\u001f', '\u007f', '\u0080', '\u009f']) {
      const { result, calls } = validate(`${fh.child}${ch}`);
      expect(result).toEqual(PATH_REJECTED);
      expect(calls).toHaveLength(0);
    }
  });

  it('step 4: a missing directory is rejected and the home is never asked', () => {
    let asked = 0;
    const { result } = validate(join(fh.child, 'missing'), () => {
      asked += 1;
      return fh.home;
    });
    expect(result).toEqual(PATH_REJECTED);
    expect(asked).toBe(0);
  });

  it('step 5: a regular file is rejected and the home is never asked', () => {
    let asked = 0;
    const { result } = validate(fh.file, () => {
      asked += 1;
      return fh.home;
    });
    expect(result).toEqual(PATH_REJECTED);
    expect(asked).toBe(0);
  });
});

describe('home provider (Requirements 5.8, 5.12)', () => {
  it('a throwing provider rejects', () => {
    const { result } = validate(fh.child, () => {
      throw new Error('no home');
    });
    expect(result).toEqual(PATH_REJECTED);
  });

  it('a relative, empty, NUL-containing or over-long home rejects', () => {
    for (const h of ['home/x', '', `${fh.home}\u0000`, `/${'a'.repeat(MAX_ARG_CHARS)}`]) {
      expect(validate(fh.child, () => h).result).toEqual(PATH_REJECTED);
    }
  });

  it('a non-string home rejects', () => {
    const bad = (() => 42) as unknown as () => string;
    expect(validate(fh.child, bad).result).toEqual(PATH_REJECTED);
  });

  it('a home that does not exist rejects', () => {
    expect(validate(fh.child, () => join(fh.outside, 'no-such-home')).result).toEqual(PATH_REJECTED);
  });
});

describe('identity test and bounds (Requirements 5.9, 7.4)', () => {
  it('a home deeper than MAX_HOME_SEGMENTS rejects', () => {
    const deep = '/' + Array.from({ length: MAX_HOME_SEGMENTS + 1 }, () => 'd').join('/');
    const fs: FileLayer = {
      ...nodeFs,
      realpath: (p) => (p === deep ? deep : nodeFs.realpath(p)),
    };
    const result = validateWorkspace(fh.child, { fs, homedir: () => deep });
    expect(result).toEqual(PATH_REJECTED);
  });

  it('a throwing lstat during the identity walk rejects', () => {
    let n = 0;
    const fs: FileLayer = {
      ...nodeFs,
      lstat: (p) => {
        n += 1;
        if (n > 1) throw new Error('boom');
        return nodeFs.lstat(p);
      },
    };
    expect(validateWorkspace(fh.child, { fs, homedir: () => fh.home })).toEqual(PATH_REJECTED);
  });

  it('uses at most MAX_HOME_SEGMENTS + 4 file layer calls', () => {
    for (const dir of [fh.child, fh.outside, fh.home, '/', fh.siblings[0] as string]) {
      const { calls } = validate(dir);
      expect(calls.length).toBeLessThanOrEqual(MAX_HOME_SEGMENTS + 4);
    }
  });

  it('makes only lstat and realpath calls', () => {
    const { calls } = validate(fh.child);
    for (const c of calls) expect(['lstat', 'realpath']).toContain(c.op);
  });
});

describe('readWorkspaceArg (Requirements 4.5, 7.1)', () => {
  it('accepts 1 and MAX_ARG_CHARS units', () => {
    expect(readWorkspaceArg({ workspace: 'a' })).toEqual({ ok: true, value: 'a' });
    const max = 'a'.repeat(MAX_ARG_CHARS);
    expect(readWorkspaceArg({ workspace: max })).toEqual({ ok: true, value: max });
  });

  it('rejects empty, MAX_ARG_CHARS + 1, number, null, absent', () => {
    expect(readWorkspaceArg({ workspace: '' })).toEqual(INVALID);
    expect(readWorkspaceArg({ workspace: 'a'.repeat(MAX_ARG_CHARS + 1) })).toEqual(INVALID);
    expect(readWorkspaceArg({ workspace: 5 })).toEqual(INVALID);
    expect(readWorkspaceArg({ workspace: null })).toEqual(INVALID);
    expect(readWorkspaceArg({})).toEqual(INVALID);
  });

  it('ignores an inherited workspace property', () => {
    const inherited = Object.create({ workspace: '/x' }) as Record<string, unknown>;
    expect(readWorkspaceArg(inherited)).toEqual(INVALID);
  });
});

describe('omitKey', () => {
  it('drops only the named key', () => {
    expect(omitKey({ workspace: '/x', path: 'p', n: 1 }, 'workspace')).toEqual({ path: 'p', n: 1 });
  });

  it('keeps a __proto__ own key as data and leaves Object.prototype unchanged', () => {
    const args = JSON.parse('{"workspace":"/x","__proto__":{"polluted":true},"a":1}') as Record<
      string,
      unknown
    >;
    const out = omitKey(args, 'workspace');
    expect(Object.keys(out).sort()).toEqual(['__proto__', 'a']);
    expect(Object.getPrototypeOf(out)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect((Object.prototype as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(Object.getOwnPropertyDescriptor(out, '__proto__')?.value).toEqual({ polluted: true });
  });
});

describe('segmentsOf and isAncestorOrSelf', () => {
  it('splits paths and collapses empty segments', () => {
    expect(segmentsOf('/')).toEqual([]);
    expect(segmentsOf('/a//b/')).toEqual(['a', 'b']);
  });

  it('compares element by element, not by string prefix', () => {
    expect(isAncestorOrSelf([], ['a'])).toBe(true);
    expect(isAncestorOrSelf(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(isAncestorOrSelf(['a'], ['a', 'b'])).toBe(true);
    expect(isAncestorOrSelf(['a', 'b'], ['a'])).toBe(false);
    expect(isAncestorOrSelf(['hom'], ['home'])).toBe(false);
    expect(isAncestorOrSelf(['home2'], ['home'])).toBe(false);
  });
});
