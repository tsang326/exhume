// Node shell of the demo-disk generator. The only file that imports node:fs.
// All logic lives in src/demo-disks/cli.ts; this file only supplies real file access.
// Run it through `npm run make:demos` (or `npm run make:demos -- --check`) from the repository root.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { runCli } from '../src/demo-disks/cli';
import type { CliIo } from '../src/demo-disks/cli';

function isMissingFile(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}

const nodeIo: CliIo = {
  readFile(path) {
    try {
      return new Uint8Array(readFileSync(path));
    } catch (error) {
      if (isMissingFile(error)) return undefined;
      throw error;
    }
  },
  writeFile(path, bytes) {
    writeFileSync(path, bytes);
  },
  makeDir(path) {
    mkdirSync(path, { recursive: true });
  },
  out(line) {
    console.log(line);
  },
  err(line) {
    console.error(line);
  },
};

function main(): void {
  const root = process.cwd();
  if (!existsSync(`${root}/package.json`)) {
    console.error('run it from the repository root');
    process.exitCode = 1;
    return;
  }
  process.exitCode = runCli(process.argv.slice(2), nodeIo, root);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : 'unknown error');
  process.exitCode = 1;
}
