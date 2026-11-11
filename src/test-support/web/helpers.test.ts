import { describe, expect, it } from 'vitest';
import { checkCsp, EXPECTED_CSP } from './csp';
import {
  checkAnimatedProperties,
  checkContentInteractive,
  checkCss,
  checkFontFamilies,
  checkHiddenStartStates,
  checkLayout,
  checkMinHeights,
  checkNoForbiddenConstructs,
  checkPairs,
  checkReducedMotion,
  checkNarrowStoneDepth,
  checkStoneRowFits,
  checkStonesVisible,
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
:root { --pair-text-fg: #e8f0ee; --pair-text-bg: #0b1514; --pair-focus-ui-fg: #ffffff; --pair-focus-ui-bg: #0b1514; --hit: 2.5rem; }
html, body, #app, main { width: 100%; max-width: 60rem; }
h1, h2, h3, .buried { font-family: var(--serif); }
.preview-text, .hex-view { font-family: var(--mono); }
body { font-family: var(--sans); }
.btn, .demo-slot-button, .grave-action { min-height: 40px; }
.hs { min-height: var(--hit); transition: opacity .2s; }
.nav .links a { min-height: 2.5rem; }
.js .rise:not(.in) { opacity: 0; transform: translateY(24px); transition: opacity .4s var(--ease), transform .4s ease; }
@keyframes raise { from { opacity: 0; transform: scale(.9); } to { opacity: 1; transform: none; } }
.demo-slot-list { grid-template-columns: repeat(3, 1fr); }
.grave-name, .grave-path, .preview-title { overflow-wrap: anywhere; }
.scroll-x { overflow-x: auto; max-width: 100%; }
@media (max-width: 760px) { .demo-slot-list { grid-template-columns: 1fr; } }
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
  it('fails gradient, filter, blur and shadow constructs', () => {
    expect(checkNoForbiddenConstructs('a{background:#111;box-shadow:none}')).toEqual([]);
    expect(checkNoForbiddenConstructs('a{background:radial-gradient(red,blue)}')).toHaveLength(1);
    expect(checkNoForbiddenConstructs('a{filter:blur(2px)}')).toHaveLength(1);
    expect(checkNoForbiddenConstructs('a{text-shadow:0 0 2px red}b{backdrop-filter:blur(1px)}')).toHaveLength(2);
  });
  it('allows only opacity, transform and clip-path to move', () => {
    expect(checkAnimatedProperties(GOOD_CSS)).toEqual([]);
    expect(checkAnimatedProperties('a{transition:background .2s}')).toHaveLength(1);
    expect(checkAnimatedProperties('a{transition:all .2s}')).toHaveLength(1);
    expect(checkAnimatedProperties('a{transition:.2s ease}')).toHaveLength(1);
    expect(checkAnimatedProperties('a{transition-property:opacity,color}')).toHaveLength(1);
    expect(checkAnimatedProperties('a{transition:opacity .2s cubic-bezier(.2, .8, .2, 1), clip-path 1s}')).toEqual([]);
    expect(checkAnimatedProperties('@keyframes k{from{opacity:0}to{margin-left:4px}}')).toHaveLength(1);
  });
  it('keeps hidden start states in keyframe from or under .js', () => {
    expect(checkHiddenStartStates(GOOD_CSS)).toEqual([]);
    expect(checkHiddenStartStates('.rise{opacity:0}')).toHaveLength(1);
    expect(checkHiddenStartStates('.seg{transform:scaleX(.001)}')).toHaveLength(1);
    expect(checkHiddenStartStates('.js .seg{transform:scaleX(.001)}')).toEqual([]);
    expect(checkHiddenStartStates('.js .a, .b{opacity:0}')).toHaveLength(1);
    expect(checkHiddenStartStates('@keyframes k{from{opacity:0}to{opacity:0}}')).toHaveLength(1);
    expect(checkHiddenStartStates('.x{opacity:.5;transform:scale(1)}')).toEqual([]);
  });
  it('limits the serif and mono faces', () => {
    expect(checkFontFamilies(GOOD_CSS)).toEqual([]);
    expect(checkFontFamilies('.hero p{font-family:var(--serif)}')).toHaveLength(1);
    expect(checkFontFamilies('h1, p{font-family:Georgia, serif}')).toHaveLength(1);
    expect(checkFontFamilies('h1 .w{font-family:"Instrument Serif", serif}')).toEqual([]);
    expect(checkFontFamilies('.btn{font-family:ui-monospace, monospace}')).toHaveLength(1);
    expect(checkFontFamilies('.hex-view span{font-family:monospace}')).toEqual([]);
    expect(checkFontFamilies('@font-face{font-family:"Instrument Serif"}p{font-family:sans-serif}')).toEqual([]);
  });
  it('never hides a headstone', () => {
    expect(checkStonesVisible('.hs--partial{display:block}@media (max-width:760px){.hs{width:26vw}}')).toEqual([]);
    expect(checkStonesVisible('@media (max-width:760px){.hs:nth-child(n+4){display:none}}')).toHaveLength(1);
    expect(checkStonesVisible('.stoneline .hs{visibility:hidden}')).toHaveLength(1);
  });
  it('checks the narrow two-row stone depth', () => {
    const good = `:root{--m:24px}.stoneline{flex-wrap:wrap}
@media (max-width:760px){
.stoneline{--stone-w:26vw;--stone-h:34vw;--back-scale:0.85;--back-margin-x:1.95vw;--back-overlap:11vw;--front-sink:4vw;gap:0 8px}
.hs{z-index:2;width:var(--stone-w);height:var(--stone-h)}
.stone-0,.stone-1,.stone-2{--sink:0px;z-index:1;width:calc(var(--stone-w) * var(--back-scale));height:calc(var(--stone-h) * var(--back-scale));margin-inline:var(--back-margin-x);margin-bottom:calc(var(--back-overlap) * -1)}
.stone-3,.stone-4,.stone-5{--sink:var(--front-sink)}
.hs.stone-0,.hs.stone-1,.hs.stone-2{background:var(--pair-hs-back-bg);color:var(--pair-hs-back-fg)}
.hs.stone-0:focus-visible,.hs.stone-1:focus-visible,.hs.stone-2:focus-visible{z-index:3}
}`;
    expect(checkNarrowStoneDepth(good)).toEqual([]);
    expect(checkNarrowStoneDepth(good.replace('--back-overlap:11vw', '--back-overlap:0vw')).length).toBeGreaterThan(0);
    expect(checkNarrowStoneDepth(good.replace('--back-overlap:11vw', '--back-overlap:20vw')).length).toBeGreaterThan(0);
    expect(checkNarrowStoneDepth(good.replace('--back-scale:0.85', '--back-scale:0.5')).length).toBeGreaterThan(0);
    expect(checkNarrowStoneDepth(good.replace('z-index:3', 'z-index:1')).length).toBeGreaterThan(0);
    expect(checkNarrowStoneDepth('a{color:red}')).toHaveLength(1);
  });
  it('checks that the stone row fits', () => {
    const base = ':root{--m:clamp(16px,3vw,40px)}.stoneline{gap:0 clamp(8px,2vw,32px)}.hs{width:min(var(--w),var(--wv))}';
    const stones = (w: string, wv: string): string =>
      [0, 1, 2, 3, 4, 5].map((i) => `.stone-${i}{--w:${w};--wv:${wv}}`).join('');
    expect(checkStoneRowFits(base + stones('126px', '13.86vw'))).toEqual([]);
    expect(checkStoneRowFits(base + stones('126px', '126px'))).toHaveLength(1);
    expect(checkStoneRowFits('.hs{width:100px}')).toHaveLength(1);
    expect(checkStoneRowFits(base.replace('min(var(--w),var(--wv))', 'var(--w)') + stones('128px', '1vw'))).toHaveLength(1);
  });
  it('requires 40px hit areas', () => {
    expect(checkMinHeights(GOOD_CSS)).toEqual([]);
    const bad = (css: string) => checkMinHeights(css, ['.btn']);
    expect(bad('.btn{min-height:39px}')).toHaveLength(1);
    expect(bad('.btn{min-height:2.4rem}')).toHaveLength(1);
    expect(bad('.btn{padding:1rem}')).toHaveLength(1);
    expect(bad(':root{--h:44px}.btn{min-height:var(--h)}')).toEqual([]);
    expect(bad('@media (max-width:760px){.btn{min-height:48px}}')).toHaveLength(1);
  });
  it('keeps content clickable', () => {
    expect(checkContentInteractive(GOOD_CSS)).toEqual([]);
    expect(checkContentInteractive('.stoneline{pointer-events:none}')).toHaveLength(1);
    expect(checkContentInteractive('.edge{pointer-events:none}')).toEqual([]);
  });
  it('accepts a faint over-text layer and composites contrast', () => {
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
