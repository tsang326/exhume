// Repo hygiene: exhumed/ is ignored, kept out of test globs and out of hook globs.
// Validates: Requirements 18.2, 18.3
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { globMatch } from '../test-support/mcp/glob';

const root = resolve(__dirname, '..', '..');
const read = (name: string): string => readFileSync(join(root, name), 'utf8');

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out;
}

/** Collects every string found under pattern-like keys, at any depth. */
function collectPatterns(value: unknown, underPatternKey: boolean, out: string[]): void {
  if (typeof value === 'string') {
    if (underPatternKey) out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collectPatterns(v, underPatternKey, out);
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      collectPatterns(v, /pattern|glob|matcher/i.test(k), out);
    }
  }
}

describe('exhumed/ stays out of git, tests and hooks', () => {
  it('.gitignore has a line equal to exhumed/', () => {
    const lines = read('.gitignore')
      .split('\n')
      .map((l) => l.replace(/\r$/, ''));
    expect(lines).toContain('exhumed/');
  });

  it.each(['vitest.config.ts', 'vitest.dom.config.ts'])('%s excludes **/exhumed/**', (f) => {
    expect(read(f)).toContain('**/exhumed/**');
  });

  it('no hook pattern matches files under exhumed/ (passes when .kiro/hooks is absent)', () => {
    const hooksDir = join(root, '.kiro', 'hooks');
    if (!existsSync(hooksDir)) return;
    const samples = ['exhumed/a.md', 'exhumed/b.csv', 'exhumed/c.png'];
    for (const file of listFiles(hooksDir)) {
      const text = readFileSync(file, 'utf8');
      const patterns: string[] = [];
      try {
        collectPatterns(JSON.parse(text), false, patterns);
      } catch {
        continue;
      }
      for (const pattern of patterns) {
        for (const s of samples) {
          expect(globMatch(pattern, s), `${file}: "${pattern}" matches ${s}`).toBe(false);
        }
      }
    }
  });
});
