// Test-only: a fake Home_Directory in a temporary tree. Never touches the real home directory.

import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export interface FakeHome {
  /** The fake Home_Directory (a realpath). */
  home: string;
  /** Real ancestors above home, nearest first (at least two), all realpaths, below the temp base. */
  ancestors: string[];
  /** Siblings of home: `home2` and `hom` (shared string prefix with `home`). */
  siblings: string[];
  /** A project folder below the home. */
  child: string;
  /** A directory outside the home (and not an ancestor of it). */
  outside: string;
  /** A regular file. */
  file: string;
  /** Removes the whole temporary tree. */
  cleanup: () => void;
}

export function makeFakeHome(): FakeHome {
  const base = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'exhume-fakehome-')));
  const a = join(base, 'a');
  const b = join(a, 'b');
  const home = join(b, 'home');
  const home2 = join(b, 'home2');
  const hom = join(b, 'hom');
  const child = join(home, 'project');
  const outside = join(base, 'outside');
  const file = join(base, 'regular.txt');
  for (const dir of [home, home2, hom, child, outside]) mkdirSync(dir, { recursive: true });
  writeFileSync(file, 'plain file');
  return {
    home,
    ancestors: [b, a, base],
    siblings: [home2, hom],
    child,
    outside,
    file,
    cleanup: () => rmSync(base, { recursive: true, force: true }),
  };
}

/**
 * True when `dir` is on a case-insensitive file system. Creates a probe file with a
 * lower-case name, checks its upper-case spelling, and removes it.
 */
export function isCaseInsensitive(dir: string): boolean {
  const name = `exhume-case-probe-${process.pid}-${Date.now()}`;
  const probe = join(dir, name);
  writeFileSync(probe, '');
  try {
    realpathSync(join(dir, name.toUpperCase()));
    return true;
  } catch {
    return false;
  } finally {
    rmSync(probe, { force: true });
  }
}
