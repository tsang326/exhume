// Checks over the built dist/ output. The checkpoint runs `npm run build` first;
// this file never builds. It is skipped when dist/index.html does not exist.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkCsp } from '../test-support/web/csp';
import { scanHtml } from '../test-support/web/html-scan';

const DIST = fileURLToPath(new URL('../../dist/', import.meta.url));
const INDEX = join(DIST, 'index.html');
const ASSETS = join(DIST, 'assets');

const DATA_URL_PATTERNS: readonly RegExp[] = [
  /url\(['"]?data:/,
  /data:[a-z]+\/[a-z0-9.+-]+[;,]/,
];

function emittedFiles(ext: '.js' | '.css'): string[] {
  if (!existsSync(ASSETS)) return [];
  return readdirSync(ASSETS).filter((f) => f.endsWith(ext));
}

describe.skipIf(!existsSync(INDEX))('built dist/', () => {
  const html = existsSync(INDEX) ? readFileSync(INDEX, 'utf8') : '';
  const facts = scanHtml(html);

  it('has exactly one CSP meta with the exact directives', () => {
    expect(facts.cspMetaCount).toBe(1);
    expect(facts.cspContent).not.toBeNull();
    expect(checkCsp(facts.cspContent ?? '')).toEqual([]);
  });

  it('puts the CSP meta before any script, link or style', () => {
    expect(facts.cspBeforeResources).toBe(true);
  });

  it('has no inline script content', () => {
    expect(facts.inlineScripts).toEqual([]);
    for (const s of facts.scripts) expect(s.attrs['src']).toBeTruthy();
  });

  it('has no on* attribute, style attribute or style element', () => {
    expect(facts.onAttributes).toEqual([]);
    expect(facts.styleAttributes).toEqual([]);
    expect(facts.styleElementCount).toBe(0);
  });

  it('has no data: in the HTML', () => {
    expect(html).not.toContain('data:');
  });

  it('has no unsafe- in the HTML', () => {
    expect(html).not.toContain('unsafe-');
  });

  it('emits exactly one separate disk.worker chunk', () => {
    const workers = emittedFiles('.js').filter((f) => /^disk\.worker-.*\.js$/.test(f));
    expect(workers).toHaveLength(1);
  });

  it('has no data: URL in the emitted CSS or JS', () => {
    const files = [...emittedFiles('.js'), ...emittedFiles('.css')];
    expect(files.length).toBeGreaterThan(0);
    const hits: string[] = [];
    for (const f of files) {
      const text = readFileSync(join(ASSETS, f), 'utf8');
      for (const re of DATA_URL_PATTERNS) {
        if (re.test(text)) hits.push(`${f}: ${re.source}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
