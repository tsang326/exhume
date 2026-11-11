// Checks over the built dist/ output. The checkpoint runs `npm run build` first;
// this file never builds. It is skipped when dist/index.html does not exist.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkCsp } from '../test-support/web/csp';
import { parseHtml, scanHtml } from '../test-support/web/html-scan';

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

if (!existsSync(INDEX)) {
  console.warn(
    `[dist.build.test] dist/index.html is missing (${INDEX}): the dist checks are SKIPPED. Run \`npm run build\` before \`npm test\`.`,
  );
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

  it('resolves every img src inside dist/ and leaves no /src/ path', () => {
    const imgs = parseHtml(html).elements.filter((e) => e.tag === 'img');
    expect(imgs.length).toBeGreaterThan(0);
    for (const img of imgs) {
      const src = img.attrs['src'] ?? '';
      expect(src).not.toBe('');
      expect(src).not.toMatch(/^[a-z][a-z0-9+.-]*:/i);
      expect(src).not.toMatch(/^\/\//);
      expect(existsSync(join(DIST, src.replace(/^\//, '')))).toBe(true);
    }
    expect(html).not.toContain('/src/');
    for (const f of [...emittedFiles('.js'), ...emittedFiles('.css')]) {
      expect(readFileSync(join(ASSETS, f), 'utf8')).not.toContain('/src/assets/');
    }
  });

  it('resolves the favicon href to an emitted SVG file in dist/', () => {
    const icons = parseHtml(html).elements.filter((e) => e.tag === 'link' && e.attrs['rel'] === 'icon');
    expect(icons).toHaveLength(1);
    const href = icons[0]!.attrs['href'] ?? '';
    expect(href).toMatch(/^\/(?!\/)/);
    expect(href).not.toContain('/src/');
    expect(href.endsWith('.svg')).toBe(true);
    const file = join(DIST, href.replace(/^\//, ''));
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf8')).toContain('xmlns="http://www.w3.org/2000/svg"');
  });

  it('emits exactly two .woff2 files', () => {
    const fonts = readdirSync(ASSETS).filter((f) => f.endsWith('.woff2'));
    expect(fonts).toHaveLength(2);
  });

  it('emits the grain, disk35, disks-band and logo-pcx images', () => {
    const files = readdirSync(ASSETS);
    for (const stem of ['grain', 'disk35', 'disks-band', 'logo-pcx']) {
      expect(files.some((f) => f.startsWith(stem + '-'))).toBe(true);
    }
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
