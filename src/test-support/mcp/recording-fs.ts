// Test-only FileLayer wrappers: record every call, or inject faults.

import { mkdirSync, symlinkSync, unlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname } from 'node:path';
import { nodeFs } from '../../mcp/fs-layer';
import type { FileLayer } from '../../mcp/fs-layer';

export interface RecordedCall {
  op: string;
  path?: string;
}

export function recordingFs(base: FileLayer = nodeFs): { fs: FileLayer; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const fs: FileLayer = {
    lstat: (p) => (calls.push({ op: 'lstat', path: p }), base.lstat(p)),
    realpath: (p) => (calls.push({ op: 'realpath', path: p }), base.realpath(p)),
    openRead: (p) => (calls.push({ op: 'openRead', path: p }), base.openRead(p)),
    openExclusive: (p) => (calls.push({ op: 'openExclusive', path: p }), base.openExclusive(p)),
    fstat: (fd) => (calls.push({ op: 'fstat' }), base.fstat(fd)),
    read: (fd, b, o, l) => (calls.push({ op: 'read' }), base.read(fd, b, o, l)),
    write: (fd, b, o, l) => (calls.push({ op: 'write' }), base.write(fd, b, o, l)),
    close: (fd) => (calls.push({ op: 'close' }), base.close(fd)),
    mkdir: (p) => (calls.push({ op: 'mkdir', path: p }), base.mkdir(p)),
    unlink: (p) => (calls.push({ op: 'unlink', path: p }), base.unlink(p)),
  };
  return { fs, calls };
}

export type FileLayerOp = keyof FileLayer;

export type Fault =
  /** Throw at the named step (the nth call of `op`, 1-based, default 1). */
  | { kind: 'throw'; op: FileLayerOp; nth?: number; error?: unknown }
  /**
   * Just before the first openRead whose path ends with `pathSuffix` (so after
   * the lstat walk), replace that path with a symlink to `target` or a FIFO.
   */
  | { kind: 'swapOnOpen'; pathSuffix: string; to: 'symlink' | 'fifo'; target?: string }
  /** Reads deliver at most `bytes` bytes in total per descriptor, then report end of file. */
  | { kind: 'shortRead'; bytes: number }
  /** Every write throws (default code EIO). */
  | { kind: 'writeFail'; error?: unknown };

function errnoError(code: string): Error {
  return Object.assign(new Error(code), { code });
}

export function faultyFs(base: FileLayer, faults: readonly Fault[]): FileLayer {
  const counts = new Map<string, number>();
  const readTotals = new Map<number, number>();
  const swapped = new Set<number>();

  function step(op: FileLayerOp): void {
    const n = (counts.get(op) ?? 0) + 1;
    counts.set(op, n);
    for (const f of faults) {
      if (f.kind === 'throw' && f.op === op && (f.nth ?? 1) === n) {
        throw f.error ?? errnoError('EIO');
      }
    }
  }

  function swap(path: string): void {
    faults.forEach((f, i) => {
      if (f.kind !== 'swapOnOpen' || swapped.has(i) || !path.endsWith(f.pathSuffix)) return;
      swapped.add(i);
      unlinkSync(path);
      if (f.to === 'symlink') {
        mkdirSync(dirname(path), { recursive: true });
        symlinkSync(f.target ?? '/dev/null', path);
      } else {
        execFileSync('mkfifo', [path], { stdio: 'ignore' });
      }
    });
  }

  return {
    lstat: (p) => (step('lstat'), base.lstat(p)),
    realpath: (p) => (step('realpath'), base.realpath(p)),
    openRead: (p) => (step('openRead'), swap(p), base.openRead(p)),
    openExclusive: (p) => (step('openExclusive'), base.openExclusive(p)),
    fstat: (fd) => (step('fstat'), base.fstat(fd)),
    read: (fd, buf, offset, length) => {
      step('read');
      let allowed = length;
      for (const f of faults) {
        if (f.kind === 'shortRead') {
          allowed = Math.min(allowed, Math.max(0, f.bytes - (readTotals.get(fd) ?? 0)));
        }
      }
      const got = allowed === 0 ? 0 : base.read(fd, buf, offset, allowed);
      readTotals.set(fd, (readTotals.get(fd) ?? 0) + got);
      return got;
    },
    write: (fd, buf, offset, length) => {
      step('write');
      for (const f of faults) {
        if (f.kind === 'writeFail') throw f.error ?? errnoError('EIO');
      }
      return base.write(fd, buf, offset, length);
    },
    close: (fd) => (step('close'), base.close(fd)),
    mkdir: (p) => (step('mkdir'), base.mkdir(p)),
    unlink: (p) => (step('unlink'), base.unlink(p)),
  };
}
