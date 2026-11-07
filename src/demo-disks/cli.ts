// CLI core of the demo-disk generator. Pure: all file access goes through the injected CliIo.
// The Node shell (scripts/make-demo-disks.ts) supplies the real adapter; tests supply a fake.

import { buildAllDemoDisks } from './build';
import type { FreshDisk } from './build';
import { runSharedChecks } from './checks/index';
import type { CheckFailure } from './checks/index';
import { DemoBuildError } from './errors';

export interface CliIo {
  /** Returns undefined only when the file is missing. */
  readFile(path: string): Uint8Array | undefined;
  writeFile(path: string, bytes: Uint8Array): void;
  makeDir(path: string): void;
  out(line: string): void;
  err(line: string): void;
}

export interface CliDeps {
  build(): FreshDisk[];
  verify(disks: FreshDisk[]): CheckFailure[];
}

export const DISKS_DIR = 'public/disks';
export const USAGE = 'usage: make-demo-disks [--check]';

const DEFAULT_DEPS: CliDeps = {
  build: buildAllDemoDisks,
  verify(disks) {
    const failures: CheckFailure[] = [];
    for (const disk of disks) failures.push(...runSharedChecks(disk.spec.id, disk.image));
    return failures;
  },
};

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

export function runCli(
  args: readonly string[],
  io: CliIo,
  root: string,
  deps: CliDeps = DEFAULT_DEPS,
): 0 | 1 {
  const checkMode = args.length === 1 && args[0] === '--check';
  if (!checkMode && args.length !== 0) {
    io.err(USAGE);
    return 1;
  }

  let disks: FreshDisk[];
  try {
    disks = deps.build();
  } catch (error) {
    if (error instanceof DemoBuildError) {
      io.err(`failed to build ${error.diskFile}: ${error.message}`);
    } else {
      io.err(`failed to build: ${messageOf(error)}`);
    }
    return 1;
  }

  const dir = `${root}/${DISKS_DIR}`;

  if (checkMode) {
    let problems = 0;
    for (const disk of disks) {
      const committed = io.readFile(`${dir}/${disk.spec.fileName}`);
      if (committed === undefined) {
        io.err(`missing: ${disk.spec.fileName}`);
        problems++;
      } else if (!sameBytes(committed, disk.image)) {
        io.err(`differs: ${disk.spec.fileName}`);
        problems++;
      }
    }
    if (problems > 0) return 1;
    io.out('all demo disks match');
    return 0;
  }

  const failures = deps.verify(disks);
  if (failures.length > 0) {
    for (const failure of failures) io.err(`check failed: ${failure.check}: ${failure.message}`);
    return 1;
  }

  try {
    io.makeDir(dir);
    for (const disk of disks) {
      io.writeFile(`${dir}/${disk.spec.fileName}`, disk.image);
      io.out(`wrote ${DISKS_DIR}/${disk.spec.fileName}`);
    }
  } catch (error) {
    io.err(`write failed: ${messageOf(error)}`);
    return 1;
  }
  return 0;
}
