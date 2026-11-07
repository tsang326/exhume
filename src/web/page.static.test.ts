// Static checks of index.html and src/style.css (task 15.3).
// Validates: Requirements 2.1, 2.2, 2.3, 8.7, 8.8, 11.1, 11.2, 11.3, 11.4, 11.7,
// 12.12, 12.14, 12.15, 12.16, 12.17, 13.1, 13.3, 13.4.
// The full-stylesheet run of checkCss lives in src/test-support/web/css-check.test.ts;
// this file runs the individual checks and adds self-tests of the helpers.

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkCsp, EXPECTED_CSP, parseCsp } from '../test-support/web/csp';
import {
  checkFxLayers,
  checkLayout,
  checkPairs,
  checkReducedMotion,
  checkUrls,
  findStyleApiUse,
  parseCss,
  readPairs,
  stripCssComments,
} from '../test-support/web/css-scan';
import { parseHtml, scanHtml, type HtmlElement } from '../test-support/web/html-scan';
import { scanPhrasesInHtml } from '../test-support/web/scan';

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const facts = scanHtml(html);
const doc = parseHtml(html);

function byId(id: string): HtmlElement {
  const el = doc.elements.find((e) => e.attrs['id'] === id);
  if (el === undefined) throw new Error(`missing #${id}`);
  return el;
}

describe('index.html', () => {
  it('has exactly one CSP meta, before any script, link or style', () => {
    expect(facts.cspMetaCount).toBe(1);
    expect(facts.cspBeforeResources).toBe(true);
  });

  it('has the exact CSP directive set and no unsafe-*, data:, wildcard or remote source', () => {
    expect(facts.cspContent).not.toBeNull();
    const content = facts.cspContent!;
    expect(checkCsp(content)).toEqual([]);
    const parsed = parseCsp(content);
    expect(parsed.duplicates).toEqual([]);
    const get = (name: string): readonly string[] | undefined =>
      parsed.directives.find((d) => d.name === name)?.values;
    expect(get('connect-src')).toEqual(["'self'"]);
    expect([...(get('img-src') ?? [])].sort()).toEqual(["'self'", 'blob:']);
    expect(parsed.directives.map((d) => d.name).sort()).toEqual(Object.keys(EXPECTED_CSP).sort());
    expect(content).not.toMatch(/unsafe-|data:|\*/i);
  });

  it('has no inline script content, on* attribute, style attribute or style element', () => {
    expect(facts.inlineScripts).toEqual([]);
    expect(facts.onAttributes).toEqual([]);
    expect(facts.styleAttributes).toEqual([]);
    expect(facts.styleElementCount).toBe(0);
  });

  it('loads only the module entry script, with no remote link or script', () => {
    expect(facts.scripts.map((s) => s.attrs['src'])).toEqual(['/src/main.ts']);
    expect(facts.scripts[0]!.attrs['type']).toBe('module');
    for (const link of facts.links) expect(link['href'] ?? '').not.toMatch(/^([a-z][a-z0-9+.-]*:|\/\/)/i);
  });

  it('has lang, a non-empty title and exactly one h1', () => {
    expect(facts.lang).toBeTruthy();
    expect((facts.title ?? '').trim().length).toBeGreaterThan(0);
    expect(facts.h1Count).toBe(1);
  });

  it('has the privacy note (1 to 140 characters) as visible text', () => {
    const text = facts.textById['privacy-note'];
    expect(text).toBeDefined();
    expect(text!.length).toBeGreaterThanOrEqual(1);
    expect(text!.length).toBeLessThanOrEqual(140);
    expect(facts.visibleText).toContain(text!);
  });

  it('has the honesty note (1 to 160 characters) naming andete/disk-peek as visible text', () => {
    const text = facts.textById['honesty-note'];
    expect(text).toBeDefined();
    expect(text!.length).toBeGreaterThanOrEqual(1);
    expect(text!.length).toBeLessThanOrEqual(160);
    expect(text).toContain('andete/disk-peek');
    expect(facts.visibleText).toContain(text!);
  });

  it('has every id and class of the element contract', () => {
    for (const id of [
      'fx-host', 'app', 'drop-zone', 'pick-button', 'file-input', 'status',
      'cancel-button', 'reopen-button', 'demo-slot', 'graveyard', 'preview-root',
    ]) {
      expect(doc.elements.filter((e) => e.attrs['id'] === id), `#${id}`).toHaveLength(1);
    }
    expect(doc.elements.filter((e) => (e.attrs['class'] ?? '').split(/\s+/).includes('content'))).toHaveLength(1);
  });

  it('has a visible picker button and a hidden file input', () => {
    const pick = byId('pick-button');
    expect(pick.tag).toBe('button');
    expect(pick.attrs['hidden']).toBeUndefined();
    expect(facts.textById['pick-button']).toBe('Choose a disk image');
    const input = byId('file-input');
    expect(input.tag).toBe('input');
    expect(input.attrs['type']).toBe('file');
    expect(input.attrs['hidden']).toBeDefined();
  });

  it('has the status region attributes', () => {
    const status = byId('status');
    expect(status.attrs['role']).toBe('status');
    expect(status.attrs['aria-live']).toBe('polite');
    expect(status.attrs['aria-atomic']).toBe('true');
  });

  it('hides cancel and reopen buttons at first', () => {
    for (const id of ['cancel-button', 'reopen-button']) {
      expect(byId(id).tag).toBe('button');
      expect(byId(id).attrs['hidden']).toBeDefined();
    }
  });

  it('keeps the demo slot empty and marked with its slot comment', () => {
    expect(byId('demo-slot').children).toEqual([]);
    expect(doc.comments.some((c) => /SLOT/.test(c) && /demo/i.test(c))).toBe(true);
  });

  it('puts the preview root beside #app, not inside it, and the drop zone and graveyard inside #app', () => {
    const inside = (root: HtmlElement, id: string): boolean => {
      const walk = (el: HtmlElement): boolean =>
        el.children.some((c) => c.kind === 'element' && (c.attrs['id'] === id || walk(c)));
      return walk(root);
    };
    const app = byId('app');
    expect(inside(app, 'preview-root')).toBe(false);
    expect(inside(app, 'drop-zone')).toBe(true);
    expect(inside(app, 'graveyard')).toBe(true);
    expect(byId('fx-host').attrs['aria-hidden']).toBe('true');
    expect(byId('drop-zone').attrs['aria-label']).toBeTruthy();
  });

  it('has no forbidden phrase in the visible text', () => {
    expect(scanPhrasesInHtml('index.html', html)).toEqual([]);
  });
});

describe('src/style.css', () => {
  it('meets every contrast pair minimum', () => {
    expect(readPairs(css).length).toBeGreaterThan(0);
    expect(checkPairs(css)).toEqual([]);
  });

  it('passes the layout rules (Req 12.17)', () => {
    expect(checkLayout(css)).toEqual([]);
  });

  it('keeps .fx-* layers click-through, low in opacity and under .content, with the over-text check', () => {
    expect(checkFxLayers(css)).toEqual([]);
  });

  it('has a reduced-motion block', () => {
    expect(checkReducedMotion(css)).toEqual([]);
  });

  it('has no external or data: url() and no style-API text', () => {
    expect(checkUrls(css)).toEqual([]);
    expect(findStyleApiUse(css)).toEqual([]);
  });

  it('styles every static class that the DOM modules create with h()', () => {
    const dir = new URL('./dom/', import.meta.url);
    const used = new Set<string>();
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.ts') || f.endsWith('.test.ts')) continue;
      const src = readFileSync(new URL(f, dir), 'utf8');
      // Plain string literals only; template literals (grave--state) are dynamic and skipped.
      for (const m of src.matchAll(/\bclass:\s*'([^']+)'/g)) {
        for (const c of m[1]!.split(/\s+/)) if (c !== '') used.add(c);
      }
    }
    expect(used.size).toBeGreaterThan(10);
    const cssText = stripCssComments(css);
    // Hook-only classes: set for tests or future use, styled through a sibling class or parent.
    const hookOnly = new Set<string>();
    const missing = [...used].filter((c) => !hookOnly.has(c) && !new RegExp(`\\.${c}(?![A-Za-z0-9_-])`).test(cssText)).sort();
    expect(missing).toEqual([]);
  });
});

describe('helper self-tests', () => {
  const policy = Object.entries(EXPECTED_CSP)
    .map(([k, v]) => `${k} ${v.join(' ')}`)
    .join('; ');
  const page = (...metas: string[]): string =>
    `<!doctype html><html lang="en"><head>${metas.join('')}<title>t</title></head><body><h1>x</h1></body></html>`;
  const meta = (content: string): string =>
    `<meta http-equiv="Content-Security-Policy" content="${content}" />`;

  it('accepts the expected policy', () => {
    expect(checkCsp(policy)).toEqual([]);
  });

  it('reports unsafe-inline, data: and a wildcard', () => {
    expect(checkCsp(policy.replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")).map((p) => p.kind)).toContain('unsafe');
    expect(checkCsp(policy.replace('blob:', 'blob: data:')).map((p) => p.kind)).toContain('data');
    expect(checkCsp(policy.replace("connect-src 'self'", 'connect-src *')).map((p) => p.kind)).toContain('wildcard');
  });

  it('reports a second CSP meta', () => {
    expect(scanHtml(page(meta(policy), meta(policy))).cspMetaCount).toBe(2);
  });

  it('reports a CSP meta placed after a script', () => {
    const late = '<script src="/a.js"></script>' + meta(policy);
    expect(scanHtml(page(late)).cspBeforeResources).toBe(false);
  });

  it('reports inline script, on* and style attributes and style elements', () => {
    const f = scanHtml(
      '<html lang="en"><head><script>alert(1)</script><style>a{}</style></head>' +
        '<body onload="x()"><p style="color:red">p</p></body></html>',
    );
    expect(f.inlineScripts).toHaveLength(1);
    expect(f.onAttributes).toEqual([{ tag: 'body', name: 'onload' }]);
    expect(f.styleAttributes).toEqual([{ tag: 'p' }]);
    expect(f.styleElementCount).toBe(1);
  });

  it('reports a forbidden phrase in visible text but not in a comment', () => {
    expect(scanPhrasesInHtml('x.html', '<p>The first browser to do this</p>')).not.toEqual([]);
    expect(scanPhrasesInHtml('x.html', '<!-- first browser --><p>ok</p>')).toEqual([]);
  });

  it('reports a low-contrast pair and accepts a high-contrast one', () => {
    const low = ':root{--pair-a-fg:#777777;--pair-a-bg:#808080;}';
    expect(checkPairs(low)).not.toEqual([]);
    const high = ':root{--pair-a-fg:#ffffff;--pair-a-bg:#000000;}';
    expect(checkPairs(high)).toEqual([]);
  });

  it('reports an .fx-* rule without pointer-events: none', () => {
    const bad = '.content{z-index:10}.fx-glow{z-index:1;opacity:0.4}';
    expect(checkFxLayers(bad).some((p) => /pointer-events/.test(p.message))).toBe(true);
    const good = '.content{z-index:10}.fx-glow{z-index:1;opacity:0.4;pointer-events:none}';
    expect(checkFxLayers(good)).toEqual([]);
  });

  it('reports a fixed page-level width, a missing reduced-motion block and an external url', () => {
    expect(checkLayout('body{width:900px}').some((p) => /width/.test(p.message))).toBe(true);
    expect(checkReducedMotion('a{color:red}')).not.toEqual([]);
    expect(checkUrls('a{background:url(https://x.test/a.png)}')).not.toEqual([]);
    expect(checkUrls('a{background:url(data:image/png;base64,AA)}')).not.toEqual([]);
  });

  it('reads at-rule context for reduced motion', () => {
    const ok = '@media (prefers-reduced-motion: reduce){*{animation-duration:0s;transition-duration:0s}}';
    expect(parseCss(ok)[0]!.context[0]).toMatch(/prefers-reduced-motion/);
    expect(checkReducedMotion(ok)).toEqual([]);
  });
});
