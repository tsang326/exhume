import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { makeFakeHome, type FakeHome } from '../test-support/mcp/fake-home';
import { bytesOf, diskWith } from '../test-support/mcp/images';
import { recordingFs } from '../test-support/mcp/recording-fs';
import { callTool, lineOf, rpc } from '../test-support/mcp/rpc';
import { makeWorkspace, type Workspace } from '../test-support/mcp/workspace';
import { ERROR_CODES, MESSAGES } from './errors';
import { MAX_ARG_CHARS } from './limits';
import { createServer, createWorkspaceServer } from './server';
import { WORKSPACE_TOOL_DEFS } from './workspace-defs';

let home: FakeHome;
let ws: Workspace;
let ws2: Workspace;

beforeEach(() => {
  home = makeFakeHome();
  ws = makeWorkspace();
  ws2 = makeWorkspace();
});

afterEach(() => {
  home.cleanup();
  ws.cleanup();
  ws2.cleanup();
});

function disk(): Uint8Array {
  return diskWith([
    { name: 'A.TXT', content: bytesOf('alive file\r\n') },
    { name: 'GONE.TXT', content: bytesOf('deleted file\r\n'), deleted: true },
  ]);
}

function wsServer(fs?: ReturnType<typeof recordingFs>['fs']): ReturnType<typeof createWorkspaceServer> {
  return createWorkspaceServer({ homedir: () => home.home, ...(fs ? { fs } : {}) });
}

function expectFixedFailure(
  res: ReturnType<typeof callTool>,
  code: (typeof ERROR_CODES)[number],
): void {
  expect(res.isError).toBe(true);
  expect(res.output).toEqual({ error: code, message: MESSAGES[code] });
}

describe('Workspace_Mode tools/list', () => {
  it('advertises the four tools, each requiring workspace first', () => {
    const res = rpc(wsServer(), 'tools/list', {}, 1) as { result: { tools: unknown } };
    expect(res.result.tools).toEqual(JSON.parse(JSON.stringify(WORKSPACE_TOOL_DEFS)));
    const tools = res.result.tools as { name: string; inputSchema: { required: string[] } }[];
    expect(tools.map((t) => t.name)).toEqual(['open_disk', 'read_grave', 'exhume', 'explain_state']);
    for (const t of tools) expect(t.inputSchema.required[0]).toBe('workspace');
  });
});

describe('open_disk in Workspace_Mode', () => {
  it('opens a generated image under a valid workspace', () => {
    ws.write('notes.img', disk());
    const res = callTool(wsServer(), 'open_disk', { workspace: ws.root, image: 'notes.img' });
    expect(res.isError).toBe(false);
    expect((res.output as { totalEntries: number }).totalEntries).toBe(2);
  });

  it('resolves image against the validated root; an absolute path inside it works', () => {
    const abs = ws.write('sub/notes.img', disk());
    const server = wsServer();
    const rel = callTool(server, 'open_disk', { workspace: ws.root, image: 'sub/notes.img' });
    const abso = callTool(server, 'open_disk', { workspace: ws.root, image: abs });
    expect(abso.isError).toBe(false);
    expect(abso.output).toEqual(rel.output);
  });

  it('does not find the image of another workspace', () => {
    ws2.write('other.img', disk());
    const res = callTool(wsServer(), 'open_disk', { workspace: ws.root, image: 'other.img' });
    expect(res.isError).toBe(true);
    expect(res.output).not.toEqual(undefined);
  });

  it.each([
    ['missing', undefined],
    ['numeric', 42],
    ['empty', ''],
    ['null', null],
  ])('%s workspace gives INVALID_ARGUMENTS with no FileLayer call', (_label, value) => {
    ws.write('notes.img', disk());
    const { fs, calls } = recordingFs();
    const args: Record<string, unknown> = { image: 'notes.img' };
    if (value !== undefined) args.workspace = value;
    const res = callTool(wsServer(fs), 'open_disk', args);
    expectFixedFailure(res, 'INVALID_ARGUMENTS');
    expect(calls).toEqual([]);
  });

  it('over-long workspace gives INVALID_ARGUMENTS with no FileLayer call', () => {
    const { fs, calls } = recordingFs();
    const res = callTool(wsServer(fs), 'open_disk', {
      workspace: 'a'.repeat(MAX_ARG_CHARS + 1),
      image: 'x.img',
    });
    expectFixedFailure(res, 'INVALID_ARGUMENTS');
    expect(calls).toEqual([]);
  });
});

describe('Default_Mode rejects workspace', () => {
  it('gives INVALID_ARGUMENTS and makes no FileLayer call', () => {
    ws.write('notes.img', disk());
    const { fs, calls } = recordingFs();
    const res = callTool(createServer(ws.root, { fs }), 'open_disk', {
      workspace: ws.root,
      image: 'notes.img',
    });
    expectFixedFailure(res, 'INVALID_ARGUMENTS');
    expect(calls).toEqual([]);
  });
});

describe('explain_state in Workspace_Mode', () => {
  it('requires workspace in the schema, bounded by MAX_ARG_CHARS', () => {
    const def = WORKSPACE_TOOL_DEFS.find((t) => t.name === 'explain_state');
    expect(def?.inputSchema.required).toContain('workspace');
    const prop = (def?.inputSchema.properties as Record<string, Record<string, unknown>>).workspace;
    expect(prop.minLength).toBe(1);
    expect(prop.maxLength).toBe(MAX_ARG_CHARS);
  });

  it('accepts any string of 1..MAX_ARG_CHARS, no file system call, same text', () => {
    const { fs, calls } = recordingFs();
    const server = wsServer(fs);
    const values = ['x', '/', home.home, '../../etc', 'a'.repeat(MAX_ARG_CHARS), '\u0001bad', 'nonexistent/dir'];
    const results = values.map((workspace) => callTool(server, 'explain_state', { workspace, state: 'lost' }));
    for (const r of results) {
      expect(r.isError).toBe(false);
      expect(r.output).toEqual(results[0].output);
    }
    expect(calls).toEqual([]);
  });

  it.each([
    ['number', 7],
    ['null', null],
    ['array', ['x']],
    ['object', {}],
    ['empty', ''],
  ])('fails with a %s workspace', (_label, workspace) => {
    const { fs, calls } = recordingFs();
    const res = callTool(wsServer(fs), 'explain_state', { workspace, state: 'lost' });
    expectFixedFailure(res, 'INVALID_ARGUMENTS');
    expect(calls).toEqual([]);
  });
});

describe('rejected workspace', () => {
  it('returns only the fixed code and text, with no echo of the argument or a path', () => {
    ws.write('notes.img', disk());
    const rejected = [
      '/',
      home.home,
      ...home.ancestors,
      join(ws.root, 'does-not-exist-marker'),
      home.file,
      'relative/marker-dir',
    ];
    const server = wsServer();
    for (const workspace of rejected) {
      const res = callTool(server, 'open_disk', { workspace, image: 'notes.img' });
      expect(res.isError).toBe(true);
      const out = res.output as { error: string; message: string };
      expect(Object.keys(out)).toEqual(['error', 'message']);
      expect(out.message).toBe(MESSAGES[out.error as (typeof ERROR_CODES)[number]]);
      if (workspace.length > 1) expect(res.line).not.toContain(JSON.stringify(workspace).slice(1, -1));
      expect(res.line).not.toContain(home.home);
      expect(res.line).not.toContain(ws.root);
    }
    expectFixedFailure(callTool(server, 'open_disk', { workspace: '/', image: 'notes.img' }), 'PATH_REJECTED');
  });
});

describe('no state between calls', () => {
  it('two workspaces do not influence each other', () => {
    ws.write('one.img', disk());
    ws2.write('two.img', diskWith([{ name: 'B.TXT', content: bytesOf('b\r\n') }]));
    const server = wsServer();
    const a1 = callTool(server, 'open_disk', { workspace: ws.root, image: 'one.img' });
    const b1 = callTool(server, 'open_disk', { workspace: ws2.root, image: 'two.img' });
    const bCross = callTool(server, 'open_disk', { workspace: ws2.root, image: 'one.img' });
    const a2 = callTool(server, 'open_disk', { workspace: ws.root, image: 'one.img' });
    expect(a1.isError).toBe(false);
    expect(b1.isError).toBe(false);
    expect((a1.output as { totalEntries: number }).totalEntries).toBe(2);
    expect((b1.output as { totalEntries: number }).totalEntries).toBe(1);
    expect(bCross.isError).toBe(true);
    expect(a2.output).toEqual(a1.output);
  });

  it('a rejected call does not affect the next valid call', () => {
    ws.write('one.img', disk());
    const server = wsServer();
    const before = callTool(server, 'open_disk', { workspace: ws.root, image: 'one.img' });
    callTool(server, 'open_disk', { workspace: '/', image: 'one.img' });
    const after = callTool(server, 'open_disk', { workspace: ws.root, image: 'one.img' });
    expect(after.output).toEqual(before.output);
  });
});

describe('unknown tool', () => {
  it('gives -32602 without echoing the name', () => {
    const name = 'secret_tool_name_marker';
    const lines = wsServer().handleLine(
      lineOf({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { workspace: ws.root } } }),
    );
    const parsed = JSON.parse(lines[0]) as { error: { code: number } };
    expect(parsed.error.code).toBe(-32602);
    expect(lines[0]).not.toContain(name);
  });
});
