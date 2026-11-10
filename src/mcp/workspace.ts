// Workspace_Mode validation (Requirements 4.5, 5, 7).
// The agent-supplied `workspace` string is untrusted. Every failure returns a code only;
// no path, argument or system message is kept. No state is held between calls.

import type { Outcome } from './errors';
import type { FileLayer, FileStat } from './fs-layer';
import { CP_C0_MAX, CP_C1_MAX, CP_C1_MIN, CP_DEL, MAX_ARG_CHARS, MAX_HOME_SEGMENTS } from './limits';

import type { BoundCall, ModeStrategy } from './server';
import { WORKSPACE_TOOL_DEFS } from './workspace-defs';

const SEP = '/';

export interface WorkspaceDeps {
  readonly fs: FileLayer;
  /** May throw; the result is untrusted until checked. */
  readonly homedir: () => string;
}

const REJECT: Outcome<never> = { ok: false, code: 'PATH_REJECTED' };
const INVALID: Outcome<never> = { ok: false, code: 'INVALID_ARGUMENTS' };

/** Own-property read of `workspace`. INVALID_ARGUMENTS unless a string of 1..MAX_ARG_CHARS UTF-16 units. */
export function readWorkspaceArg(args: Record<string, unknown>): Outcome<string> {
  const d = Object.getOwnPropertyDescriptor(args, 'workspace');
  if (d === undefined) return INVALID;
  const v: unknown = d.value;
  if (typeof v !== 'string' || v.length < 1 || v.length > MAX_ARG_CHARS) return INVALID;
  return { ok: true, value: v };
}

/** A fresh object with every own enumerable string key of `args` except `key`. */
export function omitKey(args: Record<string, unknown>, key: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(args)) {
    if (k === key) continue;
    const d = Object.getOwnPropertyDescriptor(args, k);
    if (d === undefined) continue;
    Object.defineProperty(out, k, {
      value: d.value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}

/** '/a/b//c' -> ['a','b','c']; '/' -> []. */
export function segmentsOf(absolutePath: string): string[] {
  return absolutePath.split(SEP).filter((s) => s.length > 0);
}

/** True iff `candidate` is a prefix of `of` (equal lists count; the empty list is a prefix of all). */
export function isAncestorOrSelf(candidate: readonly string[], of: readonly string[]): boolean {
  if (candidate.length > of.length) return false;
  for (let i = 0; i < candidate.length; i += 1) {
    if (candidate[i] !== of[i]) return false;
  }
  return true;
}

function hasControl(s: string): boolean {
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    if (c <= CP_C0_MAX || c === CP_DEL || (c >= CP_C1_MIN && c <= CP_C1_MAX)) return true;
  }
  return false;
}

function sameDirectory(a: FileStat, b: FileStat): boolean {
  return a.dev === b.dev && a.ino === b.ino;
}

/** Full validation. Returns the realpath to use as the root for ONE call. */
export function validateWorkspace(arg: string, deps: WorkspaceDeps): Outcome<string> {
  // Step 1: type and length, before any file system access.
  if (typeof arg !== 'string' || arg.length < 1 || arg.length > MAX_ARG_CHARS) return INVALID;
  // Step 2: absolute.
  if (!arg.startsWith(SEP)) return REJECT;
  // Step 3: no control characters.
  if (hasControl(arg)) return REJECT;

  let real: string;
  let st: FileStat;
  try {
    // Step 4: realpath.
    real = deps.fs.realpath(arg);
    // Step 5: must be a directory.
    st = deps.fs.lstat(real);
  } catch {
    return REJECT;
  }
  if (!st.isDirectory) return REJECT;

  let homeReal: string;
  try {
    // Step 6: home lookup. Anything odd means the home is undetermined.
    const h: unknown = deps.homedir();
    if (typeof h !== 'string' || h.length < 1 || h.length > MAX_ARG_CHARS) return REJECT;
    if (!h.startsWith(SEP) || h.includes('\u0000')) return REJECT;
    homeReal = deps.fs.realpath(h);
  } catch {
    return REJECT;
  }

  // Step 7: segment-wise test.
  const ws = segmentsOf(real);
  const home = segmentsOf(homeReal);
  if (isAncestorOrSelf(ws, home)) return REJECT;

  // Step 8: identity test over the chain from '/' down to the home.
  if (home.length > MAX_HOME_SEGMENTS) return REJECT;
  try {
    let cur = SEP;
    for (let i = 0; i <= home.length; i += 1) {
      if (i > 0) cur = (cur === SEP ? '' : cur) + SEP + (home[i - 1] as string);
      if (sameDirectory(deps.fs.lstat(cur), st)) return REJECT;
    }
  } catch {
    return REJECT;
  }

  // Step 9.
  return { ok: true, value: real };
}

/** Workspace_Mode strategy: the root is validated per call and kept nowhere. */
export function createWorkspaceStrategy(deps: WorkspaceDeps): ModeStrategy {
  return {
    tools: WORKSPACE_TOOL_DEFS,
    bind(name: string, args: Record<string, unknown>): Outcome<BoundCall> {
      const arg = readWorkspaceArg(args);
      if (!arg.ok) return arg;
      const rest = omitKey(args, 'workspace');
      // explain_state touches no file: the context is unused.
      if (name === 'explain_state') return { ok: true, value: { ctx: { root: '', fs: deps.fs }, args: rest } };
      const root = validateWorkspace(arg.value, deps);
      if (!root.ok) return root;
      return { ok: true, value: { ctx: { root: root.value, fs: deps.fs }, args: rest } };
    },
  };
}
