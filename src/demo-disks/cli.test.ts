import { describe, expect, it } from 'vitest';
import type { FreshDisk } from './build';
import { runCli, USAGE } from './cli';
import type { CliDeps, CliIo } from './cli';
import { DemoBuildError } from './errors';
import { DEMO_DISK_SPECS } from './specs';

const ROOT = '/repo';
const DIR = `${ROOT}/public/disks`;

function fakeDisks(): FreshDisk[] {
  return DEMO_DISK_SPECS.map((spec, i) => ({
    spec,
    image: new Uint8Array([i + 1, 2, 3, 4]),
  }));
}

interface Fake {
  io: CliIo;
  files: Map<string, Uint8Array>;
  calls: string[];
  writes: { path: string; bytes: Uint8Array }[];
  out: string[];
  err: string[];
}

function fakeIo(initial: Record<string, Uint8Array> = {}, failWrite = false): Fake {
  const files = new Map<string, Uint8Array>(Object.entries(initial));
  const fake: Fake = { io: undefined as unknown as CliIo, files, calls: [], writes: [], out: [], err: [] };
  fake.io = {
    readFile: (path) => files.get(path),
    writeFile: (path, bytes) => {
      fake.calls.push(`write ${path}`);
      if (failWrite) throw new Error('disk full');
      fake.writes.push({ path, bytes });
    },
    makeDir: (path) => {
      fake.calls.push(`mkdir ${path}`);
    },
    out: (line) => {
      fake.out.push(line);
    },
    err: (line) => {
      fake.err.push(line);
    },
  };
  return fake;
}

function deps(overrides: Partial<CliDeps> = {}): CliDeps {
  return { build: fakeDisks, verify: () => [], ...overrides };
}

function committedAll(): Record<string, Uint8Array> {
  const result: Record<string, Uint8Array> = {};
  for (const d of fakeDisks()) result[`${DIR}/${d.spec.fileName}`] = d.image;
  return result;
}

describe('runCli write mode', () => {
  it('creates the folder, then writes exactly the three images in order', () => {
    const fake = isolated();
    expect(runCli([], fake.io, ROOT, deps())).toBe(0);
    const expected = fakeDisks();
    expect(fake.calls[0]).toBe(`mkdir ${DIR}`);
    expect(fake.writes.map((w) => w.path)).toEqual(expected.map((d) => `${DIR}/${d.spec.fileName}`));
    fake.writes.forEach((w, i) => expect(Array.from(w.bytes)).toEqual(Array.from(expected[i]!.image)));
    expect(fake.calls).toHaveLength(4);
  });

  it('writes nothing and reports each failed check when verify fails', () => {
    const fake = isolated();
    const code = runCli(
      [],
      fake.io,
      ROOT,
      deps({ verify: () => [{ check: 'graves', message: 'bad state' }] }),
    );
    expect(code).toBe(1);
    expect(fake.calls).toEqual([]);
    expect(fake.err).toEqual(['check failed: graves: bad state']);
  });

  it('returns 1 when a write fails', () => {
    const fake = fakeIo({}, true);
    expect(runCli([], fake.io, ROOT, deps())).toBe(1);
    expect(fake.err.join('\n')).toContain('disk full');
  });

  for (const failAt of [0, 1, 2]) {
    it(`writes nothing and names the file when disk ${failAt + 1} fails to build`, () => {
      const fake = isolated();
      const file = DEMO_DISK_SPECS[failAt]!.fileName;
      const code = runCli(
        [],
        fake.io,
        ROOT,
        deps({
          build: () => {
            throw new DemoBuildError(file, 'boom');
          },
        }),
      );
      expect(code).toBe(1);
      expect(fake.calls).toEqual([]);
      expect(fake.err).toEqual([`failed to build ${file}: boom`]);
    });
  }
});

describe('runCli --check', () => {
  it('exits 0 and writes nothing when every file matches', () => {
    const fake = fakeIo(committedAll());
    expect(runCli(['--check'], fake.io, ROOT, deps())).toBe(0);
    expect(fake.calls).toEqual([]);
    expect(fake.err).toEqual([]);
  });

  it('reports a differing file', () => {
    const initial = committedAll();
    const second = DEMO_DISK_SPECS[1]!.fileName;
    initial[`${DIR}/${second}`] = new Uint8Array([9, 9]);
    const fake = fakeIo(initial);
    expect(runCli(['--check'], fake.io, ROOT, deps())).toBe(1);
    expect(fake.err).toEqual([`differs: ${second}`]);
    expect(fake.calls).toEqual([]);
  });

  it('reports a missing file', () => {
    const initial = committedAll();
    const third = DEMO_DISK_SPECS[2]!.fileName;
    delete initial[`${DIR}/${third}`];
    const fake = fakeIo(initial);
    expect(runCli(['--check'], fake.io, ROOT, deps())).toBe(1);
    expect(fake.err).toEqual([`missing: ${third}`]);
    expect(fake.calls).toEqual([]);
  });

  it('reports all three when all differ', () => {
    const initial: Record<string, Uint8Array> = {};
    for (const spec of DEMO_DISK_SPECS) initial[`${DIR}/${spec.fileName}`] = new Uint8Array([0]);
    const fake = fakeIo(initial);
    expect(runCli(['--check'], fake.io, ROOT, deps())).toBe(1);
    expect(fake.err).toEqual(DEMO_DISK_SPECS.map((s) => `differs: ${s.fileName}`));
    expect(fake.calls).toEqual([]);
  });

  it('names the disk and writes nothing when the build fails', () => {
    const fake = fakeIo(committedAll());
    const file = DEMO_DISK_SPECS[1]!.fileName;
    const code = runCli(
      ['--check'],
      fake.io,
      ROOT,
      deps({
        build: () => {
          throw new DemoBuildError(file, 'boom');
        },
      }),
    );
    expect(code).toBe(1);
    expect(fake.err).toEqual([`failed to build ${file}: boom`]);
    expect(fake.calls).toEqual([]);
  });
});

describe('runCli arguments', () => {
  it('refuses an unknown argument before any work', () => {
    const fake = isolated();
    let built = false;
    const code = runCli(
      ['--nope'],
      fake.io,
      ROOT,
      deps({
        build: () => {
          built = true;
          return [];
        },
      }),
    );
    expect(code).toBe(1);
    expect(built).toBe(false);
    expect(fake.err).toEqual([USAGE]);
    expect(fake.calls).toEqual([]);
  });
});

function isolated(): Fake {
  return fakeIo();
}
