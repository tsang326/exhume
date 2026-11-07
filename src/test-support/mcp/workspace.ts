// Test-only temporary workspace for MCP server tests.
// Always created under the real path of os.tmpdir(); never under the repository.

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

export interface Workspace {
  /** Absolute, realpath'd root. */
  readonly root: string;
  /** Write a file (parent folders are created). Returns the absolute path. */
  write(rel: string, bytes: Uint8Array | string): string;
  /** Create a symbolic link at `rel` pointing to `target` (stored as given). */
  symlink(rel: string, target: string): string;
  /** Create a FIFO at `rel`. Returns false (and creates nothing) when mkfifo is unavailable. */
  mkfifo(rel: string): boolean;
  /** Sorted lines: "<rel> <kind> <size> <sha256>" for every entry, with no times. */
  tree(): string[];
  /** Remove the workspace recursively. Safe to call twice. */
  cleanup(): void;
}

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function walk(root: string, rel: string, out: string[]): void {
  const dir = rel === '' ? root : join(root, rel);
  for (const name of readdirSync(dir)) {
    const childRel = rel === '' ? name : `${rel}/${name}`;
    const abs = join(root, childRel);
    const st = lstatSync(abs);
    if (st.isSymbolicLink()) {
      const target = readlinkSync(abs);
      out.push(`${childRel} symlink ${target.length} ${sha256(target)}`);
    } else if (st.isDirectory()) {
      out.push(`${childRel}/ dir 0 -`);
      walk(root, childRel, out);
    } else if (st.isFile()) {
      const data = readFileSync(abs);
      out.push(`${childRel} file ${data.length} ${sha256(data)}`);
    } else {
      // FIFO, socket, device: never opened (a FIFO read would block).
      out.push(`${childRel} special 0 -`);
    }
  }
}

export function makeWorkspace(): Workspace {
  const root = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'exhume-mcp-')));
  return {
    root,
    write(rel, bytes) {
      const abs = join(root, rel);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, bytes);
      return abs;
    },
    symlink(rel, target) {
      const abs = join(root, rel);
      mkdirSync(dirname(abs), { recursive: true });
      symlinkSync(target, abs);
      return abs;
    },
    mkfifo(rel) {
      const abs = join(root, rel);
      mkdirSync(dirname(abs), { recursive: true });
      try {
        execFileSync('mkfifo', [abs], { stdio: 'ignore' });
        return true;
      } catch {
        return false;
      }
    },
    tree() {
      const out: string[] = [];
      walk(root, '', out);
      return out.sort();
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}
