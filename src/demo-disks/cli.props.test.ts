import fc from 'fast-check';
import { describe, it } from 'vitest';
import { numRuns } from '../test-support/runs';
import { runCli, USAGE } from './cli';
import type { CliDeps, CliIo } from './cli';

interface Calls {
  build: number;
  verify: number;
  readFile: number;
  writeFile: number;
  makeDir: number;
  out: string[];
  err: string[];
}

function fakes(): { io: CliIo; deps: CliDeps; calls: Calls } {
  const calls: Calls = { build: 0, verify: 0, readFile: 0, writeFile: 0, makeDir: 0, out: [], err: [] };
  const io: CliIo = {
    readFile: () => {
      calls.readFile++;
      return undefined;
    },
    writeFile: () => {
      calls.writeFile++;
    },
    makeDir: () => {
      calls.makeDir++;
    },
    out: (line) => {
      calls.out.push(line);
    },
    err: (line) => {
      calls.err.push(line);
    },
  };
  const deps: CliDeps = {
    build: () => {
      calls.build++;
      return [];
    },
    verify: () => {
      calls.verify++;
      return [];
    },
  };
  return { io, deps, calls };
}

const unknownArgs = fc
  .array(fc.oneof(fc.string(), fc.constantFrom('--check', '--help', '-c', '', '--CHECK', '--check=1')), { maxLength: 6 })
  .filter((a) => !(a.length === 0 || (a.length === 1 && a[0] === '--check')));

describe('runCli argument handling', () => {
  // Feature: demo-disks, Property 6: Unknown arguments are refused before any work
  // **Validates: Requirements 2.6**
  it('refuses unknown arguments before any work', () => {
    fc.assert(
      fc.property(unknownArgs, (args) => {
        const { io, deps, calls } = fakes();
        const status = runCli(args, io, '/root', deps);
        return (
          status === 1 &&
          calls.build === 0 &&
          calls.verify === 0 &&
          calls.writeFile === 0 &&
          calls.makeDir === 0 &&
          calls.readFile === 0 &&
          calls.err.includes(USAGE)
        );
      }),
      { numRuns: numRuns(100) },
    );
  });
});
