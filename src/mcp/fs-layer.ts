// FileLayer: the only door to the file system for the MCP server.
// It offers no whole-file read or write, no rename, no recursive remove and no copy.
// Tests wrap it to record paths and inject faults (createServer(root, { fs })).

import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  realpathSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import type { BigIntStats } from 'node:fs';
import { DIR_MODE, FILE_MODE } from './limits';

export interface FileStat {
  isFile: boolean;
  isDirectory: boolean;
  isSymlink: boolean;
  size: number;
  dev: bigint;
  ino: bigint;
}

export interface FileLayer {
  /** Throws on error. Does not follow a final symbolic link. */
  lstat(path: string): FileStat;
  /** JS realpath (not the native one). */
  realpath(path: string): string;
  /** O_RDONLY | O_NOFOLLOW | O_NONBLOCK. */
  openRead(path: string): number;
  /** O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW with FILE_MODE. */
  openExclusive(path: string): number;
  fstat(fd: number): FileStat;
  read(fd: number, buf: Uint8Array, offset: number, length: number): number;
  write(fd: number, buf: Uint8Array, offset: number, length: number): number;
  close(fd: number): void;
  /** Non-recursive, DIR_MODE. */
  mkdir(path: string): void;
  unlink(path: string): void;
}

/** True when the platform has a no-follow open flag (false on Windows). */
export const SUPPORTS_NOFOLLOW: boolean = typeof constants.O_NOFOLLOW === 'number';

function toStat(s: BigIntStats): FileStat {
  return {
    isFile: s.isFile(),
    isDirectory: s.isDirectory(),
    isSymlink: s.isSymbolicLink(),
    size: Number(s.size),
    dev: s.dev,
    ino: s.ino,
  };
}

export const nodeFs: FileLayer = {
  lstat: (path) => toStat(lstatSync(path, { bigint: true })),
  realpath: (path) => realpathSync(path),
  openRead: (path) =>
    openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK),
  openExclusive: (path) =>
    openSync(
      path,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
      FILE_MODE,
    ),
  fstat: (fd) => toStat(fstatSync(fd, { bigint: true })),
  read: (fd, buf, offset, length) => readSync(fd, buf, offset, length, null),
  write: (fd, buf, offset, length) => writeSync(fd, buf, offset, length, null),
  close: (fd) => closeSync(fd),
  mkdir: (path) => mkdirSync(path, { mode: DIR_MODE }),
  unlink: (path) => unlinkSync(path),
};

/** The own string `code` of a thrown value (for example "ENOENT"). Never the message. */
export function errnoCode(e: unknown): string | undefined {
  if (typeof e !== 'object' || e === null) return undefined;
  const d = Object.getOwnPropertyDescriptor(e, 'code');
  if (d === undefined) return undefined;
  return typeof d.value === 'string' ? d.value : undefined;
}
