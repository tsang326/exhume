// Static purity / dependency / limit-duplication checks for src/core/.
// Sources are parsed with the TypeScript compiler API so comments and string
// contents can never cause false matches.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type ts from 'typescript';
import { describe, expect, it } from 'vitest';
import {
  findAnyKeyword,
  findForbiddenGlobals,
  findLimitLiterals,
  findNodeBuiltinImports,
  findNonRelativeImports,
  findRegExp,
  isRelative,
  moduleRefs,
  packageName,
  parse,
  type Finding,
} from './scan.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CORE = join(ROOT, 'src', 'core');
const FAT12 = join(CORE, 'fat12');
const TEST_SUPPORT = join(ROOT, 'src', 'test-support');
const WRITER_ENTRY = join(TEST_SUPPORT, 'fat12', 'index.ts');

// ------------------------------------------------------------------ files

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
const rel = (f: string): string => relative(ROOT, f);

const coreFiles = collectTsFiles(CORE);
const coreSourceFiles = coreFiles.filter((f) => !isTestFile(f));
const parsedCache = new Map<string, ts.SourceFile>();
function parsed(file: string): ts.SourceFile {
  let sf = parsedCache.get(file);
  if (!sf) {
    sf = parse(readFileSync(file, 'utf8'), file);
    parsedCache.set(file, sf);
  }
  return sf;
}

/** Run a scanner over files and format offenders as `file:line message`. */
function scan(files: string[], scanner: (sf: ts.SourceFile) => Finding[]): string[] {
  const out: string[] = [];
  for (const f of files) {
    for (const finding of scanner(parsed(f))) {
      out.push(`${rel(f)}:${finding.line} ${finding.message}`);
    }
  }
  return out;
}

function resolveRelative(fromFile: string, spec: string): string | undefined {
  const base = resolve(dirname(fromFile), spec);
  const candidates = [
    base,
    `${base}.ts`,
    base.replace(/\.js$/, '.ts'),
    join(base, 'index.ts'),
  ];
  return candidates.find((c) => existsSync(c) && statSync(c).isFile() && c.endsWith('.ts'));
}

const inside = (file: string, dir: string): boolean => {
  const r = relative(dir, file);
  return r !== '' && !r.startsWith('..') && !r.startsWith('/');
};

// ------------------------------------------------------------------ tests

describe('scanner self-test (detectors flag known-bad sources)', () => {
  it('flags Node built-in imports with and without node: prefix', () => {
    expect(findNodeBuiltinImports(parse(`import fs from 'fs';`))).toHaveLength(1);
    expect(findNodeBuiltinImports(parse(`import { readFileSync } from 'node:fs';`))).toHaveLength(1);
    expect(findNodeBuiltinImports(parse(`import p from 'path/posix';`))).toHaveLength(1);
    expect(findNodeBuiltinImports(parse(`const m = await import('os');`))).toHaveLength(1);
    expect(findNodeBuiltinImports(parse(`import { a } from './fs';`))).toHaveLength(0);
  });

  it('flags non-relative imports but not relative ones', () => {
    expect(findNonRelativeImports(parse(`import x from 'lodash';`))).toHaveLength(1);
    expect(findNonRelativeImports(parse(`export * from 'zod';`))).toHaveLength(1);
    expect(findNonRelativeImports(parse(`import x from './a.ts';`))).toHaveLength(0);
    expect(findNonRelativeImports(parse(`import x from '../a.ts';`))).toHaveLength(0);
  });

  it('flags forbidden globals, eval and new Function', () => {
    expect(findForbiddenGlobals(parse(`fetch('x');`))).toHaveLength(1);
    expect(findForbiddenGlobals(parse(`const d = document.title;`))).toHaveLength(1);
    expect(findForbiddenGlobals(parse(`window.alert(1);`))).toHaveLength(1);
    expect(findForbiddenGlobals(parse(`eval('1');`))).toHaveLength(1);
    expect(findForbiddenGlobals(parse(`const f = new Function('return 1');`))).toHaveLength(1);
    // comments, strings and property names are not references
    expect(findForbiddenGlobals(parse(`// fetch\nconst s = 'window'; const o = { fetch: 1 }; o.fetch;`))).toHaveLength(0);
  });

  it('flags the any keyword only as a type', () => {
    expect(findAnyKeyword(parse(`const x: any = 1;`))).toHaveLength(1);
    expect(findAnyKeyword(parse(`function f(a: Array<any>) {}`))).toHaveLength(1);
    expect(findAnyKeyword(parse(`// any\nconst any1 = 'any';`))).toHaveLength(0);
  });

  it('flags the limit literals in any formatting', () => {
    expect(findLimitLiterals(parse(`const a = 2_949_120;`))).toHaveLength(1);
    expect(findLimitLiterals(parse(`const a = 2949120;`))).toHaveLength(1);
    expect(findLimitLiterals(parse(`const a = 4194304;`))).toHaveLength(1);
    expect(findLimitLiterals(parse(`const a = 0x400000;`))).toHaveLength(1);
    expect(findLimitLiterals(parse(`const a = 4_194_304;`))).toHaveLength(1);
    expect(findLimitLiterals(parse(`const a = 2949121; // 2949120`))).toHaveLength(0);
  });

  it('flags RegExp literals and constructors', () => {
    expect(findRegExp(parse(`const r = /a+/;`))).toHaveLength(1);
    expect(findRegExp(parse(`const r = new RegExp('a+');`))).toHaveLength(1);
    expect(findRegExp(parse(`const r = RegExp('a+');`))).toHaveLength(1);
    expect(findRegExp(parse(`const r = 'a/b/c'; // /a+/`))).toHaveLength(0);
  });

  it('extracts package names from specifiers', () => {
    expect(packageName('fast-check')).toBe('fast-check');
    expect(packageName('@scope/pkg/sub')).toBe('@scope/pkg');
    expect(packageName('lodash/fp')).toBe('lodash');
  });

  it('finds source files to scan', () => {
    expect(coreSourceFiles.length).toBeGreaterThan(5);
    expect(coreSourceFiles.some((f) => f.endsWith('limits.ts'))).toBe(true);
    expect(coreSourceFiles.some((f) => f.endsWith('names.ts'))).toBe(true);
    expect(coreSourceFiles.every((f) => !f.includes('/exhumed/'))).toBe(true);
  });
});

describe('src/core purity', () => {
  it('imports no Node built-ins (non-test files)', () => {
    expect(scan(coreSourceFiles, findNodeBuiltinImports)).toEqual([]);
  });

  it('references no document/window/fetch/eval and no new Function (non-test files)', () => {
    expect(scan(coreSourceFiles, findForbiddenGlobals)).toEqual([]);
  });

  it('has zero runtime dependencies: only relative imports (non-test files)', () => {
    expect(scan(coreSourceFiles, findNonRelativeImports)).toEqual([]);
  });

  it('never imports from src/test-support (non-test files)', () => {
    const offenders: string[] = [];
    for (const f of coreSourceFiles) {
      for (const r of moduleRefs(parsed(f))) {
        if (!isRelative(r.specifier)) continue;
        const target = resolve(dirname(f), r.specifier);
        if (target === TEST_SUPPORT || inside(target, TEST_SUPPORT)) {
          offenders.push(`${rel(f)}:${r.line} imports test-support '${r.specifier}'`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('uses no `any` type (non-test files under src/core/fat12)', () => {
    const files = coreSourceFiles.filter((f) => inside(f, FAT12));
    expect(scan(files, findAnyKeyword)).toEqual([]);
  });

  it('defines the 2949120 / 4194304 limits only in limits.ts (non-test files)', () => {
    const files = coreSourceFiles.filter((f) => !f.endsWith(join('fat12', 'limits.ts')));
    expect(scan(files, findLimitLiterals)).toEqual([]);
  });

  it('limits.ts itself still defines the limit values', () => {
    const limits = join(FAT12, 'limits.ts');
    expect(scan([limits], findLimitLiterals).length).toBeGreaterThan(0);
  });

  it('uses no RegExp in names.ts', () => {
    const names = join(FAT12, 'names.ts');
    expect(existsSync(names)).toBe(true);
    expect(scan([names], findRegExp)).toEqual([]);
  });

  it('reports RegExp use in other non-test core files', () => {
    const others = coreSourceFiles.filter((f) => !f.endsWith(join('fat12', 'names.ts')));
    const hits = scan(others, findRegExp);
    // Only names.ts is a hard failure; surface the rest without failing.
    if (hits.length > 0) console.warn(`RegExp use in core (informational):\n${hits.join('\n')}`);
    expect(Array.isArray(hits)).toBe(true);
  });
});

describe('test-support writer isolation', () => {
  function reachableFromWriter(): Set<string> {
    const seen = new Set<string>();
    const queue = [WRITER_ENTRY];
    while (queue.length > 0) {
      const f = queue.pop() as string;
      if (seen.has(f)) continue;
      seen.add(f);
      for (const r of moduleRefs(parsed(f))) {
        if (!isRelative(r.specifier)) continue;
        const target = resolveRelative(f, r.specifier);
        if (target) queue.push(target);
      }
    }
    return seen;
  }

  it('writer entry exists and reaches several files', () => {
    expect(existsSync(WRITER_ENTRY)).toBe(true);
    expect(reachableFromWriter().size).toBeGreaterThan(1);
  });

  it('does not reach arbitraries.ts', () => {
    const names = [...reachableFromWriter()].map(rel);
    expect(names.filter((n) => n.endsWith('arbitraries.ts'))).toEqual([]);
  });

  it('imports neither vitest, fast-check nor src/core from any reachable file', () => {
    const offenders: string[] = [];
    for (const f of reachableFromWriter()) {
      for (const r of moduleRefs(parsed(f))) {
        const s = r.specifier;
        const pkg = packageName(s);
        if (pkg === 'vitest' || pkg === 'fast-check' || s.startsWith('vitest/')) {
          offenders.push(`${rel(f)}:${r.line} imports '${s}'`);
        } else if (isRelative(s)) {
          const target = resolve(dirname(f), s);
          if (target === CORE || inside(target, CORE)) {
            offenders.push(`${rel(f)}:${r.line} imports from src/core '${s}'`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe('package.json dependencies', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    dependencies?: Record<string, string>;
  };

  it('declares no runtime dependencies (core has zero)', () => {
    expect(
      Object.keys(pkg.dependencies ?? {}),
      'package.json `dependencies` must be absent or empty: src/core has zero runtime dependencies',
    ).toEqual([]);
  });

  it('no file under src/core imports a package listed in dependencies', () => {
    const deps = new Set(Object.keys(pkg.dependencies ?? {}));
    const offenders: string[] = [];
    for (const f of coreFiles) {
      for (const r of moduleRefs(parsed(f))) {
        if (!isRelative(r.specifier) && deps.has(packageName(r.specifier))) {
          offenders.push(`${rel(f)}:${r.line} imports dependency '${r.specifier}'`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
