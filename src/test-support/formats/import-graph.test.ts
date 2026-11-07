import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isBuiltin, isRelative, moduleRefs, parse } from '../scan';

const FORMATS_DIR = __dirname;
const ENTRY = join(FORMATS_DIR, 'index.ts');
const CORE_DIR = resolve(FORMATS_DIR, '..', '..', 'core') + sep;

function resolveRelative(from: string, spec: string): string | undefined {
  const base = resolve(dirname(from), spec);
  const candidates = [base, `${base}.ts`, join(base, 'index.ts')];
  return candidates.find((c) => existsSync(c) && statSync(c).isFile());
}

interface Graph {
  files: string[];
  external: string[];
  unresolved: string[];
}

function closure(entry: string): Graph {
  const seen = new Set<string>();
  const external = new Set<string>();
  const unresolved: string[] = [];
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const sf = parse(readFileSync(file, 'utf8'), file);
    for (const ref of moduleRefs(sf)) {
      if (!isRelative(ref.specifier)) {
        external.add(ref.specifier);
        continue;
      }
      const target = resolveRelative(file, ref.specifier);
      if (target === undefined) unresolved.push(`${file}: ${ref.specifier}`);
      else queue.push(target);
    }
  }
  return { files: [...seen], external: [...external], unresolved };
}

describe('fixture barrel import graph', () => {
  const graph = closure(ENTRY);
  const names = graph.files.map((f) => f.slice(f.lastIndexOf(sep) + 1));

  it('resolves every relative import and includes the writers', () => {
    expect(graph.unresolved).toEqual([]);
    expect(names).toContain('index.ts');
    expect(names).toContain('wordstar-writer.ts');
    expect(names).toContain('png-decoder.ts');
  });

  it('reaches no vitest, fast-check or node: module', () => {
    const bad = graph.external.filter(
      (s) => s === 'vitest' || s.startsWith('vitest/') || s === 'fast-check' || isBuiltin(s),
    );
    expect(bad).toEqual([]);
    expect(graph.external.filter((s) => s.startsWith('node:'))).toEqual([]);
  });

  it('reaches nothing under src/core', () => {
    expect(graph.files.filter((f) => f.startsWith(CORE_DIR))).toEqual([]);
  });

  it('does not reach arbitraries, oracles, png-oracle or invariants', () => {
    for (const banned of ['arbitraries.ts', 'oracles.ts', 'png-oracle.ts', 'invariants.ts']) {
      expect(names).not.toContain(banned);
    }
  });
});
