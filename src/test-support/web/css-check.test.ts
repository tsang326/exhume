import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkCss, readPairs } from './css-scan';

const css = readFileSync(new URL('../../style.css', import.meta.url), 'utf8');

describe('src/style.css', () => {
  it('passes every CSS check', () => {
    expect(checkCss(css)).toEqual([]);
  });

  it('declares contrast pairs as literal hex values', () => {
    const pairs = readPairs(css);
    expect(pairs.length).toBeGreaterThan(0);
    for (const p of pairs) expect(p.ratio).not.toBeNull();
  });
});
