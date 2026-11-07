// Drives the committed build (power/server/exhume-mcp.mjs) as a child process over stdio.
// Temp workspace under os.tmpdir() only; every child is killed by a timer so the test cannot hang.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { diskWith, bytesOf } from '../test-support/mcp/images';
import { makeWorkspace } from '../test-support/mcp/workspace';
import type { Workspace } from '../test-support/mcp/workspace';
import { MAX_LINE_BYTES } from './limits';

const BUILT_SERVER = resolve(__dirname, '..', '..', 'power', 'server', 'exhume-mcp.mjs');
const TIMEOUT_MS = 10_000;
const FIXED_STDERR = 'exhume-mcp: cannot start (invalid arguments or workspace root)\n';

interface RunResult {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
}

function runServer(args: string[], cwd: string, input: Buffer): Promise<RunResult> {
  if (!existsSync(BUILT_SERVER)) {
    throw new Error('power/server/exhume-mcp.mjs is missing. Run `npm run build:mcp` and commit the result.');
  }
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [BUILT_SERVER, ...args], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {},
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, TIMEOUT_MS);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d: string) => {
      stdout += d;
    });
    child.stderr.on('data', (d: string) => {
      stderr += d;
    });
    child.stdin.on('error', () => {
      // the child may exit before reading all input (case 3)
    });
    child.on('error', (e) => {
      clearTimeout(timer);
      rejectRun(e);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolveRun({ stdout, stderr, code, timedOut });
    });
    child.stdin.end(input);
  });
}

function req(id: number, method: string, params?: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params });
}

function parseLines(stdout: string): unknown[] {
  expect(stdout === '' || stdout.endsWith('\n')).toBe(true);
  return stdout
    .split('\n')
    .slice(0, -1)
    .map((l) => JSON.parse(l) as unknown);
}

function field(v: unknown, key: string): unknown {
  return (v as Record<string, unknown>)[key];
}

describe('built server over stdio', () => {
  let ws: Workspace | undefined;

  afterEach(() => {
    ws?.cleanup();
    ws = undefined;
  });

  function setup(): Workspace {
    const w = makeWorkspace();
    w.write('disk.img', diskWith([{ name: 'NOTES.TXT', content: bytesOf('hello\r\n') }]));
    ws = w;
    return w;
  }

  it('answers a full session in order and survives an oversized line', async () => {
    const w = setup();
    const input = Buffer.concat([
      Buffer.from(
        [
          req(1, 'initialize', {
            protocolVersion: '2025-06-18',
            capabilities: {},
            clientInfo: { name: 't', version: '0' },
          }),
          JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
          req(2, 'tools/list'),
          req(3, 'tools/call', { name: 'open_disk', arguments: { image: 'disk.img' } }),
        ].join('\n') + '\n',
      ),
      Buffer.alloc(MAX_LINE_BYTES + 1, 0x61),
      Buffer.from('\n' + req(5, 'ping') + '\n'),
    ]);
    const r = await runServer([], w.root, input);
    expect(r.timedOut).toBe(false);
    expect(r.stderr).toBe('');
    expect(r.code).toBe(0);
    const msgs = parseLines(r.stdout);
    expect(msgs.map((m) => field(m, 'id'))).toEqual([1, 2, 3, null, 5]);
    expect(field(field(msgs[1], 'result'), 'tools')).toHaveLength(4);
    expect(field(field(msgs[2], 'result'), 'isError')).not.toBe(true);
    const err = field(msgs[3], 'error');
    expect(field(err, 'code')).toBe(-32600);
    expect(field(err, 'message')).toBe('Request too large');
    expect(field(msgs[4], 'result')).toEqual({});
  }, 20_000);

  it('uses --root from another working directory', async () => {
    const w = setup();
    const other = makeWorkspace();
    try {
      const input = Buffer.from(req(1, 'tools/call', { name: 'open_disk', arguments: { image: 'disk.img' } }) + '\n');
      const r = await runServer(['--root', w.root], other.root, input);
      expect(r.timedOut).toBe(false);
      expect(r.stderr).toBe('');
      expect(r.code).toBe(0);
      const msgs = parseLines(r.stdout);
      expect(msgs).toHaveLength(1);
      expect(field(field(msgs[0], 'result'), 'isError')).not.toBe(true);
    } finally {
      other.cleanup();
    }
  });

  it('exits 1 with the fixed stderr line and no stdout for a missing root', async () => {
    const w = setup();
    const missing = join(w.root, 'does-not-exist');
    const r = await runServer(['--root', missing], w.root, Buffer.from(req(1, 'ping') + '\n'));
    expect(r.timedOut).toBe(false);
    expect(r.code).toBe(1);
    expect(r.stdout).toBe('');
    expect(r.stderr).toBe(FIXED_STDERR);
    expect(r.stderr).not.toContain(missing);
  });
});
