// Source and import scans over the demo-disk Generator (Requirements 1.3-1.6, 2.1, 2.9).
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { scanGeneratorSource } from '../test-support/demo-source-scan';
import { isRelative, moduleRefs, parse } from '../test-support/scan';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEMO_DIR = join(ROOT, 'src', 'demo-disks');
const SCRIPT = join(ROOT, 'scripts', 'make-demo-disks.ts');

const ALLOWED_OUTSIDE = new Set([
  'src/test-support/fat12/index',
  'src/test-support/formats/index',
  'src/core/fat12/index',
  'src/core/formats/index',
]);

function walkTs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  )) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTs(full));
    else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

const FILES: string[] = [SCRIPT, ...walkTs(DEMO_DIR)];

function rel(file: string): string {
  return relative(ROOT, file).split(sep).join('/');
}

function stripExt(p: string): string {
  return p.endsWith('.ts') ? p.slice(0, -3) : p;
}

/** Direct walk for `import(` and `require(` call sites, comments and strings excluded by the parser. */
function dynamicLoads(text: string, file: string): string[] {
  const hits: string[] = [];
  const sf = parse(text, file);
  const visit = (n: ts.Node): void => {
    if (
      ts.isCallExpression(n) &&
      (n.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(n.expression) && n.expression.text === 'require'))
    ) {
      hits.push(`${file}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1}`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits;
}

describe('demo-disk generator sources', () => {
  it('finds the script and the generator files', () => {
    expect(FILES.length).toBeGreaterThan(10);
    expect(FILES.map(rel)).toContain('scripts/make-demo-disks.ts');
    expect(FILES.map(rel)).toContain('src/demo-disks/build.ts');
  });

  it('holds no forbidden name anywhere, comments included', () => {
    const violations = FILES.flatMap((f) =>
      scanGeneratorSource(rel(f), readFileSync(f, 'utf8')),
    ).map((v) => `${v.file}:${v.line} ${v.name}`);
    expect(violations).toEqual([]);
  });

  it('imports only node:fs (script only) and allowed relative modules', () => {
    const problems: string[] = [];
    for (const file of FILES) {
      const name = rel(file);
      const isScript = file === SCRIPT;
      const inChecks = name.startsWith('src/demo-disks/checks/');
      const isCli = name === 'src/demo-disks/cli.ts';
      const sf = parse(readFileSync(file, 'utf8'), name);
      for (const ref of moduleRefs(sf)) {
        const where = `${name}:${ref.line} ${ref.specifier}`;
        if (ref.specifier.startsWith('node:')) {
          if (!isScript || ref.specifier !== 'node:fs') problems.push(`node import not allowed: ${where}`);
          continue;
        }
        if (!isRelative(ref.specifier)) {
          problems.push(`non-relative import: ${where}`);
          continue;
        }
        const target = rel(resolve(dirname(file), ref.specifier));
        const targetNoExt = stripExt(target);
        const insideGenerator =
          targetNoExt.startsWith('src/demo-disks/') ||
          targetNoExt === 'scripts/make-demo-disks';
        // Task 7.3 requires `timed` in checks/reads.ts; it is allowed there only.
        const timedInChecks = inChecks && targetNoExt === 'src/test-support/timed';
        if (!insideGenerator && !ALLOWED_OUTSIDE.has(targetNoExt) && !timedInChecks) {
          problems.push(`import escapes the generator: ${where}`);
        }
        if (targetNoExt.startsWith('src/core/') && !inChecks && !isCli) {
          problems.push(`src/core import outside checks/ and cli.ts: ${where}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('cli.ts imports no node: module', () => {
    const file = join(DEMO_DIR, 'cli.ts');
    const sf = parse(readFileSync(file, 'utf8'), 'cli.ts');
    expect(moduleRefs(sf).filter((r) => r.specifier.startsWith('node:'))).toEqual([]);
  });

  it('uses no dynamic import() and no require', () => {
    const hits = FILES.flatMap((f) => dynamicLoads(readFileSync(f, 'utf8'), rel(f)));
    expect(hits).toEqual([]);
  });
});

describe('package.json', () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };

  it('has make:demos and keeps it out of build', () => {
    expect(pkg.scripts['make:demos']).toBeDefined();
    expect(pkg.scripts['build']).not.toContain('make:demos');
    expect(pkg.scripts['build']).not.toContain('make-demo-disks');
  });

  it('leaves the dependency sections unchanged', () => {
    expect(pkg.dependencies).toBeUndefined();
    expect(pkg.optionalDependencies).toBeUndefined();
    expect(pkg.devDependencies).toEqual({
      '@types/node': '22.20.5',
      'fast-check': '4.3.0',
      'happy-dom': '21.0.4',
      typescript: '~5.9.3',
      vite: '^7.1.7',
      vitest: '3.2.4',
    });
  });
});
