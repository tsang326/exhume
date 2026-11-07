// Source scanners for the MCP server (test-only). Each returns one violation
// per match with the file, the 1-based line and the matched name.
import { moduleRefs, parse, lineOf, walk } from '../scan';
import ts from 'typescript';

export interface Violation {
  file: string;
  line: number;
  name: string;
}

// Requirement 1.5. Longer names come first so `node:https` is not also
// reported as `node:http`.
export const FORBIDDEN_NAMES: readonly string[] = [
  'XMLHttpRequest',
  'WebSocket',
  'node:child_process',
  'node:worker_threads',
  'node:https',
  'node:http2',
  'node:http',
  'node:dgram',
  'node:net',
  'node:tls',
  'node:dns',
  'node:vm',
  'new Function',
  'require(',
  'import(',
  'eval(',
  'fetch',
];

// Requirement 1.7
export const STDOUT_NAMES: readonly string[] = [
  'process.stdout',
  'console.log',
  'console.info',
  'console.debug',
];

const ALLOWED_NUMBERS = new Set([0, 1, 2]);
const CORE_INDEXES = ['core/fat12/index', 'core/formats/index'];

function isIdentChar(c: string): boolean {
  return c !== '' && (c === '_' || c === '$' || (c >= '0' && c <= '9') || c.toLowerCase() !== c.toUpperCase());
}

function scanNames(file: string, text: string, names: readonly string[]): Violation[] {
  const out: Violation[] = [];
  const lines = text.split('\n');
  lines.forEach((lineText, idx) => {
    let i = 0;
    while (i < lineText.length) {
      let hit = '';
      for (const name of names) {
        if (!lineText.startsWith(name, i)) continue;
        // A dynamic `import(` call is not part of a longer identifier.
        if (name === 'import(' && isIdentChar(lineText.charAt(i - 1))) continue;
        hit = name;
        break;
      }
      if (hit === '') {
        i += 1;
      } else {
        out.push({ file, line: idx + 1, name: hit });
        i += hit.length;
      }
    }
  });
  return out;
}

/** Requirement 1.5: plain text scan for the forbidden names. */
export function scanForbiddenNames(file: string, text: string): Violation[] {
  return scanNames(file, text, FORBIDDEN_NAMES);
}

/** Requirement 1.7: standard-output writers. */
export function scanStdout(file: string, text: string): Violation[] {
  return scanNames(file, text, STDOUT_NAMES);
}

/** Requirement 12.1: numeric literals other than 0, 1 and 2. */
export function scanNumericLiterals(file: string, text: string): Violation[] {
  const sf = parse(text, file);
  const out: Violation[] = [];
  walk(sf, (n) => {
    if (ts.isNumericLiteral(n)) {
      const value = Number(n.text.replace(/_/g, ''));
      if (!ALLOWED_NUMBERS.has(value)) out.push({ file, line: lineOf(sf, n), name: n.text });
    } else if (ts.isBigIntLiteral(n)) {
      if (n.text !== '0n' && n.text !== '1n' && n.text !== '2n') {
        out.push({ file, line: lineOf(sf, n), name: n.text });
      }
    }
  });
  return out;
}

/** Requirement 12.7: process.exit / kill / chdir and environment reads. */
export function scanProcessCalls(file: string, text: string): Violation[] {
  const sf = parse(text, file);
  const out: Violation[] = [];
  const names = new Set(['exit', 'kill', 'chdir', 'env']);
  walk(sf, (n) => {
    if (
      ts.isPropertyAccessExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === 'process' &&
      names.has(n.name.text)
    ) {
      out.push({ file, line: lineOf(sf, n), name: `process.${n.name.text}` });
    } else if (
      ts.isElementAccessExpression(n) &&
      ts.isIdentifier(n.expression) &&
      n.expression.text === 'process' &&
      ts.isStringLiteralLike(n.argumentExpression) &&
      names.has(n.argumentExpression.text)
    ) {
      out.push({ file, line: lineOf(sf, n), name: `process.${n.argumentExpression.text}` });
    }
  });
  return out;
}

/**
 * Requirements 1.2/1.3: only `node:` built-ins, files inside src/mcp, and the
 * two core index modules may be imported.
 */
export function scanImports(file: string, text: string): Violation[] {
  const sf = parse(text, file);
  const out: Violation[] = [];
  for (const ref of moduleRefs(sf)) {
    const spec = ref.specifier;
    let ok: boolean;
    if (spec.startsWith('node:')) {
      ok = true;
    } else if (spec.startsWith('./') || spec.startsWith('../')) {
      const core = spec.indexOf('core/');
      if (core < 0) {
        ok = true;
      } else {
        const tail = spec.slice(core).replace(/\.ts$/, '');
        ok = CORE_INDEXES.includes(tail);
      }
    } else {
      ok = false;
    }
    if (!ok) out.push({ file, line: ref.line, name: spec });
  }
  return out;
}
