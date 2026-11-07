// Pure scanner for the demo-disk Generator sources (Requirement 1.6, 1.7).
// It holds the forbidden names as string literals, so it must never be scanned itself.
// No Node API, no regular expression over the text.

/** The 14 names of Requirement 1.6, in that order. */
export const FORBIDDEN_NAMES: readonly string[] = [
  'fetch',
  'XMLHttpRequest',
  'WebSocket',
  'node:http',
  'node:https',
  'node:net',
  'node:child_process',
  'eval(',
  'new Function',
  'Date.now',
  'new Date',
  'Math.random',
  'crypto.random',
  'process.env',
];

export interface Violation {
  file: string;
  /** 1-based line number. */
  line: number;
  name: string;
}

/** Names ordered longest first, so the longest match wins at a position. */
const BY_LENGTH_DESC: readonly string[] = [...FORBIDDEN_NAMES].sort((a, b) => b.length - a.length);

/** Longest forbidden name that starts at `index` in `line`, or undefined. */
function matchAt(line: string, index: number): string | undefined {
  for (const name of BY_LENGTH_DESC) {
    if (line.startsWith(name, index)) return name;
  }
  return undefined;
}

/**
 * Scan `text` line by line. At each position the longest forbidden name that
 * starts there is recorded once, and scanning continues after it, so
 * `node:https` yields one violation for `node:https` and none for `node:http`.
 */
export function scanGeneratorSource(file: string, text: string): Violation[] {
  const violations: Violation[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    let pos = 0;
    while (pos < line.length) {
      const name = matchAt(line, pos);
      if (name === undefined) {
        pos += 1;
      } else {
        violations.push({ file, line: i + 1, name });
        pos += name.length;
      }
    }
  }
  return violations;
}
