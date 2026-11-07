// Test-only Content-Security-Policy parser and checker.

export interface CspDirective {
  readonly name: string;
  readonly values: readonly string[];
}

export interface CspParse {
  readonly directives: readonly CspDirective[];
  /** Names that appeared more than once (browsers keep the first). */
  readonly duplicates: readonly string[];
}

export interface CspProblem {
  readonly kind:
    | 'missing'
    | 'extra'
    | 'mismatch'
    | 'duplicate'
    | 'unsafe'
    | 'data'
    | 'wildcard'
    | 'remote';
  readonly directive: string;
  readonly message: string;
}

/** The exact directive set from the design ("CSP, Vite output and the network rule"). */
export const EXPECTED_CSP: Readonly<Record<string, readonly string[]>> = {
  'default-src': ["'self'"],
  'script-src': ["'self'"],
  'style-src': ["'self'"],
  'img-src': ["'self'", 'blob:'],
  'connect-src': ["'self'"],
  'worker-src': ["'self'"],
  'object-src': ["'none'"],
  'base-uri': ["'none'"],
  'form-action': ["'none'"],
};

export function parseCsp(content: string): CspParse {
  const directives: CspDirective[] = [];
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const raw of content.split(';')) {
    const tokens = raw.trim().split(/\s+/).filter((t) => t !== '');
    const name = tokens[0]?.toLowerCase();
    if (name === undefined) continue;
    if (seen.has(name)) {
      duplicates.push(name);
      continue;
    }
    seen.add(name);
    directives.push({ name, values: tokens.slice(1) });
  }
  return { directives, duplicates };
}

/** Problems for one source token, or an empty list when it is acceptable. */
function checkSource(directive: string, token: string): CspProblem[] {
  const lower = token.toLowerCase();
  if (lower.startsWith("'")) {
    if (lower.startsWith("'unsafe-")) {
      return [{ kind: 'unsafe', directive, message: `${directive} contains ${token}` }];
    }
    return [];
  }
  if (lower.includes('*')) {
    return [{ kind: 'wildcard', directive, message: `${directive} contains wildcard ${token}` }];
  }
  if (lower === 'data:') {
    return [{ kind: 'data', directive, message: `${directive} allows data:` }];
  }
  if (lower === 'blob:') return [];
  return [{ kind: 'remote', directive, message: `${directive} allows remote source ${token}` }];
}

/**
 * Check a CSP string against the exact expected directive set (default `EXPECTED_CSP`).
 * Value order does not matter. Also rejects `unsafe-*`, `data:`, `*` and remote hosts.
 */
export function checkCsp(
  content: string,
  expected: Readonly<Record<string, readonly string[]>> = EXPECTED_CSP,
): CspProblem[] {
  const problems: CspProblem[] = [];
  const parsed = parseCsp(content);
  for (const d of parsed.duplicates) {
    problems.push({ kind: 'duplicate', directive: d, message: `${d} is declared more than once` });
  }
  const byName = new Map(parsed.directives.map((d) => [d.name, d.values] as const));
  for (const [name, want] of Object.entries(expected)) {
    const got = byName.get(name);
    if (got === undefined) {
      problems.push({ kind: 'missing', directive: name, message: `${name} is missing` });
      continue;
    }
    const a = [...got].map((v) => v.toLowerCase()).sort().join(' ');
    const b = [...want].map((v) => v.toLowerCase()).sort().join(' ');
    if (a !== b) {
      problems.push({
        kind: 'mismatch',
        directive: name,
        message: `${name} is "${got.join(' ')}", expected "${want.join(' ')}"`,
      });
    }
  }
  for (const d of parsed.directives) {
    if (!(d.name in expected)) {
      problems.push({ kind: 'extra', directive: d.name, message: `${d.name} is not in the expected set` });
    }
    for (const token of d.values) problems.push(...checkSource(d.name, token));
  }
  return problems;
}
