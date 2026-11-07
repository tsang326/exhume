// Exhume writer (Requirement 9): safe name rebuild, the Exhumed_Folder and the exclusive-create write.
// The extension comes from the converter. No argument influences the folder or the file name.

import type { Outcome } from './errors';
import { errnoCode } from './fs-layer';
import type { FileLayer, FileStat } from './fs-layer';
import type { Prepared } from './grave-source';
import { MAX_EXHUME_NAME_CHARS, MAX_SUFFIX, MAX_WRITE_CALLS } from './limits';

const EXHUMED_DIR = 'exhumed';
const SLASH = '/';
const DOT = '.';
const DASH = '-';
const UNDERSCORE = '_';
const FALLBACK_BASE = 'grave';

function isSafeChar(ch: string): boolean {
  return (
    (ch >= 'a' && ch <= 'z') ||
    (ch >= 'A' && ch <= 'Z') ||
    (ch >= '0' && ch <= '9') ||
    ch === DOT ||
    ch === UNDERSCORE ||
    ch === DASH
  );
}

/** Pure. The safe base name (no suffix, no extension) for a Grave path. */
export function exhumeBase(gravePath: string, extension: '.md' | '.csv' | '.txt' | '.png'): string {
  let seg = gravePath.slice(gravePath.lastIndexOf(SLASH) + 1);
  const dot = seg.lastIndexOf(DOT);
  if (dot > 0) seg = seg.slice(0, dot);

  let out = '';
  // for...of walks code points; a lone surrogate arrives as one unit and is replaced.
  for (const ch of seg) out += isSafeChar(ch) ? ch : UNDERSCORE;

  let start = 0;
  while (start < out.length && out[start] === DOT) start += 1;
  out = out.slice(start);
  if (out.startsWith(DASH)) out = UNDERSCORE + out.slice(1);
  if (out.length === 0) out = FALLBACK_BASE;

  const budget = MAX_EXHUME_NAME_CHARS - (String(MAX_SUFFIX).length + 1) - extension.length;
  return out.slice(0, budget);
}

/** Pure. Base, then `-n` when n is above 0, then the extension. */
export function exhumeName(base: string, suffix: number, extension: string): string {
  return base + (suffix > 0 ? DASH + String(suffix) : '') + extension;
}

function isRealDirectory(s: FileStat): boolean {
  return s.isDirectory && !s.isSymlink;
}

/** Creates the Exhumed_Folder when missing. Returns its path. */
export function ensureExhumedDir(fs: FileLayer, root: string): Outcome<string> {
  const dir = root + SLASH + EXHUMED_DIR;
  const failed: Outcome<string> = { ok: false, code: 'EXHUME_FAILED' };
  try {
    let st: FileStat | undefined;
    try {
      st = fs.lstat(dir);
    } catch (e) {
      if (errnoCode(e) !== 'ENOENT') return failed;
    }
    if (st === undefined) {
      try {
        fs.mkdir(dir);
      } catch (e) {
        if (errnoCode(e) !== 'EEXIST') return failed;
      }
      st = fs.lstat(dir);
    }
    if (!isRealDirectory(st)) return failed;
    if (fs.realpath(dir) !== dir) return failed;
    return { ok: true, value: dir };
  } catch {
    return failed;
  }
}

function closeQuietly(fs: FileLayer, fd: number): void {
  try {
    fs.close(fd);
  } catch {
    // nothing to do
  }
}

function removeIfCreated(fs: FileLayer, path: string, created: FileStat | undefined): void {
  if (created === undefined) return;
  try {
    const now = fs.lstat(path);
    if (now.dev === created.dev && now.ino === created.ino) fs.unlink(path);
  } catch {
    // nothing to do
  }
}

function writeAll(fs: FileLayer, fd: number, data: Uint8Array): void {
  let offset = 0;
  let calls = 0;
  while (offset < data.length) {
    if (calls >= MAX_WRITE_CALLS) throw new Error('write cap');
    calls += 1;
    const n = fs.write(fd, data, offset, data.length - offset);
    if (!(n > 0)) throw new Error('short write');
    offset += n;
  }
}

export function writeExhumed(
  fs: FileLayer,
  root: string,
  p: Prepared,
): Outcome<{ relPath: string; bytes: number }> {
  const failed: Outcome<{ relPath: string; bytes: number }> = {
    ok: false,
    code: 'EXHUME_FAILED',
  };
  const dirOutcome = ensureExhumedDir(fs, root);
  if (!dirOutcome.ok) return failed;
  const dir = dirOutcome.value;

  const conversion = p.conversion;
  const extension = conversion.extension;
  const base = exhumeBase(p.grave.path, extension);
  const data: Uint8Array =
    typeof conversion.output === 'string' ? Buffer.from(conversion.output, 'utf8') : conversion.output;

  for (let n = 0; n <= MAX_SUFFIX; n += 1) {
    const name = exhumeName(base, n, extension);
    const path = dir + SLASH + name;

    let fd: number;
    try {
      fd = fs.openExclusive(path);
    } catch (e) {
      if (errnoCode(e) === 'EEXIST') continue;
      return failed;
    }

    let created: FileStat | undefined;
    let folderSwapped = false;
    try {
      created = fs.fstat(fd);
      if (fs.realpath(dir) !== dir) {
        folderSwapped = true;
        throw new Error('folder changed');
      }
      writeAll(fs, fd, data);
      fs.close(fd);
      return { ok: true, value: { relPath: EXHUMED_DIR + SLASH + name, bytes: data.length } };
    } catch {
      closeQuietly(fs, fd);
      if (!folderSwapped) removeIfCreated(fs, path, created);
      return failed;
    }
  }
  return failed;
}
