// Static checks of index.html and src/style.css (task 15.3).
// Validates: Requirements 2.1, 2.2, 2.3, 8.7, 8.8, 11.1, 11.2, 11.3, 11.4, 11.7,
// 12.12, 12.14, 12.15, 12.16, 12.17, 13.1, 13.3, 13.4.
// The full-stylesheet run of checkCss lives in src/test-support/web/css-check.test.ts;
// this file runs the individual checks and adds self-tests of the helpers.

import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkCsp, EXPECTED_CSP, parseCsp } from '../test-support/web/csp';
import {
  checkBackground,
  checkFxLayers,
  checkLayout,
  checkNarrowDemoLayout,
  checkPairs,
  checkReducedMotion,
  checkUrls,
  findStyleApiUse,
  parseCss,
  readPairs,
  stripCssComments,
} from '../test-support/web/css-scan';
import { parseHtml, scanHtml, textContent, type HtmlElement } from '../test-support/web/html-scan';
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

describe('index.html intro, title and description (ui-polish)', () => {
  // Validates: Requirements 1.1-1.9, 2.1-2.5, 10.1, 10.2.
  const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');

  function descendants(el: HtmlElement): HtmlElement[] {
    const out: HtmlElement[] = [];
    const walk = (e: HtmlElement): void => {
      for (const c of e.children) {
        if (c.kind === 'element') {
          out.push(c);
          walk(c);
        }
      }
    };
    walk(el);
    return out;
  }

  const metaDescriptions = doc.elements.filter(
    (e) => e.tag === 'meta' && (e.attrs['name'] ?? '').toLowerCase() === 'description',
  );

  it('has the exact title', () => {
    expect(facts.title).toBe('Exhume - read old floppy disks in your browser');
  });

  it('has exactly one meta description of 1 to 160 characters and no digit', () => {
    expect(metaDescriptions).toHaveLength(1);
    const content = metaDescriptions[0]!.attrs['content'] ?? '';
    expect(content.length).toBeGreaterThanOrEqual(1);
    expect(content.length).toBeLessThanOrEqual(160);
    expect(content).not.toMatch(/\d/);
  });

  it('has no REVENANT.OS in index.html, src/main.ts, src/style.css or non-test files under src/web', () => {
    const files: URL[] = [
      new URL('../../index.html', import.meta.url),
      new URL('../main.ts', import.meta.url),
      new URL('../style.css', import.meta.url),
    ];
    const webDir = new URL('./', import.meta.url);
    for (const rel of readdirSync(webDir, { recursive: true, encoding: 'utf8' })) {
      if (/\.(ts|css|html)$/.test(rel) && !/\.test\.ts$/.test(rel)) files.push(new URL(rel, webDir));
    }
    expect(files.length).toBeGreaterThan(3);
    for (const f of files) expect(readFileSync(f, 'utf8'), f.pathname).not.toContain('REVENANT.OS');
  });

  it('keeps the CSP equal to EXPECTED_CSP', () => {
    const parsed = parseCsp(facts.cspContent ?? '');
    const actual: Record<string, readonly string[]> = {};
    for (const d of parsed.directives) actual[d.name] = [...d.values].sort();
    const expected: Record<string, readonly string[]> = {};
    for (const [k, v] of Object.entries(EXPECTED_CSP)) expected[k] = [...v].sort();
    expect(actual).toEqual(expected);
  });

  it('puts the intro before the drop zone in document order', () => {
    expect(byId('intro').order).toBeLessThan(byId('drop-zone').order);
  });

  it('has a lead sentence naming old DOS floppy images and the browser', () => {
    const lead = descendants(byId('intro')).find((e) => e.tag === 'p' && (e.attrs['class'] ?? '').split(/\s+/).includes('intro-lead'));
    expect(lead).toBeDefined();
    const text = textContent(lead!);
    expect(text).toMatch(/DOS/);
    expect(text).toMatch(/floppy/i);
    expect(text).toMatch(/browser/i);
  });

  it('has five list items with the capability keywords', () => {
    const items = descendants(byId('intro')).filter((e) => e.tag === 'li');
    expect(items).toHaveLength(5);
    const texts = items.map(textContent);
    expect(texts[0]).toMatch(/WordStar/);
    expect(texts[0]).toMatch(/Markdown/);
    expect(texts[1]).toMatch(/dBase/);
    expect(texts[1]).toMatch(/CSV/);
    expect(texts[2]).toMatch(/PCX/);
    expect(texts[2]).toMatch(/PNG/);
    expect(texts[3]).toMatch(/text/i);
    expect(texts[4]).toMatch(/deleted/i);
  });

  it('has the privacy note inside the intro', () => {
    expect(descendants(byId('intro')).some((e) => e.attrs['id'] === 'privacy-note')).toBe(true);
  });

  it('has a repo link to the GitHub repository with GitHub in its accessible name', () => {
    const link = byId('repo-link');
    expect(link.tag).toBe('a');
    expect(link.attrs['href']).toBe('https://github.com/tsang326/exhume');
    expect(link.attrs['aria-label']).toContain('GitHub');
  });

  it('has no digit in the intro text', () => {
    expect(facts.textById['intro']).toBeDefined();
    expect(facts.textById['intro']).not.toMatch(/\d/);
  });

  it('backs each capability keyword with the README', () => {
    for (const word of ['WordStar', 'Markdown', 'dBase', 'CSV', 'PCX', 'PNG']) {
      expect(readme, word).toContain(word);
      expect(facts.textById['intro'], word).toContain(word);
    }
  });

  it('keeps the honesty note and the contract ids, including intro and repo-link', () => {
    expect(facts.textById['honesty-note']).toContain('andete/disk-peek');
    for (const id of [
      'fx-host', 'app', 'drop-zone', 'pick-button', 'file-input', 'status', 'cancel-button',
      'reopen-button', 'demo-slot', 'graveyard', 'preview-root', 'intro', 'repo-link',
    ]) {
      expect(doc.elements.filter((e) => e.attrs['id'] === id), `#${id}`).toHaveLength(1);
    }
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

  it('has a background that covers the whole page (ui-polish, Req 3.1 to 3.6, 10.1)', () => {
    expect(checkBackground(css)).toEqual([]);
  });

  it('spaces markdown preview paragraphs and lines (ui-polish, Req 6.2, 6.3, 10.1)', () => {
    const top = parseCss(css).filter((r) => r.context.length === 0);
    const declsOf = (selector: string) =>
      top.filter((r) => r.selector.split(',').map((s) => s.trim()).includes(selector)).flatMap((r) => r.decls);
    const last = (selector: string, prop: string): string | undefined =>
      declsOf(selector).filter((d) => d.prop === prop).at(-1)?.value.trim();

    // margin-bottom from the longhand or the 1 to 4 value `margin` shorthand; the later declaration wins.
    const pDecls = declsOf('.preview-markdown p').filter((d) => d.prop === 'margin' || d.prop === 'margin-bottom');
    const winner = pDecls.at(-1);
    expect(winner, '.preview-markdown p margin').toBeDefined();
    let bottom = winner!.value.trim();
    if (winner!.prop === 'margin') {
      const parts = bottom.split(/\s+/);
      bottom = parts.length === 1 ? parts[0]! : parts.length === 2 ? parts[0]! : parts[2]!;
    }
    const m = /^(\d*\.?\d+)em$/.exec(bottom);
    expect(m, `margin-bottom "${bottom}" in em`).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(0.75);

    const lh = last('.preview-markdown', 'line-height');
    expect(lh, '.preview-markdown line-height').toBeDefined();
    expect(/^\d*\.?\d+$/.test(lh!), `unitless line-height "${lh}"`).toBe(true);
    expect(Number(lh)).toBeGreaterThanOrEqual(1.4);
  });

  it('gives recovered, partial and lost three different state glyphs (ui-polish, Req 7.2, 7.4, 10.1)', () => {
    const top = parseCss(css).filter((r) => r.context.length === 0);
    const glyph = (state: string): string | undefined =>
      top
        .filter((r) => r.selector.split(',').map((s) => s.trim()).includes(`.grave--${state} .grave-state::before`))
        .flatMap((r) => r.decls)
        .filter((d) => d.prop === 'content')
        .at(-1)
        ?.value.trim();
    const glyphs = ['recovered', 'partial', 'lost'].map((s) => glyph(s));
    for (const g of glyphs) {
      expect(g).toBeDefined();
      expect(g).not.toBe('');
      expect(g).not.toBe('none');
    }
    expect(new Set(glyphs).size).toBe(3);
  });

  it('makes the open-grave icon at least 5rem by 3.5rem (ui-polish, Req 7.1, 10.1)', () => {
    const top = parseCss(css).filter((r) => r.context.length === 0);
    const decls = top
      .filter((r) => r.selector.split(',').map((s) => s.trim()).includes('.grave--open-grave .grave-art'))
      .flatMap((r) => r.decls);
    const rem = (prop: string): number => {
      const v = decls.filter((d) => d.prop === prop).at(-1)?.value.trim();
      const m = /^(\d*\.?\d+)rem$/.exec(v ?? '');
      expect(m, `${prop} "${v}" in rem`).not.toBeNull();
      return Number(m![1]);
    };
    expect(rem('width')).toBeGreaterThanOrEqual(5);
    expect(rem('height')).toBeGreaterThanOrEqual(3.5);
  });

  it('declares the --pair-grave-art-ui pair and checks it (ui-polish, Req 7.1, 10.1)', () => {
    const pair = readPairs(css).find((p) => JSON.stringify(p).includes('grave-art-ui'));
    expect(pair, 'grave-art-ui pair read by readPairs').toBeDefined();
    expect(css).toMatch(/--pair-grave-art-ui-fg:\s*#[0-9a-fA-F]{6}/);
    expect(css).toMatch(/--pair-grave-art-ui-bg:\s*#[0-9a-fA-F]{6}/);
    expect(checkPairs(css)).toEqual([]);
    // A low-contrast replacement of the fg must be reported, so the pair really is checked.
    const broken = css.replace(/--pair-grave-art-ui-fg:\s*#[0-9a-fA-F]{6}/, '--pair-grave-art-ui-fg: #151d1f');
    expect(checkPairs(broken)).not.toEqual([]);
  });

  it('has rules for graveyard-guidance, graveyard-stats and grave-hint (ui-polish, Req 7.10, 10.1)', () => {
    const cssText = stripCssComments(css);
    for (const c of ['graveyard-guidance', 'graveyard-stats', 'grave-hint']) {
      expect(new RegExp(`\\.${c}(?![A-Za-z0-9_-])`).test(cssText), `.${c}`).toBe(true);
    }
  });

  it('keeps the narrow demo layout compact (ui-polish, Req 5.7, 5.8, 10.1)', () => {
    expect(checkNarrowDemoLayout(css)).toEqual([]);
  });

  it('reports a bad narrow demo layout sample (ui-polish, Req 5.7, 5.8)', () => {
    const good =
      '@media (max-width: 600px){.demo-slot-list{grid-template-columns:1fr}' +
      '.demo-slot-description{-webkit-line-clamp:2;line-clamp:2}.demo-slot-button{padding:0.5rem}}';
    expect(checkNarrowDemoLayout(good)).toEqual([]);
    expect(checkNarrowDemoLayout(good.replace('1fr', '1fr 1fr')).length).toBeGreaterThan(0);
    expect(checkNarrowDemoLayout(good.replace('}}', ';display:none}}')).length).toBeGreaterThan(0);
    expect(checkNarrowDemoLayout('.demo-slot-list{grid-template-columns:1fr}').length).toBeGreaterThan(0);
  });

  it('marks the pressed demo slot by border style and added words, not colour alone (ui-polish, Req 8.7, 10.1)', () => {
    const top = parseCss(css).filter((r) => r.context.length === 0);
    const declsOf = (selector: string) =>
      top.filter((r) => r.selector.split(',').map((s) => s.trim()).includes(selector)).flatMap((r) => r.decls);
    const pressed = declsOf(".demo-slot-button[aria-pressed='true']");
    expect(pressed.filter((d) => d.prop === 'border-style' || d.prop === 'border-width').length).toBeGreaterThan(0);
    expect(pressed.filter((d) => d.prop === 'border-style').at(-1)?.value.trim()).toBe('double');
    const content = declsOf(".demo-slot-button[aria-pressed='true'] .demo-slot-title::after")
      .filter((d) => d.prop === 'content')
      .at(-1)
      ?.value.trim();
    expect(content).toBeDefined();
    expect(content).not.toBe('');
    expect(content).not.toBe('none');
    expect(content).not.toMatch(/^(''|"")$/);
    expect(content).toMatch(/[A-Za-z]{2,}/);
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

describe('source and dependency scans (ui-polish)', () => {
  // Validates: Requirements 6.4, 7.8, 10.6, 10.7.
  const webDir = new URL('./', import.meta.url);

  /** Drops block comments and whole-line or trailing `//` comments (not inside `://`). */
  function stripTsComments(src: string): string {
    return src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
      .join('\n');
  }

  const sources: { rel: string; code: string }[] = [];
  for (const rel of readdirSync(webDir, { recursive: true, encoding: 'utf8' })) {
    const norm = rel.split('\\').join('/');
    if (!norm.endsWith('.ts') || norm.endsWith('.d.ts') || /\.test\.ts$/.test(norm)) continue;
    sources.push({ rel: norm, code: stripTsComments(readFileSync(new URL(norm, webDir), 'utf8')) });
  }

  it('finds the non-test web sources', () => {
    expect(sources.length).toBeGreaterThan(10);
    expect(sources.some((s) => s.rel === 'demos.ts')).toBe(true);
  });

  it('uses no innerHTML, outerHTML or insertAdjacentHTML in non-test web sources', () => {
    const hits = sources.filter((s) => /\b(innerHTML|outerHTML|insertAdjacentHTML)\b/.test(s.code)).map((s) => s.rel);
    expect(hits).toEqual([]);
  });

  it('uses fetch only in demos.ts among non-test web sources', () => {
    const hits = sources.filter((s) => /\bfetch\b/.test(s.code)).map((s) => s.rel);
    expect(hits).toEqual(['demos.ts']);
  });

  it('keeps the package.json dependency keys unchanged and has no runtime dependencies', () => {
    const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {}).sort()).toEqual([]);
    expect(Object.keys(pkg.devDependencies ?? {}).sort()).toEqual(
      ['@types/node', 'fast-check', 'happy-dom', 'typescript', 'vite', 'vitest'],
    );
  });

  it('the comment stripper hides comment-only mentions and keeps code', () => {
    expect(/\bfetch\b/.test(stripTsComments('// fetch\n/* fetch */ const a = 1;'))).toBe(false);
    expect(/\bfetch\b/.test(stripTsComments('const r = fetch(u);'))).toBe(true);
    expect(/\binnerHTML\b/.test(stripTsComments('el.innerHTML = x; // ok'))).toBe(true);
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

  it('reports a viewport-tall gradient on #fx-host and a missing html background', () => {
    const good =
      ':root{--pair-body-bg:#0b0f10}html{background:var(--pair-body-bg)}' +
      'body{position:relative;min-height:100dvh}' +
      'body::before{content:"";position:absolute;inset:0;pointer-events:none;z-index:0;' +
      'background:radial-gradient(ellipse 900px 600px at 50% 0,rgba(1,2,3,0.4),transparent 70%)}' +
      '#fx-host{position:fixed;pointer-events:none}.content{position:relative;z-index:10}';
    expect(checkBackground(good)).toEqual([]);

    const tall = good.replace(
      '#fx-host{',
      '#fx-host{height:100vh;background:radial-gradient(ellipse 100vw 100vh at 50% 0,red,transparent);',
    );
    expect(checkBackground(tall).some((p) => /#fx-host/.test(p.message))).toBe(true);

    const noHtml = good.replace('html{background:var(--pair-body-bg)}', '');
    expect(checkBackground(noHtml).some((p) => /html/.test(p.message))).toBe(true);
  });

  it('reads at-rule context for reduced motion', () => {
    const ok = '@media (prefers-reduced-motion: reduce){*{animation-duration:0s;transition-duration:0s}}';
    expect(parseCss(ok)[0]!.context[0]).toMatch(/prefers-reduced-motion/);
    expect(checkReducedMotion(ok)).toEqual([]);
  });
});
