import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fc from 'fast-check';
import config from '../../vitest.config';
import { numRuns } from './runs';
import { timed } from './timed';

function busyWait(ms: number): void {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    /* spin */
  }
}

describe('vitest config', () => {
  it('excludes exhumed fixtures and includes only src tests', async () => {
    const resolved =
      typeof config === 'function'
        ? await (config as (env: unknown) => unknown)({
            mode: 'test',
            command: 'serve',
          })
        : config;
    const test = (resolved as { test: { include: string[]; exclude: string[] } })
      .test;
    expect(test.exclude).toContain('**/exhumed/**');
    expect(test.include).toEqual(['src/**/*.test.ts']);
  });
});

describe('package.json scripts', () => {
  it('test:fuzz sets FC_RUNS_MULTIPLIER >= 10 and filters hostile', () => {
    const pkg = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
    ) as { scripts: Record<string, string> };
    const script = pkg.scripts['test:fuzz'];
    const m = /FC_RUNS_MULTIPLIER=(\d+)/.exec(script);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(10);
    expect(script).toMatch(/\bhostile\b/);
  });
});

describe('numRuns', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const base = 7;
  it.each([
    [undefined, base],
    ['abc', base],
    ['0', base],
    ['10', 10 * base],
    ['1000', base],
  ])('FC_RUNS_MULTIPLIER=%s', (value, expected) => {
    if (value === undefined) {
      vi.stubEnv('FC_RUNS_MULTIPLIER', undefined as unknown as string);
      delete process.env.FC_RUNS_MULTIPLIER;
    } else {
      vi.stubEnv('FC_RUNS_MULTIPLIER', value);
    }
    expect(numRuns(base)).toBe(expected);
  });
});

describe('failure reporting', () => {
  it('reports seed and counterexample on failure', () => {
    let message = '';
    try {
      fc.assert(
        fc.property(fc.integer({ min: 0, max: 100 }), (x) => x < 5),
        { seed: 424242, numRuns: 200 },
      );
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).not.toBe('');
    expect(message).toContain('424242');
    expect(message).toMatch(/Counterexample: \[5\]/);
  });
});

describe('timed', () => {
  it('throws when the closure exceeds the budget', () => {
    expect(() => timed(() => busyWait(30), 5)).toThrow(/budget/i);
  });

  it('does not count time outside the closure', () => {
    busyWait(50);
    expect(() => timed(() => 1, 20)).not.toThrow();
  });

  it('returns the closure value', () => {
    expect(timed(() => 'ok')).toBe('ok');
  });
});
