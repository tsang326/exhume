import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { lineOf, parse, walk } from '../test-support/scan';
import {
  FORBIDDEN_NAMES,
  STDOUT_NAMES,
  scanForbiddenNames,
  scanImports,
  scanNumericLiterals,
  scanProcessCalls,
  scanStdout,
  type Violation,
} from '../test-support/mcp/scan';

const MCP_DIR = fileURLToPath(new URL('.', import.meta.url));

function listTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTs(full));
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full);
  }
  return out.sort();
}

const ALL_FILES = listTs(MCP_DIR);
const isTest = (f: string): boolean => f.endsWith('.test.ts');
const SOURCES = ALL_FILES.filter((f) => !isTest(f));
const TESTS = ALL_FILES.filter(isTest);

function rel(file: string): string {
  return relative(MCP_DIR, file).split(sep).join('/');
}

function read(file: string): string {
  return readFileSync(file, 'utf8');
}

function show(vs: Violation[]): string[] {
  return vs.map((v) => `${rel(v.file)}:${v.line} ${v.name}`);
}

function scanAll(files: string[], scan: (file: string, text: string) => Violation[]): string[] {
  return show(files.flatMap((f) => scan(rel(f), read(f)).map((v) => ({ ...v, file: f }))));
}

describe('scan self-tests', () => {
  it('reports one violation per forbidden name, with its line', () => {
    const fixture = FORBIDDEN_NAMES.map((n) => `const a = ${n};`).join('\n');
    const found = scanForbiddenNames('fixture.ts', fixture);
    expect(found.map((v) => v.name)).toEqual([...FORBIDDEN_NAMES]);
    expect(found.map((v) => v.line)).toEqual(FORBIDDEN_NAMES.map((_, i) => i + 1));
    expect(found.every((v) => v.file === 'fixture.ts')).toBe(true);
  });

  it('reports nothing for a clean fixture', () => {
    const clean = "import { join } from 'node:path';\nexport const x = join('a', 'b');\n";
    expect(scanForbiddenNames('clean.ts', clean)).toEqual([]);
    expect(scanStdout('clean.ts', clean)).toEqual([]);
    expect(scanProcessCalls('clean.ts', clean)).toEqual([]);
    expect(scanImports('clean.ts', clean)).toEqual([]);
  });

  it('reports one violation per stdout writer', () => {
    const fixture = STDOUT_NAMES.map((n) => `${n};`).join('\n');
    expect(scanStdout('f.ts', fixture).map((v) => v.name)).toEqual([...STDOUT_NAMES]);
  });

  it('flags numeric literals other than 0, 1 and 2', () => {
    const found = scanNumericLiterals('f.ts', 'const a = 42;\nconst b = 0;\nconst c = 1;\nconst d = 2;\n');
    expect(found).toEqual([{ file: 'f.ts', line: 1, name: '42' }]);
  });

  it('flags process exit, kill, chdir and env', () => {
    const found = scanProcessCalls('f.ts', 'process.exit(1);\nprocess.kill(1);\nprocess.chdir("/");\nconst e = process.env;\n');
    expect(found.map((v) => v.name)).toEqual(['process.exit', 'process.kill', 'process.chdir', 'process.env']);
  });

  it('flags imports outside node: built-ins and the two core indexes', () => {
    const fixture = [
      "import a from 'some-package';",
      "import b from '../core/fat12/disk';",
      "import c from '../../core/fat12/index';",
      "import d from 'node:fs';",
      "import e from './errors';",
    ].join('\n');
    expect(scanImports('f.ts', fixture).map((v) => v.name)).toEqual(['some-package', '../core/fat12/disk']);
  });
});

describe('src/mcp sources', () => {
  it('has source files to scan', () => {
    expect(SOURCES.length).toBeGreaterThan(10);
    expect(SOURCES.map(rel)).toContain('main.ts');
  });

  it('holds none of the forbidden names (Requirement 1.5)', () => {
    expect(scanAll(SOURCES, scanForbiddenNames)).toEqual([]);
  });

  it('writes to standard output only from main.ts (Requirement 1.7)', () => {
    const others = SOURCES.filter((f) => rel(f) !== 'main.ts');
    expect(scanAll(others, scanStdout)).toEqual([]);
  });

  it('holds numeric literals only in limits.ts (Requirement 12.1)', () => {
    const others = SOURCES.filter((f) => rel(f) !== 'limits.ts');
    expect(scanAll(others, scanNumericLiterals)).toEqual([]);
  });

  it('never calls process.exit, kill or chdir and never reads env (Requirement 12.7)', () => {
    expect(scanAll(SOURCES, scanProcessCalls)).toEqual([]);
  });

  it('imports only node: built-ins, local files and the two core indexes (Requirements 1.2, 1.3)', () => {
    expect(scanAll(SOURCES, scanImports)).toEqual([]);
  });

  it('never uses the any keyword (Requirement 1.8)', () => {
    const found: string[] = [];
    for (const f of SOURCES) {
      const sf = parse(read(f), f);
      walk(sf, (n) => {
        if (n.kind === ts.SyntaxKind.AnyKeyword) found.push(`${rel(f)}:${lineOf(sf, n)} any`);
      });
    }
    expect(found).toEqual([]);
  });
});

describe('src/mcp tests', () => {
  it('has test files to scan', () => {
    expect(TESTS.map(rel)).toContain('sources.scan.test.ts');
  });

  it('never calls expect( inside a fast-check property callback (Requirement 16.8)', () => {
    const found: string[] = [];
    for (const f of TESTS) {
      const sf = parse(read(f), f);
      walk(sf, (n) => {
        if (!ts.isCallExpression(n) || !ts.isPropertyAccessExpression(n.expression)) return;
        const name = n.expression.name.text;
        if (name !== 'property' && name !== 'asyncProperty') return;
        for (const arg of n.arguments) {
          if (!ts.isArrowFunction(arg) && !ts.isFunctionExpression(arg)) continue;
          const visit = (c: ts.Node): void => {
            if (ts.isCallExpression(c) && ts.isIdentifier(c.expression) && c.expression.text === 'expect') {
              found.push(`${rel(f)}:${lineOf(sf, c)} expect(`);
            }
            ts.forEachChild(c, visit);
          };
          visit(arg);
        }
      });
    }
    expect(found).toEqual([]);
  });
});
