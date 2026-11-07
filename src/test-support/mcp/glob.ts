// Tiny glob matcher for the hook-glob test (test-only, no dependency).
// Supports `**` (any text, including `/`; `**/` also matches zero directories),
// `*` (any run of characters except `/`) and `?` (one character except `/`).

function matchFrom(p: string, i: number, s: string, j: number): boolean {
  if (i === p.length) return j === s.length;
  if (p.startsWith('**/', i)) {
    if (matchFrom(p, i + 3, s, j)) return true;
    const slash = s.indexOf('/', j);
    return slash >= 0 && matchFrom(p, i, s, slash + 1);
  }
  if (p.startsWith('**', i)) {
    for (let k = j; k <= s.length; k++) {
      if (matchFrom(p, i + 2, s, k)) return true;
    }
    return false;
  }
  const c = p.charAt(i);
  if (c === '*') {
    for (let k = j; k <= s.length; k++) {
      if (matchFrom(p, i + 1, s, k)) return true;
      if (s.charAt(k) === '/') break;
    }
    return false;
  }
  if (j >= s.length) return false;
  if (c === '?') return s.charAt(j) !== '/' && matchFrom(p, i + 1, s, j + 1);
  return c === s.charAt(j) && matchFrom(p, i + 1, s, j + 1);
}

/** True when the whole `path` matches `pattern`. */
export function globMatch(pattern: string, path: string): boolean {
  return matchFrom(pattern, 0, path, 0);
}
