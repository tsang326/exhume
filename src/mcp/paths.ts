// Workspace root and image path confinement (Requirement 6).
// Only the errno code of a thrown error is read; no path or message is kept.

import { resolve } from 'node:path';
import { MAX_IMAGE_BYTES } from '../core/fat12/index';
import type { Outcome } from './errors';
import { errnoCode } from './fs-layer';
import type { FileLayer } from './fs-layer';
import { MAX_ARG_CHARS, MAX_READ_CALLS } from './limits';

const ROOT_FLAG = '--root';
const SEP = '/';

/** Accepts no arguments or exactly `--root <dir>`. The root is the realpath of that directory. */
export function resolveRoot(
  argv: readonly string[],
  cwd: string,
  fs: FileLayer,
): Outcome<string> {
  let dir = cwd;
  if (argv.length === 0) {
    dir = cwd;
  } else if (argv.length === 2 && argv[0] === ROOT_FLAG) {
    dir = argv[1] as string;
  } else {
    return { ok: false, code: 'INVALID_ARGUMENTS' };
  }
  try {
    const root = fs.realpath(dir);
    if (!fs.lstat(root).isDirectory) return { ok: false, code: 'INVALID_ARGUMENTS' };
    return { ok: true, value: root };
  } catch {
    return { ok: false, code: 'INVALID_ARGUMENTS' };
  }
}

function isInside(root: string, candidate: string): boolean {
  if (candidate === root) return true;
  return candidate.startsWith(root === SEP ? SEP : root + SEP);
}

function missing(code: string | undefined): boolean {
  return code === 'ENOENT' || code === 'ENOTDIR';
}

export function loadImage(fs: FileLayer, root: string, imageArg: string): Outcome<Uint8Array> {
  // Steps 1 and 2: lexical resolve and containment, no file system access.
  const candidate = resolve(root, imageArg);
  if (!isInside(root, candidate)) return { ok: false, code: 'PATH_REJECTED' };

  const segments = candidate
    .slice(root.length)
    .split(SEP)
    .filter((s) => s.length > 0);
  if (segments.length === 0 || segments.length > MAX_ARG_CHARS) {
    return { ok: false, code: 'PATH_REJECTED' };
  }

  // Step 3: top-down lstat walk.
  let cur = root;
  for (let i = 0; i < segments.length; i += 1) {
    cur = (cur === SEP ? '' : cur) + SEP + (segments[i] as string);
    let st;
    try {
      st = fs.lstat(cur);
    } catch (e) {
      return { ok: false, code: missing(errnoCode(e)) ? 'IMAGE_NOT_FOUND' : 'IMAGE_UNREADABLE' };
    }
    if (st.isSymlink) return { ok: false, code: 'PATH_REJECTED' };
    if (i === segments.length - 1 && !st.isFile) return { ok: false, code: 'PATH_REJECTED' };
  }

  // Step 4: realpath equality.
  try {
    if (fs.realpath(candidate) !== candidate) return { ok: false, code: 'PATH_REJECTED' };
  } catch (e) {
    return { ok: false, code: missing(errnoCode(e)) ? 'IMAGE_NOT_FOUND' : 'IMAGE_UNREADABLE' };
  }

  // Step 5: no-follow, non-blocking open.
  let fd: number;
  try {
    fd = fs.openRead(candidate);
  } catch (e) {
    const code = errnoCode(e);
    if (code === 'ELOOP') return { ok: false, code: 'PATH_REJECTED' };
    return { ok: false, code: missing(code) ? 'IMAGE_NOT_FOUND' : 'IMAGE_UNREADABLE' };
  }

  try {
    // Step 6: facts from the descriptor.
    const st = fs.fstat(fd);
    if (!st.isFile) return { ok: false, code: 'PATH_REJECTED' };
    if (st.size > MAX_IMAGE_BYTES) return { ok: false, code: 'IMAGE_TOO_LARGE' };

    // Step 7: post-open re-verification.
    if (fs.realpath(candidate) !== candidate) return { ok: false, code: 'PATH_REJECTED' };
    const again = fs.lstat(candidate);
    if (again.isSymlink || again.dev !== st.dev || again.ino !== st.ino) {
      return { ok: false, code: 'PATH_REJECTED' };
    }

    // Step 8: bounded read into a buffer one byte larger than the size.
    const buf = new Uint8Array(st.size + 1);
    let offset = 0;
    for (let calls = 0; calls < MAX_READ_CALLS && offset < buf.length; calls += 1) {
      const n = fs.read(fd, buf, offset, buf.length - offset);
      if (n === 0) break;
      offset += n;
    }
    if (offset !== st.size) return { ok: false, code: 'IMAGE_UNREADABLE' };
    return { ok: true, value: new Uint8Array(buf.buffer, 0, st.size) };
  } catch {
    return { ok: false, code: 'IMAGE_UNREADABLE' };
  } finally {
    try {
      fs.close(fd);
    } catch {
      // The result is already decided.
    }
  }
}
