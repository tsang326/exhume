// Test-only: run the committed bundle (power/server/exhume-mcp.mjs) as a child process over stdio.
// Like runServer in src/mcp/stdio.test.ts, with an optional env. The child is always killed by a timer.

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

export const BUNDLE_PATH = resolve(__dirname, '..', '..', '..', 'power', 'server', 'exhume-mcp.mjs');
export const BUNDLE_TIMEOUT_MS = 10_000;
/** The fixed start-failure line written to standard error. */
export const FIXED_START_FAILURE = 'exhume-mcp: cannot start (invalid arguments or workspace root)\n';

export interface BundleRun {
  stdout: string;
  stderr: string;
  code: number | null;
  timedOut: boolean;
}

/**
 * Spawn the bundle with `args`, write `input` to its stdin, and collect the result.
 * `env` is passed to the child as is (default: empty).
 */
export function runBundle(
  args: readonly string[],
  cwd: string,
  input: string | Uint8Array,
  env: Record<string, string> = {},
): Promise<BundleRun> {
  if (!existsSync(BUNDLE_PATH)) {
    throw new Error('power/server/exhume-mcp.mjs is missing. Run `npm run build:mcp` and commit the result.');
  }
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [BUNDLE_PATH, ...args], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      env,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, BUNDLE_TIMEOUT_MS);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d: string) => {
      stdout += d;
    });
    child.stderr.on('data', (d: string) => {
      stderr += d;
    });
    child.stdin.on('error', () => {
      // the child may exit before reading all input (start failure)
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
