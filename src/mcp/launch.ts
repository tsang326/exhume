// Launch decision: Default_Mode (fixed root) or Workspace_Mode (root given per call).
// Pure apart from the file layer passed to `resolveRoot`; never throws.

import type { Outcome } from './errors';
import type { FileLayer } from './fs-layer';
import { resolveRoot } from './paths';

/** The only argument that selects Workspace_Mode. It must be the sole argument. */
export const WORKSPACE_FLAG = '--workspace-from-agent';

export type LaunchMode = { kind: 'default'; root: string } | { kind: 'workspace' };

export function resolveLaunch(
  argv: readonly string[],
  cwd: string,
  fs: FileLayer,
): Outcome<LaunchMode> {
  try {
    if (argv.length === 1 && argv[0] === WORKSPACE_FLAG) {
      return { ok: true, value: { kind: 'workspace' } };
    }
    if (argv.includes(WORKSPACE_FLAG)) return { ok: false, code: 'INVALID_ARGUMENTS' };
    const root = resolveRoot(argv, cwd, fs);
    if (!root.ok) return root;
    return { ok: true, value: { kind: 'default', root: root.value } };
  } catch {
    return { ok: false, code: 'INVALID_ARGUMENTS' };
  }
}
