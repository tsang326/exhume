// Test-only: a FileLayer wrapper that presents `realPrefix` also under another spelling
// (`aliasPrefix`), as a case-insensitive or aliased file system would. realpath keeps the
// alias spelling; lstat reports the dev and ino of the matching real path.

import type { FileLayer } from '../../mcp/fs-layer';

function under(path: string, prefix: string): string | undefined {
  if (path === prefix) return '';
  const p = prefix.endsWith('/') ? prefix : `${prefix}/`;
  return path.startsWith(p) ? path.slice(p.length - 1) : undefined;
}

export function aliasFs(base: FileLayer, aliasPrefix: string, realPrefix: string): FileLayer {
  const toReal = (path: string): string => {
    const rest = under(path, aliasPrefix);
    return rest === undefined ? path : realPrefix + rest;
  };
  return {
    ...base,
    lstat: (p) => base.lstat(toReal(p)),
    realpath: (p) => {
      const rest = under(p, aliasPrefix);
      if (rest === undefined) return base.realpath(p);
      const real = base.realpath(realPrefix + rest);
      const tail = under(real, realPrefix);
      // Resolved outside the real prefix (a link): return that real path unchanged.
      return tail === undefined ? real : aliasPrefix + tail;
    },
  };
}
