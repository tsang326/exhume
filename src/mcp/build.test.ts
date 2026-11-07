// Stale-build test (Requirement 13): rebuild in memory with write:false and compare with the
// committed power/server/exhume-mcp.mjs. Nothing is written to disk.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import type { InlineConfig } from 'vite';
import { describe, expect, it } from 'vitest';
import config, { MCP_BANNER } from '../../vite.mcp.config';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const COMMITTED = resolve(ROOT, 'power', 'server', 'exhume-mcp.mjs');

async function buildInMemory(): Promise<string> {
  const inline: InlineConfig = {
    ...config,
    root: ROOT,
    configFile: false,
    build: { ...config.build, write: false },
  };
  const out = await build(inline);
  const outputs = Array.isArray(out) ? out : [out];
  const chunks = outputs.flatMap((o) => ('output' in o ? o.output : [])).filter((f) => f.type === 'chunk');
  const named = chunks.filter((c) => c.fileName === 'exhume-mcp.mjs');
  expect(chunks.length).toBe(1);
  expect(named.length).toBe(1);
  return named[0].code;
}

describe('mcp bundle build', () => {
  it('matches the committed power/server/exhume-mcp.mjs', async () => {
    const built = await buildInMemory();
    const committed = readFileSync(COMMITTED, 'utf8');
    const same = built === committed;
    expect(
      same,
      'power/server/exhume-mcp.mjs is stale: run `npm run build:mcp` and commit the result.',
    ).toBe(true);
  });

  it('is deterministic across two in-memory builds', async () => {
    const a = await buildInMemory();
    const b = await buildInMemory();
    expect(a === b).toBe(true);
  });

  it('committed file starts with the banner and imports only node: modules', () => {
    const text = readFileSync(COMMITTED, 'utf8');
    expect(text.startsWith(MCP_BANNER)).toBe(true);
    expect(text).not.toMatch(/\brequire\(/);

    const specs: string[] = [];
    const fromRe = /\b(?:import|export)\s[^'"`;]*?\sfrom\s*(['"])([^'"]+)\1/g;
    const bareRe = /^\s*import\s*(['"])([^'"]+)\1/gm;
    const dynRe = /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
    for (const re of [fromRe, bareRe, dynRe]) {
      for (const m of text.matchAll(re)) specs.push(m[2]);
    }
    expect(specs.length).toBeGreaterThan(0);
    const bad = specs.filter((s) => !s.startsWith('node:'));
    expect(bad).toEqual([]);
  });

  it('package.json keeps build unchanged and defines build:mcp', () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts['build:mcp']).toBe('vite build --config vite.mcp.config.ts');
    expect(pkg.scripts.build).toBe('npm run typecheck && vite build');
  });

  it('config never empties the output dir or copies the public dir', () => {
    expect(config.build?.emptyOutDir).toBe(false);
    expect(config.build?.copyPublicDir).toBe(false);
  });
});
