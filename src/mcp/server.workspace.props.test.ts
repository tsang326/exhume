import { existsSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { basename, join, resolve, sep } from 'node:path';
import fc from 'fast-check';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { numRuns } from '../test-support/runs';
import { makeFakeHome } from '../test-support/mcp/fake-home';
import type { FakeHome } from '../test-support/mcp/fake-home';
import { bytesOf, dbfFile, diskWith, pcxFile, wordstarFile } from '../test-support/mcp/images';
import { recordingFs } from '../test-support/mcp/recording-fs';
import { callTool } from '../test-support/mcp/rpc';
import type { ToolCallResult } from '../test-support/mcp/rpc';
import { makeWorkspace } from '../test-support/mcp/workspace';
import type { Workspace } from '../test-support/mcp/workspace';
import { nodeFs } from './fs-layer';
import { MAX_ARG_CHARS } from './limits';
import { createServer, createWorkspaceServer } from './server';
import { segmentsOf } from './workspace';

const TOOLS = ['open_disk', 'read_grave', 'exhume', 'explain_state'] as const;
type Tool = (typeof TOOLS)[number];
const STATES = ['alive', 'recovered', 'partial', 'lost'] as const;

let fake: FakeHome;
let w1: Workspace;
let w2: Workspace;
let outsideDir: Workspace;
let homeSegs: number;
let homeLink: string;
let ancestorLink: string;

function codeOf(r: ToolCallResult): string | undefined {
  if (!r.isError) return undefined;
  const o = r.output;
  if (typeof o === 'object' && o !== null && 'error' in o) return String((o as { error: unknown }).error);
  return undefined;
}

function argsFor(tool: Tool, image: string, path: string, id: number | undefined, state: string): Record<string, unknown> {
  switch (tool) {
    case 'open_disk':
      return { image };
    case 'read_grave':
    case 'exhume':
      return id === undefined ? { image, path } : { image, path, id };
    case 'explain_state':
      return { state };
  }
}

beforeAll(() => {
  fake = makeFakeHome();
  homeSegs = segmentsOf(fake.home).length;
  w1 = makeWorkspace();
  w2 = makeWorkspace();
  outsideDir = makeWorkspace();
  w1.write('disk.img', diskWith([{ name: 'ONE.TXT', content: bytesOf('one\r\n') }]));
  w2.write('disk.img', diskWith([{ name: 'TWO.TXT', content: bytesOf('two\r\n') }]));
  w1.symlink('self', '.');
  // Disks inside the fake home tree: they would load if the workspace were accepted.
  const disk = diskWith([{ name: 'HOME.TXT', content: bytesOf('home\r\n') }]);
  writeFileSync(join(fake.home, 'disk.img'), disk);
  writeFileSync(join(fake.child, 'disk.img'), disk);
  homeLink = join(fake.outside, 'linkhome');
  ancestorLink = join(fake.outside, 'linkanc');
  symlinkSync(fake.home, homeLink);
  symlinkSync(fake.ancestors[0] as string, ancestorLink);
});

afterAll(() => {
  fake.cleanup();
  w1.cleanup();
  w2.cleanup();
  outsideDir.cleanup();
});

describe('server.workspace.props', () => {
  // Feature: power-workspace, Property 5: The workspace argument exists in exactly one mode
  // **Validates: Requirements 4.5, 4.6, 4.7, 8.2**
  it('Property 5: workspace is required in Workspace_Mode and rejected in Default_Mode, with no file access', () => {
    const badWorkspace: fc.Arbitrary<unknown> = fc.oneof(
      fc.constant(5),
      fc.constant(null),
      fc.constant(true),
      fc.constant(''),
      fc.constant(['x']),
      fc.constant({ a: 1 }),
      fc.constant('a'.repeat(MAX_ARG_CHARS + 1)),
    );
    const common = fc.record({
      tool: fc.constantFrom(...TOOLS),
      image: fc.string({ minLength: 1, maxLength: 20 }),
      path: fc.string({ minLength: 1, maxLength: 20 }),
      id: fc.option(fc.nat(5), { nil: undefined }),
      state: fc.constantFrom(...STATES),
    });
    fc.assert(
      fc.property(
        common,
        fc.option(badWorkspace, { nil: undefined }),
        fc.string({ minLength: 1, maxLength: 30 }),
        (c, bad, anyWorkspace) => {
          // Workspace_Mode: absent or wrongly typed/sized workspace.
          const rec = recordingFs(nodeFs);
          const server = createWorkspaceServer({ fs: rec.fs, homedir: () => fake.home });
          const args = argsFor(c.tool, c.image, c.path, c.id, c.state);
          if (bad !== undefined) args.workspace = bad;
          const r = callTool(server, c.tool, args);
          if (codeOf(r) !== 'INVALID_ARGUMENTS' || rec.calls.length !== 0) return false;

          // Default_Mode: any workspace argument is an unknown key.
          const rec2 = recordingFs(nodeFs);
          const def = createServer(w1.root, { fs: rec2.fs });
          const args2 = argsFor(c.tool, 'disk.img', '/ONE.TXT', undefined, 'lost');
          args2.workspace = anyWorkspace;
          const r2 = callTool(def, c.tool, args2);
          return codeOf(r2) === 'INVALID_ARGUMENTS' && rec2.calls.length === 0;
        },
      ),
      { numRuns: numRuns(100) },
    );
  });

  // Feature: power-workspace, Property 2: Unsafe workspace values are rejected before any image or write access
  // **Validates: Requirements 5.1, 5.11, 12.1**
  it('Property 2 (server level): rejected workspaces cause no image read and no write, for all four tools', () => {
    const bases = ['/', fake.home, ...fake.ancestors, homeLink, ancestorLink, fake.file, join(fake.outside, 'missing')];
    const rejectedString = fc
      .tuple(fc.constantFrom(...bases), fc.constantFrom('', '/', '//', '/.', '/./', '/..', '/../' + 'x'))
      .map(([b, s]) => {
        if (s === '/..') return join(b, '..', basename(b));
        return b + s;
      });
    const relative = fc.constantFrom('relative/path', 'disk.img', '.', '..', '~', 'a\u0000b', '/tmp/x\u0001', '/tmp/x\u007f');
    const rejectedAny: fc.Arbitrary<unknown> = fc.oneof(
      { weight: 5, arbitrary: rejectedString },
      { weight: 2, arbitrary: relative },
      { weight: 1, arbitrary: fc.constantFrom<unknown>(5, null, '', ['/'], undefined) },
    );
    // Every base resolves to a Home_Ancestor, the home, a regular file or a missing entry.
    const images = [join(fake.home, 'disk.img'), join(fake.child, 'disk.img'), 'disk.img'];
    fc.assert(
      fc.property(
        rejectedAny,
        fc.constantFrom('open_disk', 'read_grave', 'exhume') as fc.Arbitrary<Tool>,
        fc.constantFrom(...images),
        (workspace, tool, image) => {
          const rec = recordingFs(nodeFs);
          const server = createWorkspaceServer({ fs: rec.fs, homedir: () => fake.home });
          const args = argsFor(tool, image, '/HOME.TXT', undefined, 'lost');
          if (workspace !== undefined) args.workspace = workspace;
          const r = callTool(server, tool, args);
          const code = codeOf(r);
          if (code !== 'PATH_REJECTED' && code !== 'INVALID_ARGUMENTS') return false;
          const forbidden = new Set(['openRead', 'openExclusive', 'read', 'write', 'mkdir', 'unlink', 'fstat', 'close']);
          if (rec.calls.some((c) => forbidden.has(c.op))) return false;
          if (rec.calls.some((c) => c.path !== undefined && basename(c.path) === 'disk.img')) return false;
          return !existsSync(join(fake.home, 'exhumed')) && !existsSync(join(fake.child, 'exhumed'));
        },
      ),
      { numRuns: numRuns(150) },
    );
    // explain_state reads no file whatever the workspace is.
    fc.assert(
      fc.property(rejectedAny.filter((w) => typeof w === 'string'), fc.constantFrom(...STATES), (workspace, state) => {
        const rec = recordingFs(nodeFs);
        const server = createWorkspaceServer({ fs: rec.fs, homedir: () => fake.home });
        callTool(server, 'explain_state', { workspace, state });
        return rec.calls.length === 0;
      }),
      { numRuns: numRuns(30) },
    );
  });

  // Feature: power-workspace, Property 6: Workspace_Mode equals Default_Mode on the same root
  // **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5**
  it('Property 6: Workspace_Mode gives the same results as Default_Mode on the same root', () => {
    const NAMES = ['A.TXT', 'B.WS', 'C.DBF', 'D.PCX', 'E.BIN'] as const;
    const contents = [wordstarFile(), dbfFile(), pcxFile(), bytesOf('plain text\r\n')];
    const fileArb = fc.record({
      name: fc.constantFrom(...NAMES),
      content: fc.constantFrom(...contents),
      deleted: fc.boolean(),
    });
    const disksArb = fc.uniqueArray(fileArb, { maxLength: 4, selector: (f) => f.name });
    const pathArb = fc.oneof(
      fc.constantFrom(...NAMES).map((n) => '/' + n),
      fc.constantFrom(...NAMES).map((n) => '/_' + n.slice(1)),
      fc.string({ minLength: 1, maxLength: 12 }),
    );
    const spellings = [(r: string) => r, (r: string) => r + '/', (r: string) => r + '//.', (r: string) => r + '/self'];
    fc.assert(
      fc.property(
        disksArb,
        fc.constantFrom('open_disk', 'read_grave', 'exhume') as fc.Arbitrary<Tool>,
        pathArb,
        fc.option(fc.nat(3), { nil: undefined }),
        fc.constantFrom(...spellings),
        fc.boolean(),
        (files, tool, path, id, spell, absoluteImage) => {
          w1.write('disk.img', diskWith(files));
          const image = absoluteImage ? join(w1.root, 'disk.img') : 'disk.img';
          const root = realpathSync(w1.root);
          const ws = createWorkspaceServer({ homedir: () => fake.home });
          const def = createServer(root);

          rmSync(join(root, 'exhumed'), { recursive: true, force: true });
          const a = callTool(ws, tool, { ...argsFor(tool, image, path, id, 'lost'), workspace: spell(root) });
          rmSync(join(root, 'exhumed'), { recursive: true, force: true });
          const b = callTool(def, tool, argsFor(tool, image, path, id, 'lost'));
          rmSync(join(root, 'exhumed'), { recursive: true, force: true });
          return a.line !== '' && a.line === b.line;
        },
      ),
      { numRuns: numRuns(25) },
    );

    // explain_state: equal text for every accepted workspace string, and no file access.
    const anyString = fc.oneof(
      fc.string({ minLength: 1, maxLength: 300 }),
      fc.string({ unit: 'binary', minLength: 1, maxLength: 100 }),
      fc.constant('a'.repeat(MAX_ARG_CHARS)),
      fc.constantFrom('/', fake.home, w1.root, 'relative'),
    );
    fc.assert(
      fc.property(anyString, fc.constantFrom(...STATES), (workspace, state) => {
        const rec = recordingFs(nodeFs);
        const ws = createWorkspaceServer({ fs: rec.fs, homedir: () => fake.home });
        const a = callTool(ws, 'explain_state', { workspace, state });
        const b = callTool(createServer(w1.root), 'explain_state', { state });
        return !a.isError && a.line === b.line && rec.calls.length === 0;
      }),
      { numRuns: numRuns(60) },
    );
  });

  // Feature: power-workspace, Property 7: Images are never read from outside the given workspace
  // **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 12.1**
  it('Property 7: hostile image arguments with workspace set never reach a path outside the root', () => {
    const root = w1.root;
    w1.write('sub/b.img', diskWith([{ name: 'SUB.TXT', content: bytesOf('sub\r\n') }]));
    mkdirSync(join(root, 'dir'), { recursive: true });
    w1.symlink('link', 'sub');
    w1.symlink('linkfile', 'disk.img');
    w1.symlink('esc', outsideDir.root);
    w1.symlink('devnull', '/dev/null');
    w1.symlink('dangling', 'nowhere');
    w1.symlink('loop', 'loop');
    outsideDir.write('secret.img', Uint8Array.from([66, 66, 66]));

    const NAMES = [
      '..', '.', '', 'disk.img', 'sub', 'b.img', 'dir', 'link', 'linkfile', 'esc', 'devnull', 'dangling', 'loop',
      'secret.img', '...', '%2e%2e', '..\\', '\\', '\u2025', '\u2215', '\uff0f', 'a b', 'a'.repeat(255), 'x'.repeat(5000),
    ];
    const SEPARATORS = ['/', '//', '///', '\\', '/./', '/../', '/ /'];
    const PREFIXES = ['', '/', '//', './', '../', '/etc/', '/dev/null/', '/tmp/', '~/', 'C:\\'];
    const nameArb = fc.oneof(
      { weight: 4, arbitrary: fc.constantFrom(...NAMES) },
      { weight: 1, arbitrary: fc.string({ maxLength: 12 }) },
    );
    const headArb = fc.oneof(
      fc.constantFrom(...PREFIXES),
      fc.constant(root + '/'),
      fc.constant(outsideDir.root + '/'),
      fc.constant(root + '/../'),
    );
    const imageArb = fc
      .tuple(headArb, fc.array(fc.tuple(nameArb, fc.constantFrom(...SEPARATORS)), { maxLength: 8 }))
      .map(([head, parts]) => head + parts.map(([n, s]) => n + s).join('').replace(/\0/g, ''));

    const inside = (p: string): boolean => p === root || p.startsWith(root + sep);
    const validationCalls = 3 + homeSegs + 1;
    fc.assert(
      fc.property(imageArb, fc.constantFrom('open_disk', 'read_grave') as fc.Arbitrary<Tool>, (image, tool) => {
        const rec = recordingFs(nodeFs);
        const server = createWorkspaceServer({ fs: rec.fs, homedir: () => fake.home });
        const r = callTool(server, tool, { ...argsFor(tool, image, '/ONE.TXT', undefined, 'lost'), workspace: root });
        if (r.line === '' || rec.calls.length < validationCalls) return false;
        const imageCalls = rec.calls.slice(validationCalls);
        const paths = imageCalls.flatMap((c) => (c.path === undefined ? [] : [c.path]));
        if (!paths.every(inside)) return false;
        if (!inside(resolve(root, image)) && imageCalls.length !== 0) return false;
        return true;
      }),
      { numRuns: numRuns(200) },
    );
  });

  // Feature: power-workspace, Property 12: No state is kept between calls
  // **Validates: Requirements 5.1, 8.2, 12.3**
  it('Property 12: each call gives the same answer as on a fresh server', () => {
    const values: unknown[] = [
      w1.root,
      w1.root + '/',
      w2.root,
      join(w1.root, 'self'),
      '/',
      fake.home,
      fake.ancestors[0],
      fake.child,
      fake.file,
      'relative',
      '',
      5,
      null,
      undefined,
      join(fake.outside, 'missing'),
      homeLink,
    ];
    const stepArb = fc.record({
      workspace: fc.constantFrom(...values),
      tool: fc.constantFrom('open_disk', 'read_grave', 'explain_state') as fc.Arbitrary<Tool>,
      path: fc.constantFrom('/ONE.TXT', '/TWO.TXT', '/HOME.TXT'),
      state: fc.constantFrom(...STATES),
    });
    fc.assert(
      fc.property(fc.array(stepArb, { minLength: 1, maxLength: 8 }), (steps) => {
        const long = createWorkspaceServer({ homedir: () => fake.home });
        for (const s of steps) {
          const args = argsFor(s.tool, 'disk.img', s.path, undefined, s.state);
          if (s.workspace !== undefined) args.workspace = s.workspace;
          const a = callTool(long, s.tool, args);
          const b = callTool(createWorkspaceServer({ homedir: () => fake.home }), s.tool, args);
          if (a.line === '' || a.line !== b.line) return false;
        }
        return true;
      }),
      { numRuns: numRuns(60) },
    );
  });
});
