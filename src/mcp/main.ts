// Stdio_Transport: the process entry point and the only file that touches process.*.
// Reads standard input, frames lines, hands each to the server, writes one response line per answer.

import { once } from 'node:events';
import { nodeFs, SUPPORTS_NOFOLLOW } from './fs-layer';
import { tooLargeLine } from './jsonrpc';
import { createLineReader } from './line-reader';
import type { LineEvent } from './line-reader';
import { resolveRoot } from './paths';
import { createServer } from './server';
import type { Server } from './server';

const START_FAILURE = 'exhume-mcp: cannot start (invalid arguments or workspace root)';

/** Set when a write to standard output failed; the loop then ends quietly. */
let outputBroken = false;

async function emit(server: Server, ev: LineEvent): Promise<void> {
  let lines: string[];
  try {
    lines = ev.kind === 'overflow' ? [tooLargeLine()] : server.handleLine(ev.bytes);
  } catch {
    return; // handleLine has its own guard; anything left over is swallowed
  }
  for (const line of lines) {
    if (outputBroken) return;
    try {
      if (!process.stdout.write(line + '\n')) await once(process.stdout, 'drain');
    } catch {
      outputBroken = true;
      return;
    }
  }
}

async function main(): Promise<void> {
  const root = SUPPORTS_NOFOLLOW
    ? resolveRoot(process.argv.slice(2), process.cwd(), nodeFs)
    : { ok: false as const };
  if (!root.ok) {
    process.stderr.write(START_FAILURE + '\n');
    process.exitCode = 1;
    return;
  }

  process.stdout.on('error', () => {
    outputBroken = true;
  });

  const server = createServer(root.value);
  const reader = createLineReader();

  try {
    for await (const chunk of process.stdin) {
      const bytes: Uint8Array = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      for (const ev of reader.push(bytes)) await emit(server, ev);
      if (outputBroken) return;
    }
    for (const ev of reader.end()) await emit(server, ev);
  } catch {
    // a stdin read error ends the loop; nothing is written to standard error
  }
}

void main();
