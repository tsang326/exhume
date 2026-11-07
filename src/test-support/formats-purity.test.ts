// Static purity checks for src/core/formats/ (Requirements 12.1, 12.2, 12.4,
// 12.6, 12.8, 12.9, 14.2, 14.11). Sources are parsed with the TypeScript
// compiler API so comments and string contents never cause false matches.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import * as limits from '../core/formats/limits.ts';
import {
  findAnyKeyword,
  findForbiddenGlobals,
  findNodeBuiltinImports,
  findNonRelativeImports,
  findRegExp,
  isRelative,
  lineOf,
  moduleRefs,
  parse,
  walk,
  type Finding,
} from './scan.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CORE = join(ROOT, 'src', 'core');
const FORMATS = join(CORE, 'formats');
const TEST_SUPPORT = join(ROOT, 'src', 'test-support');
const FORMATS_SUPPORT = join(TEST_SUPPORT, 'formats');
const LIMITS_FILE = join(FORMATS, 'limits.ts');

const rel = (f: string): string => relative(ROOT, f);
const inside = (file: string, dir: string): boolean => {
  const r = relative(dir, file);
  return r !== '' && !r.startsWith('..') && !r.startsWith('/');
};

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === 'exhumed' || entry.name === 'node_modules') continue;
      out.push(...collectTsFiles(join(dir, entry.name)));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      out.push(join(dir, entry.name));
    }
  }
  return out.sort();
}

const isTestFile = (f: string): boolean => f.endsWith('.test.ts');
const coreSourceFiles = collectTsFiles(CORE).filter((f) => !isTestFile(f));
const formatsSourceFiles = collectTsFiles(FORMATS).filter((f) => !isTestFile(f));
const formatsTestFiles = [
  ...collectTsFiles(FORMATS).filter(isTestFile),
  ...collectTsFiles(FORMATS_SUPPORT).filter(isTestFile),
];

const cache = new Map<string, ts.SourceFile>();
function parsed(file: string): ts.SourceFile {
  let sf = cache.get(file);
  if (!sf) {
    sf = parse(readFileSync(file, 'utf8'), file);
    cache.set(file, sf);
  }
  return sf;
}

function scan(files: string[], scanner: (sf: ts.SourceFile) => Finding[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    for (const finding of scanner(parsed(f))) out.push(`${rel(f)}:${finding.line} ${finding.message}`);
  }
  return out;
}

// ------------------------------------------------------------ local scanners

const EXTRA_FORBIDDEN = new Set(['XMLHttpRequest', 'WebSocket', 'createElement']);

/** XMLHttpRequest, WebSocket and createElement, wherever they appear as identifiers. */
function findExtraForbidden(sf: ts.SourceFile): Finding[] {
  const out: Finding[] = [];
  walk(sf, (n) => {
    if (ts.isIdentifier(n) && EXTRA_FORBIDDEN.has(n.text)) {
      out.push({ line: lineOf(sf, n), message: `references forbidden identifier '${n.text}'` });
    }
  });
  return out;
}

function findDynamicImport(sf: ts.SourceFile): Finding[] {
  const out: Finding[] = [];
  walk(sf, (n) => {
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword) {
      out.push({ line: lineOf(sf, n), message: 'uses dynamic import()' });
    }
  });
  return out;
}

/** Imports from outside src/core/formats other than `decodeCp437` from '../fat12'. */
function findDisallowedExternalImports(sf: ts.SourceFile, file: string): Finding[] {
  const out: Finding[] = [];
  walk(sf, (n) => {
    if (
      (ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) &&
      n.moduleSpecifier &&
      ts.isStringLiteralLike(n.moduleSpecifier)
    ) {
      const spec = n.moduleSpecifier.text;
      if (!isRelative(spec)) return; // covered by the non-relative check
      const target = resolve(dirname(file), spec);
      if (target === FORMATS || inside(target, FORMATS)) return;
      let ok = false;
      if (spec === '../fat12' && ts.isImportDeclaration(n)) {
        const b = n.importClause?.namedBindings;
        ok =
          n.importClause !== undefined &&
          n.importClause.name === undefined &&
          b !== undefined &&
          ts.isNamedImports(b) &&
          b.elements.length === 1 &&
          b.elements[0]?.name.text === 'decodeCp437' &&
          b.elements[0]?.propertyName === undefined;
      }
      if (!ok) out.push({ line: lineOf(sf, n), message: `disallowed import '${spec}'` });
    }
  });
  return out;
}

function findTestSupportImports(sf: ts.SourceFile, file: string): Finding[] {
  const out: Finding[] = [];
  for (const r of moduleRefs(sf)) {
    if (!isRelative(r.specifier)) continue;
    const target = resolve(dirname(file), r.specifier);
    if (target === TEST_SUPPORT || inside(target, TEST_SUPPORT)) {
      out.push({ line: r.line, message: `imports test-support '${r.specifier}'` });
    }
  }
  return out;
}

/** Numeric literals (any spelling) whose value is in `values`. */
function findNumericLiterals(
  sf: ts.SourceFile,
  values: ReadonlySet<number>,
  allow: (line: number) => boolean = () => false,
): Finding[] {
  const out: Finding[] = [];
  walk(sf, (n) => {
    if (ts.isNumericLiteral(n)) {
      const value = Number(n.text.replace(/_/g, ''));
      const line = lineOf(sf, n);
      if (values.has(value) && !allow(line)) {
        out.push({ line, message: `duplicates limit value ${n.text} (${value}); define it only in limits.ts` });
      }
    }
  });
  return out;
}

/** `expect(...)` calls (including `expect.soft(...)`) inside fc.property / fc.asyncProperty arguments. */
function findExpectInProperties(sf: ts.SourceFile): Finding[] {
  const out: Finding[] = [];
  const isExpectCall = (n: ts.Node): boolean => {
    if (!ts.isCallExpression(n)) return false;
    const e = n.expression;
    if (ts.isIdentifier(e)) return e.text === 'expect';
    return ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.expression) && e.expression.text === 'expect';
  };
  walk(sf, (n) => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ts.isIdentifier(n.expression.expression) &&
      n.expression.expression.text === 'fc' &&
      (n.expression.name.text === 'property' || n.expression.name.text === 'asyncProperty')
    ) {
      for (const arg of n.arguments) {
        const visit = (c: ts.Node): void => {
          if (isExpectCall(c)) {
            out.push({ line: lineOf(sf, c), message: 'calls expect( inside fc.property' });
          }
          ts.forEachChild(c, visit);
        };
        visit(arg);
      }
    }
  });
  return out;
}

// ------------------------------------------------------------- limit values

/** Numeric values >= 4096 exported by limits.ts, read from the live module (includes MAX_PNG_BYTES). */
const LIMIT_VALUES: ReadonlySet<number> = new Set(
  Object.values(limits).filter((v): v is number => typeof v === 'number' && v >= 4096),
);

/**
 * Explicit allow-list for literals that coincide with a limit value but are not limits.
 * Keys are `<repo-relative file>:<line>`; each needs a justification.
 */
const LIMIT_LITERAL_ALLOW: Readonly<Record<string, string>> = {
  // Adler-32 packs two 16-bit halves; 0xffff is the half-word bit mask, which
  // only coincides with U16_MAX / PNG_STORED_BLOCK_MAX (65,535). It is not a limit.
  'src/core/formats/checksums.ts:63': '16-bit mask for the Adler-32 low half',
  'src/core/formats/checksums.ts:64': '16-bit mask for the Adler-32 high half',
};

// -------------------------------------------------------------------- tests

describe('formats purity scanners (self-test with planted violations)', () => {
  it('finds a planted Node built-in import', () => {
    expect(findNodeBuiltinImports(parse(`import fs from 'node:fs';`))).toHaveLength(1);
  });

  it('finds planted forbidden globals', () => {
    for (const src of [
      'document.title;',
      'window.x;',
      'fetch("u");',
      'eval("1");',
      'new Function("return 1");',
    ]) {
      expect(findForbiddenGlobals(parse(src)), src).toHaveLength(1);
    }
    for (const src of ['new XMLHttpRequest();', 'new WebSocket("u");', 'x.createElement("a");']) {
      expect(findExtraForbidden(parse(src)), src).toHaveLength(1);
    }
    expect(findExtraForbidden(parse(`// WebSocket\nconst s = 'createElement';`))).toHaveLength(0);
  });

  it('finds a planted dynamic import', () => {
    expect(findDynamicImport(parse(`const m = import('./x.ts');`))).toHaveLength(1);
    expect(findDynamicImport(parse(`import x from './x.ts';`))).toHaveLength(0);
  });

  it('finds a planted any type', () => {
    expect(findAnyKeyword(parse(`const x: any = 1;`))).toHaveLength(1);
  });

  it('finds planted regular expressions', () => {
    expect(findRegExp(parse(`const r = /a/;`))).toHaveLength(1);
    expect(findRegExp(parse(`const r = new RegExp('a');`))).toHaveLength(1);
  });

  it('finds planted non-relative imports', () => {
    expect(findNonRelativeImports(parse(`import x from 'lodash';`))).toHaveLength(1);
  });

  it('flags every external import except decodeCp437 from ../fat12', () => {
    const f = join(FORMATS, 'x.ts');
    const run = (src: string): number => findDisallowedExternalImports(parse(src, f), f).length;
    expect(run(`import { decodeCp437 } from '../fat12';`)).toBe(0);
    expect(run(`import { a } from './b.ts';`)).toBe(0);
    expect(run(`import { decodeCp437, other } from '../fat12';`)).toBe(1);
    expect(run(`import { other } from '../fat12';`)).toBe(1);
    expect(run(`import * as m from '../fat12';`)).toBe(1);
    expect(run(`import { decodeCp437 } from '../fat12/index.ts';`)).toBe(1);
    expect(run(`export { decodeCp437 } from '../fat12';`)).toBe(1);
    expect(run(`import { a } from '../../test-support/x.ts';`)).toBe(1);
  });

  it('flags test-support imports', () => {
    const f = join(FORMATS, 'x.ts');
    expect(findTestSupportImports(parse(`import { a } from '../../test-support/x.ts';`, f), f)).toHaveLength(1);
    expect(findTestSupportImports(parse(`import { a } from './x.ts';`, f), f)).toHaveLength(0);
  });

  it('finds planted limit literals in any spelling', () => {
    const values = new Set([4096, 4194304]);
    expect(findNumericLiterals(parse(`const a = 4096;`), values)).toHaveLength(1);
    expect(findNumericLiterals(parse(`const a = 0x1000;`), values)).toHaveLength(1);
    expect(findNumericLiterals(parse(`const a = 4_194_304;`), values)).toHaveLength(1);
    expect(findNumericLiterals(parse(`const a = 4097;`), values)).toHaveLength(0);
  });

  it('finds expect( inside fc.property and fc.asyncProperty only', () => {
    expect(findExpectInProperties(parse(`fc.property(fc.nat(), (n) => { expect(n).toBe(1); });`))).toHaveLength(1);
    expect(
      findExpectInProperties(parse(`fc.asyncProperty(fc.nat(), async (n) => { expect.soft(n).toBe(1); });`)),
    ).toHaveLength(1);
    expect(findExpectInProperties(parse(`fc.assert(fc.property(fc.nat(), (n) => n >= 0));`))).toHaveLength(0);
    expect(findExpectInProperties(parse(`it('x', () => { expect(1).toBe(1); });`))).toHaveLength(0);
  });

  it('collects live limit values, including the derived PNG maximum', () => {
    expect(LIMIT_VALUES.has(limits.MAX_PNG_BYTES)).toBe(true);
    expect(LIMIT_VALUES.has(limits.MAX_IMAGE_DIMENSION)).toBe(true);
    expect(LIMIT_VALUES.has(limits.MAX_WARNINGS)).toBe(false);
  });

  it('finds source files to scan', () => {
    expect(formatsSourceFiles.length).toBeGreaterThan(5);
    expect(formatsSourceFiles.some((f) => f === LIMITS_FILE)).toBe(true);
    expect(formatsTestFiles.length).toBeGreaterThan(5);
  });
});

describe('src/core/formats purity (non-test files)', () => {
  it('imports no Node built-ins', () => {
    expect(scan(formatsSourceFiles, findNodeBuiltinImports)).toEqual([]);
  });

  it('references no document, window, fetch, eval, new Function', () => {
    expect(scan(formatsSourceFiles, findForbiddenGlobals)).toEqual([]);
  });

  it('references no XMLHttpRequest, WebSocket or createElement', () => {
    expect(scan(formatsSourceFiles, findExtraForbidden)).toEqual([]);
  });

  it('uses no dynamic import()', () => {
    expect(scan(formatsSourceFiles, findDynamicImport)).toEqual([]);
  });

  it('uses no `any` type', () => {
    expect(scan(formatsSourceFiles, findAnyKeyword)).toEqual([]);
  });

  it('uses no regular expression literal and no RegExp', () => {
    expect(scan(formatsSourceFiles, findRegExp)).toEqual([]);
  });

  it('has only relative imports', () => {
    expect(scan(formatsSourceFiles, findNonRelativeImports)).toEqual([]);
  });

  it('imports from outside src/core/formats only `decodeCp437` from ../fat12', () => {
    const out: string[] = [];
    for (const f of formatsSourceFiles) {
      for (const x of findDisallowedExternalImports(parsed(f), f)) out.push(`${rel(f)}:${x.line} ${x.message}`);
    }
    expect(out).toEqual([]);
  });

  it('imports from src/test-support nowhere in src/core', () => {
    const out: string[] = [];
    for (const f of coreSourceFiles) {
      for (const x of findTestSupportImports(parsed(f), f)) out.push(`${rel(f)}:${x.line} ${x.message}`);
    }
    expect(out).toEqual([]);
  });

  it('repeats no limit value of 4,096 or more outside limits.ts', () => {
    const out: string[] = [];
    for (const f of formatsSourceFiles) {
      if (f === LIMITS_FILE) continue;
      const found = findNumericLiterals(parsed(f), LIMIT_VALUES, (line) => `${rel(f)}:${line}` in LIMIT_LITERAL_ALLOW);
      for (const x of found) out.push(`${rel(f)}:${x.line} ${x.message}`);
    }
    expect(out).toEqual([]);
  });
});

describe('formats test files', () => {
  it('never call expect( inside an fc.property callback', () => {
    expect(scan(formatsTestFiles, findExpectInProperties)).toEqual([]);
  });
});

describe('package.json dependencies', () => {
  it('stays empty or absent', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
  });
});
