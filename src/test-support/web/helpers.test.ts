import { describe, expect, it } from 'vitest';
import { checkCsp, EXPECTED_CSP } from './csp';
import {
  checkCss,
  checkFxLayers,
  checkLayout,
  checkPairs,
  checkReducedMotion,
  checkUrls,
  findStyleApiUse,
  overTextContrast,
} from './css-scan';
import { scanHtml } from './html-scan';

const GOOD_CSP = Object.entries(EXPECTED_CSP)
  .map(([k, v]) => `${k} ${v.join(' ')}`)
  .join('; ');

const GOOD_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="${GOOD_CSP}" />
<title>Exhume</title>
<link rel="stylesheet" href="/a.css"><script type="module" src="/a.js"></script></head>
<body><!-- hidden words --><header><h1>Exhume</h1><p id="privacy">Nothing &amp; nobody leaves.</p></header>
<main><button id="pick" type="button">Choose</button><p id="status" role="status">x</p></main>
<script>var hidden = 1;</script></body></html>`;

describe('html-scan', () => {
  const f = scanHtml(GOOD_HTML);
  it('reads CSP position, resources and basics', () => {
    expect(f.cspMetaCount).toBe(1);
    expect(f.cspBeforeResources).toBe(true);
    expect(f.lang).toBe('en');
    expect(f.title).toBe('Exhume');
    expect(f.h1Count).toBe(1);
    expect(f.links).toHaveLength(1);
    expect(f.scripts).toHaveLength(2);
    expect(f.inlineScripts).toHaveLength(1);
    expect(f.textById['privacy']).toBe('Nothing & nobody leaves.');
  });
  it('visible text drops tags, comments and script contents', () => {
    expect(f.visibleText).toContain('Nothing & nobody leaves.');
    expect(f.visibleText).not.toContain('hidden');
  });
  it('flags a script before the CSP, on* and style attributes', () => {
    const bad = scanHtml(
      `<html><script src="a.js"></script><meta http-equiv="content-security-policy" content="x"><p onclick="a()" style="color:red">t</p></html>`,
    );
    expect(bad.cspBeforeResources).toBe(false);
    expect(bad.onAttributes).toEqual([{ tag: 'p', name: 'onclick' }]);
    expect(bad.styleAttributes).toEqual([{ tag: 'p' }]);
    expect(bad.lang).toBeNull();
  });
});

describe('csp', () => {
  it('accepts the exact set in any order', () => {
    expect(checkCsp(GOOD_CSP)).toEqual([]);
    expect(checkCsp(GOOD_CSP.split('; ').reverse().join('; '))).toEqual([]);
  });
  it('reports unsafe, data, wildcard, remote, missing and extra', () => {
    const kinds = (s: string) => checkCsp(s).map((p) => p.kind);
    expect(kinds(GOOD_CSP.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"))).toContain('unsafe');
    expect(kinds(GOOD_CSP.replace('img-src', 'img-src data:'))).toContain('data');
    expect(kinds(GOOD_CSP.replace("connect-src 'self'", 'connect-src *'))).toContain('wildcard');
    expect(kinds(GOOD_CSP.replace("worker-src 'self'", "worker-src 'self' https://x.example"))).toContain('remote');
    expect(kinds(GOOD_CSP.replace("; form-action 'none'", ''))).toContain('missing');
    expect(kinds(GOOD_CSP + '; frame-src none')).toContain('extra');
  });
});

const GOOD_CSS = `
:root { --pair-text-fg: #e8f0ee; --pair-text-bg: #0b1514; --pair-focus-ui-fg: #ffffff; --pair-focus-ui-bg: #0b1514; }
html, body, #app, main { width: 100%; max-width: 60rem; }
.content { position: relative; z-index: 10; }
.fx-canvas { position: fixed; z-index: 0; opacity: 0.5; pointer-events: none; }
.fx-glow { z-index: 1; opacity: 0.45; pointer-events: none; background: url(#glow); }
.grave-name, .grave-path, .preview-title { overflow-wrap: anywhere; }
.scroll-x { overflow-x: auto; max-width: 100%; }
@media (prefers-reduced-motion: reduce) { * { animation: none !important; transition: none; } }
`;

describe('css-scan', () => {
  it('accepts a good stylesheet', () => {
    expect(checkCss(GOOD_CSS)).toEqual([]);
  });
  it('fails low contrast pairs by suffix minimum', () => {
    expect(checkPairs(':root{--pair-a-fg:#777777;--pair-a-bg:#888888}')).toHaveLength(1);
    // #606060 on black is about 3.3:1: passes as -ui, fails as plain text
    expect(checkPairs(':root{--pair-b-fg:#808080;--pair-b-bg:#000000}')).toHaveLength(0);
    expect(checkPairs(':root{--pair-b-fg:#606060;--pair-b-bg:#000000}')).toHaveLength(1);
    expect(checkPairs(':root{--pair-b-ui-fg:#606060;--pair-b-ui-bg:#000000}')).toHaveLength(0);
    expect(checkPairs('a{color:red}')).toHaveLength(1);
  });
  it('fails fx layers that break the rules', () => {
    const bad = (decl: string) => checkFxLayers(`.content{z-index:10}.fx-x{${decl}}`);
    expect(bad('z-index:1;opacity:.5;pointer-events:none')).toEqual([]);
    expect(bad('z-index:1;opacity:.5')).toHaveLength(1);
    expect(bad('z-index:1;opacity:.9;pointer-events:none')).toHaveLength(1);
    expect(bad('z-index:20;opacity:.5;pointer-events:none').length).toBeGreaterThan(0);
  });
  it('accepts a faint over-text layer and composites contrast', () => {
    const css = `:root{--pair-t-fg:#ffffff;--pair-t-bg:#000000}.content{z-index:10}.fx-x{z-index:20;opacity:.1;pointer-events:none}`;
    expect(checkFxLayers(css)).toEqual([]);
    expect(overTextContrast([255, 255, 255], [0, 0, 0], [0, 0, 0], 0.5)).toBeLessThan(
      overTextContrast([255, 255, 255], [0, 0, 0], [0, 0, 0], 0.1),
    );
  });
  it('checks layout, reduced motion, urls and style API names', () => {
    expect(checkLayout('body{width:480px}')).toHaveLength(4);
    expect(checkLayout(GOOD_CSS)).toEqual([]);
    expect(checkReducedMotion('a{color:red}')).toHaveLength(1);
    expect(checkReducedMotion('@media (prefers-reduced-motion: reduce){a{animation:none}}')).toEqual([]);
    expect(checkUrls('a{background:url(data:image/png;base64,AAAA)}b{background:url("https://x.example/a.png")}')).toHaveLength(2);
    expect(checkUrls('a{background:url(img/a.png)}')).toEqual([]);
    expect(findStyleApiUse('a.style.color = 1;\nb.cssText = 2').map((v) => [v.name, v.line])).toEqual([
      ['.style.', 1],
      ['cssText', 2],
    ]);
  });
});
