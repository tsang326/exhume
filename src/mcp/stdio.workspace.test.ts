// Drives the committed build (power/server/exhume-mcp.mjs) in Workspace_Mode over stdio.
// RED until the bundle is rebuilt (task 13.3): the committed bundle predates --workspace-from-agent.
// Also RED until rebuild: the start-failure case "--root with an empty or whitespace-only value" (Item A).
// Temp dirs under os.tmpdir() only; HOME is a fake home so os.homedir() never sees the real one.

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bytesOf, diskWith } from '../test-support/mcp/images';
import { makeFakeHome } from '../test-support/mcp/fake-home';
import type { FakeHome } from '../test-support/mcp/fake-home';
import { FIXED_START_FAILURE, runBundle } from '../test-support/mcp/run-bundle';
import type { BundleRun } from '../test-support/mcp/run-bundle';
import { makeWorkspace } from '../test-support/mcp/workspace';
import type { Workspace } from '../test-support/mcp/workspace';

const FLAG = '--workspace-from-agent';
const INIT = {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 't', version: '0' },
};

function req(id: number, method: string, params?: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params });
}

function call(id: number, name: string, args: unknown): string {
  return req(id, 'tools/call', { name, arguments: args });
}

function lines(...requests: string[]): string {
  return requests.join('\n') + '\n';
}

function parseLines(stdout: string): unknown[] {
  expect(stdout === '' || stdout.endsWith('\n')).toBe(true);
  return stdout
    .split('\n')
    .slice(0, -1)
    .map((l) => JSON.parse(l) as unknown);
}

function field(v: unknown, key: string): unknown {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>)[key] : undefined;
}

/** result.content[0].text parsed as JSON. */
function outputOf(msg: unknown): unknown {
  const content = field(field(msg, 'result'), 'content');
  const text = Array.isArray(content) ? field(content[0], 'text') : undefined;
  return typeof text === 'string' ? (JSON.parse(text) as unknown) : undefined;
}

function isToolError(msg: unknown): boolean {
  return field(field(msg, 'result'), 'isError') === true;
}

describe('built server in Workspace_Mode over stdio', () => {
  let ws: Workspace | undefined;
  let home: FakeHome | undefined;

  afterEach(() => {
    ws?.cleanup();
    home?.cleanup();
    ws = undefined;
    home = undefined;
  });

  function setup(): { w: Workspace; h: FakeHome } {
    const w = makeWorkspace();
    const h = makeFakeHome();
    w.write('disk.img', diskWith([{ name: 'NOTES.TXT', content: bytesOf('hello floppy\r\n') }]));
    ws = w;
    home = h;
    return { w, h };
  }

  function run(w: Workspace, h: FakeHome, input: string, args: string[] = [FLAG]): Promise<BundleRun> {
    return runBundle(args, w.root, input, { HOME: h.home });
  }

  it('lists four tools that all require workspace', async () => {
    const { w, h } = setup();
    const r = await run(w, h, lines(req(1, 'initialize', INIT), req(2, 'tools/list')));
    expect(r.timedOut).toBe(false);
    expect(r.stderr).toBe('');
    expect(r.code).toBe(0);
    const msgs = parseLines(r.stdout);
    const tools = field(field(msgs[1], 'result'), 'tools') as unknown[];
    expect(tools).toHaveLength(4);
    for (const t of tools) {
      const schema = field(t, 'inputSchema');
      const required = field(schema, 'required') as string[];
      expect(required).toContain('workspace');
      expect(field(field(schema, 'properties'), 'workspace')).toBeDefined();
      expect(field(schema, 'additionalProperties')).toBe(false);
    }
  });

  it('opens a disk with workspace and rejects a call without it', async () => {
    const { w, h } = setup();
    const r = await run(
      w,
      h,
      lines(
        call(1, 'open_disk', { workspace: w.root, image: 'disk.img' }),
        call(2, 'open_disk', { image: 'disk.img' }),
      ),
    );
    expect(r.timedOut).toBe(false);
    expect(r.code).toBe(0);
    const msgs = parseLines(r.stdout);
    expect(msgs).toHaveLength(2);
    expect(isToolError(msgs[0])).toBe(false);
    const ok = outputOf(msgs[0]);
    expect(JSON.stringify(ok)).toContain('NOTES.TXT');
    expect(isToolError(msgs[1])).toBe(true);
    expect(field(outputOf(msgs[1]), 'error')).toBe('INVALID_ARGUMENTS');
  });

  it('rejects / and the fake home with PATH_REJECTED', async () => {
    const { w, h } = setup();
    const r = await run(
      w,
      h,
      lines(
        call(1, 'open_disk', { workspace: '/', image: 'disk.img' }),
        call(2, 'open_disk', { workspace: h.home, image: 'disk.img' }),
      ),
    );
    expect(r.timedOut).toBe(false);
    const msgs = parseLines(r.stdout);
    expect(msgs).toHaveLength(2);
    for (const m of msgs) {
      expect(isToolError(m)).toBe(true);
      expect(field(outputOf(m), 'error')).toBe('PATH_REJECTED');
    }
    expect(r.stdout).not.toContain(h.home);
  });

  it('exhume writes one file directly inside <workspace>/exhumed/', async () => {
    const { w, h } = setup();
    const r = await run(w, h, lines(call(1, 'exhume', { workspace: w.root, image: 'disk.img', path: '/NOTES.TXT' })));
    expect(r.timedOut).toBe(false);
    expect(r.code).toBe(0);
    const msgs = parseLines(r.stdout);
    expect(msgs).toHaveLength(1);
    expect(isToolError(msgs[0])).toBe(false);
    const rel = field(outputOf(msgs[0]), 'path');
    expect(typeof rel).toBe('string');
    const dir = join(w.root, 'exhumed');
    const files = readdirSync(dir);
    expect(files).toHaveLength(1);
    expect(rel).toBe(`exhumed/${files[0]}`);
    const file = join(dir, files[0] as string);
    expect(statSync(file).isFile()).toBe(true);
    expect(readFileSync(file, 'utf8')).toContain('hello floppy');
    // nothing else was written in the workspace
    expect(existsSync(join(w.root, 'disk.img'))).toBe(true);
    expect(readdirSync(w.root).sort()).toEqual(['disk.img', 'exhumed']);
  });

  describe('start failures', () => {
    function expectStartFailure(r: BundleRun, secrets: string[]): void {
      expect(r.timedOut).toBe(false);
      expect(r.code).toBe(1);
      expect(r.stdout).toBe('');
      expect(r.stderr).toBe(FIXED_START_FAILURE);
      for (const s of secrets) expect(r.stderr).not.toContain(s);
    }

    it('flag plus --root <dir>, in both orders', async () => {
      const { w, h } = setup();
      expectStartFailure(await run(w, h, req(1, 'ping') + '\n', [FLAG, '--root', w.root]), [w.root]);
      expectStartFailure(await run(w, h, req(1, 'ping') + '\n', ['--root', w.root, FLAG]), [w.root]);
    });

    it('flag twice', async () => {
      const { w, h } = setup();
      expectStartFailure(await run(w, h, req(1, 'ping') + '\n', [FLAG, FLAG]), []);
    });

    it('flag plus an extra argument', async () => {
      const { w, h } = setup();
      expectStartFailure(await run(w, h, req(1, 'ping') + '\n', [FLAG, 'secret-extra-arg']), ['secret-extra-arg']);
    });

    it('--root with an empty or whitespace-only value', async () => {
      const { w, h } = setup();
      for (const value of ['', '   ', '\t']) {
        expectStartFailure(await run(w, h, req(1, 'ping') + '\n', ['--root', value]), []);
      }
    });

    it('argument lists rejected by Requirement 8.5', async () => {
      const { w, h } = setup();
      const bad: string[][] = [
        ['unexpected-arg'],
        ['--root'],
        ['--root', w.root, 'extra-value'],
        ['--root', w.root, '--root', w.root],
        ['--no-such-flag'],
      ];
      for (const args of bad) {
        const r = await run(w, h, req(1, 'ping') + '\n', args);
        expectStartFailure(r, args.filter((a) => !a.startsWith('--')));
      }
    });
  });
});
