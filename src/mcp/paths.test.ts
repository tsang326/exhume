import { mkdirSync, symlinkSync, truncateSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { MAX_IMAGE_BYTES } from '../core/fat12/index';
import { parseOpenDisk } from './args';
import { nodeFs } from './fs-layer';
import { loadImage, resolveRoot } from './paths';
import { faultyFs, recordingFs } from '../test-support/mcp/recording-fs';
import { makeWorkspace } from '../test-support/mcp/workspace';
import type { Workspace } from '../test-support/mcp/workspace';

// Feature: mcp-server, examples for path confinement
// **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.13, 16.4, 16.12**

const workspaces: Workspace[] = [];

function ws(): Workspace {
  const w = makeWorkspace();
  workspaces.push(w);
  return w;
}

afterEach(() => {
  for (const w of workspaces.splice(0)) w.cleanup();
});

const BYTES = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

function reject(code: string): { ok: false; code: string } {
  return { ok: false, code };
}

describe('loadImage: lexical confinement', () => {
  it('rejects a .. traversal without any fs call', () => {
    const w = ws();
    const { fs, calls } = recordingFs();
    expect(loadImage(fs, w.root, '../outside.img')).toEqual(reject('PATH_REJECTED'));
    expect(loadImage(fs, w.root, 'a/../../outside.img')).toEqual(reject('PATH_REJECTED'));
    expect(calls).toEqual([]);
  });

  it('rejects an absolute path outside the root without any fs call', () => {
    const w = ws();
    const { fs, calls } = recordingFs();
    expect(loadImage(fs, w.root, '/etc/hosts')).toEqual(reject('PATH_REJECTED'));
    expect(calls).toEqual([]);
  });

  it('rejects a sibling directory that shares a name prefix with the root', () => {
    const w = ws();
    const root = join(w.root, 'root');
    mkdirSync(root);
    w.write('root-evil/x.img', BYTES);
    const { fs, calls } = recordingFs();
    expect(loadImage(fs, root, '../root-evil/x.img')).toEqual(reject('PATH_REJECTED'));
    expect(loadImage(fs, root, join(w.root, 'root-evil', 'x.img'))).toEqual(
      reject('PATH_REJECTED'),
    );
    expect(calls).toEqual([]);
  });

  it('rejects the root itself', () => {
    const w = ws();
    const { fs, calls } = recordingFs();
    expect(loadImage(fs, w.root, '.')).toEqual(reject('PATH_REJECTED'));
    expect(calls).toEqual([]);
  });

  it('has the argument parser reject a NUL byte before any path logic', () => {
    expect(parseOpenDisk({ image: 'a\u0000b.img' })).toEqual({
      ok: false,
      code: 'INVALID_ARGUMENTS',
    });
  });
});

describe('loadImage: reads', () => {
  it('reads a regular file inside the root and closes the descriptor', () => {
    const w = ws();
    w.write('sub/ok.img', BYTES);
    const { fs, calls } = recordingFs();
    const r = loadImage(fs, w.root, 'sub/ok.img');
    expect(r.ok).toBe(true);
    if (r.ok) expect(Array.from(r.value)).toEqual(Array.from(BYTES));
    expect(calls.filter((c) => c.op === 'openRead')).toHaveLength(1);
    expect(calls.filter((c) => c.op === 'close')).toHaveLength(1);
  });

  it('reports a missing file and a missing middle folder as IMAGE_NOT_FOUND', () => {
    const w = ws();
    expect(loadImage(nodeFs, w.root, 'nope.img')).toEqual(reject('IMAGE_NOT_FOUND'));
    expect(loadImage(nodeFs, w.root, 'nodir/nope.img')).toEqual(reject('IMAGE_NOT_FOUND'));
  });

  it('rejects a directory', () => {
    const w = ws();
    mkdirSync(join(w.root, 'dir'));
    expect(loadImage(nodeFs, w.root, 'dir')).toEqual(reject('PATH_REJECTED'));
  });

  it('rejects a FIFO without opening it', () => {
    const w = ws();
    if (!w.mkfifo('pipe.img')) return;
    const { fs, calls } = recordingFs();
    expect(loadImage(fs, w.root, 'pipe.img')).toEqual(reject('PATH_REJECTED'));
    expect(calls.some((c) => c.op === 'openRead')).toBe(false);
  });

  it('rejects a symlink as the last component', () => {
    const w = ws();
    w.write('real.img', BYTES);
    w.symlink('link.img', 'real.img');
    const { fs, calls } = recordingFs();
    expect(loadImage(fs, w.root, 'link.img')).toEqual(reject('PATH_REJECTED'));
    expect(calls.some((c) => c.op === 'openRead')).toBe(false);
  });

  it('rejects a symlink as a middle component, even one that stays inside the root', () => {
    const w = ws();
    w.write('realdir/a.img', BYTES);
    symlinkSync('realdir', join(w.root, 'linkdir'));
    const { fs, calls } = recordingFs();
    expect(loadImage(fs, w.root, 'linkdir/a.img')).toEqual(reject('PATH_REJECTED'));
    expect(calls.some((c) => c.op === 'openRead')).toBe(false);
  });

  it('rejects a symlink to /dev/null', () => {
    const w = ws();
    w.symlink('null.img', '/dev/null');
    const { fs, calls } = recordingFs();
    expect(loadImage(fs, w.root, 'null.img')).toEqual(reject('PATH_REJECTED'));
    expect(calls.some((c) => c.op === 'openRead')).toBe(false);
  });

  it('rejects a dangling symlink', () => {
    const w = ws();
    w.symlink('dangling.img', 'missing-target');
    expect(loadImage(nodeFs, w.root, 'dangling.img')).toEqual(reject('PATH_REJECTED'));
  });

  it('refuses an image of MAX_IMAGE_BYTES + 1 bytes before any read', () => {
    const w = ws();
    const abs = w.write('big.img', new Uint8Array(0));
    truncateSync(abs, MAX_IMAGE_BYTES + 1);
    const { fs, calls } = recordingFs();
    expect(loadImage(fs, w.root, 'big.img')).toEqual(reject('IMAGE_TOO_LARGE'));
    expect(calls.some((c) => c.op === 'read')).toBe(false);
    expect(calls.filter((c) => c.op === 'close')).toHaveLength(1);
  });

  it('accepts an image of exactly MAX_IMAGE_BYTES bytes', () => {
    const w = ws();
    const abs = w.write('max.img', new Uint8Array(0));
    truncateSync(abs, MAX_IMAGE_BYTES);
    const r = loadImage(nodeFs, w.root, 'max.img');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.length).toBe(MAX_IMAGE_BYTES);
  });

  it('reports a short read as IMAGE_UNREADABLE and still closes', () => {
    const w = ws();
    w.write('short.img', new Uint8Array(1000).fill(7));
    const { fs, calls } = recordingFs(faultyFs(nodeFs, [{ kind: 'shortRead', bytes: 100 }]));
    expect(loadImage(fs, w.root, 'short.img')).toEqual(reject('IMAGE_UNREADABLE'));
    expect(calls.filter((c) => c.op === 'close')).toHaveLength(1);
  });

  it('reports an injected fstat failure as IMAGE_UNREADABLE and closes', () => {
    const w = ws();
    w.write('f.img', BYTES);
    const { fs, calls } = recordingFs(faultyFs(nodeFs, [{ kind: 'throw', op: 'fstat' }]));
    expect(loadImage(fs, w.root, 'f.img')).toEqual(reject('IMAGE_UNREADABLE'));
    expect(calls.filter((c) => c.op === 'close')).toHaveLength(1);
  });
});

describe('loadImage: swap after the lstat walk', () => {
  it('rejects a file swapped for a symlink before the open', () => {
    const w = ws();
    w.write('swap.img', BYTES);
    const fs = faultyFs(nodeFs, [
      { kind: 'swapOnOpen', pathSuffix: 'swap.img', to: 'symlink', target: '/dev/null' },
    ]);
    expect(loadImage(fs, w.root, 'swap.img')).toEqual(reject('PATH_REJECTED'));
  });

  it('rejects a file swapped for a FIFO before the open, without reading', () => {
    const w = ws();
    if (!w.mkfifo('probe.fifo')) return;
    w.write('swap.img', BYTES);
    const { fs, calls } = recordingFs(
      faultyFs(nodeFs, [{ kind: 'swapOnOpen', pathSuffix: 'swap.img', to: 'fifo' }]),
    );
    expect(loadImage(fs, w.root, 'swap.img')).toEqual(reject('PATH_REJECTED'));
    expect(calls.some((c) => c.op === 'read')).toBe(false);
    expect(calls.filter((c) => c.op === 'close')).toHaveLength(1);
  });
});

describe('resolveRoot', () => {
  it('uses the real path of --root', () => {
    const w = ws();
    mkdirSync(join(w.root, 'real'));
    symlinkSync('real', join(w.root, 'alias'));
    expect(resolveRoot(['--root', join(w.root, 'alias')], '/unused', nodeFs)).toEqual({
      ok: true,
      value: join(w.root, 'real'),
    });
  });

  it('uses the working directory when there are no arguments', () => {
    const w = ws();
    expect(resolveRoot([], w.root, nodeFs)).toEqual({ ok: true, value: w.root });
  });

  it('rejects a missing root', () => {
    const w = ws();
    expect(resolveRoot(['--root', join(w.root, 'missing')], w.root, nodeFs)).toEqual(
      reject('INVALID_ARGUMENTS'),
    );
  });

  it('rejects a file as root', () => {
    const w = ws();
    const file = w.write('f.txt', 'x');
    expect(resolveRoot(['--root', file], w.root, nodeFs)).toEqual(reject('INVALID_ARGUMENTS'));
  });

  it('rejects bad arguments', () => {
    const w = ws();
    const bad: string[][] = [
      ['x'],
      ['--root'],
      ['--root', w.root, 'extra'],
      ['--foo', w.root],
      [w.root, '--root'],
    ];
    for (const argv of bad) {
      expect(resolveRoot(argv, w.root, nodeFs)).toEqual(reject('INVALID_ARGUMENTS'));
    }
  });
});
