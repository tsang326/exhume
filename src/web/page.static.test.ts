// Static checks of index.html and src/style.css for the page redesign (task 7.1).
// Validates: Requirements 1.1-1.9, 2.1-2.4, 3.1-3.8, 4.1-4.13, 6.1-6.6, 11.1-11.7, 12.1-12.5, 13.1-13.6.
// The full-stylesheet run of checkCss lives in src/test-support/web/css-check.test.ts; this file runs the
// individual checks against the page. Rendered layout cannot be verified here (no layout engine).

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkCsp, EXPECTED_CSP, parseCsp } from '../test-support/web/csp';
import {
  checkAnimatedProperties,
  checkContentInteractive,
  checkFontFamilies,
  checkHiddenStartStates,
  checkMinHeights,
  checkNarrowCardList,
  checkNarrowStoneDepth,
  checkNarrowQuery,
  checkPairs,
  checkReducedMotion,
  checkStoneRowFits,
  checkStonesVisible,
  checkStrata,
  checkUrls,
  findStyleApiUse,
  parseCss,
  readPairs,
  stripCssComments,
} from '../test-support/web/css-scan';
import { parseHtml, scanHtml, textContent, type HtmlElement } from '../test-support/web/html-scan';
import { scanPhrasesInHtml, scanSinks } from '../test-support/web/scan';
import { NARROW_QUERY } from './logic/layout';

const root = new URL('../../', import.meta.url);
const html = readFileSync(new URL('index.html', root), 'utf8');
const css = readFileSync(new URL('src/style.css', root), 'utf8');
const readme = readFileSync(new URL('README.md', root), 'utf8');
const facts = scanHtml(html);
const doc = parseHtml(html);

/** The CSP as captured before the redesign; it must stay byte for byte. */
const CAPTURED_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";

const RETAINED_IDS = [
  'app', 'drop-zone', 'pick-button', 'file-input', 'status', 'cancel-button', 'reopen-button',
  'demo-slot', 'graveyard', 'privacy-note', 'honesty-note', 'repo-link',
];
const ADDED_IDS = [
  'hero-heading', 'demo-link', 'headstones', 'yard', 'yard-heading', 'preview', 'bar-section',
  'bar-heading', 'disk-bar', 'band', 'formats', 'foot', 'pick-button-footer',
];
const RETIRED_IDS = ['intro', 'fx-host', 'preview-root'];

function byId(id: string): HtmlElement {
  const el = doc.elements.find((e) => e.attrs['id'] === id);
  if (el === undefined) throw new Error(`missing #${id}`);
  return el;
}

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

const hasClass = (el: HtmlElement, c: string): boolean => (el.attrs['class'] ?? '').split(/\s+/).includes(c);
const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Drops block comments and whole-line or trailing `//` comments (not inside `://`). */
function stripTsComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:])\/\/.*$/, '$1'))
    .join('\n');
}

const webDir = new URL('./', import.meta.url);
const sources: { rel: string; code: string }[] = [];
for (const rel of readdirSync(webDir, { recursive: true, encoding: 'utf8' })) {
  const p = rel.split('\\').join('/');
  if (!p.endsWith('.ts') || p.endsWith('.d.ts') || /\.test\.ts$/.test(p)) continue;
  sources.push({ rel: p, code: readFileSync(new URL(p, webDir), 'utf8') });
}

describe('index.html safety (Req 1)', () => {
  it('has exactly one CSP meta, before any script, link or style', () => {
    expect(facts.cspMetaCount).toBe(1);
    expect(facts.cspBeforeResources).toBe(true);
  });

  it('keeps the CSP equal to the captured string and passes checkCsp', () => {
    expect(facts.cspContent).toBe(CAPTURED_CSP);
    expect(checkCsp(facts.cspContent!)).toEqual([]);
    const parsed = parseCsp(facts.cspContent!);
    expect(parsed.duplicates).toEqual([]);
    expect(parsed.directives.map((d) => d.name).sort()).toEqual(Object.keys(EXPECTED_CSP).sort());
    expect(facts.cspContent).not.toMatch(/unsafe-|data:|\*/i);
  });

  it('has no inline style, script or on* attribute', () => {
    expect(facts.inlineScripts).toEqual([]);
    expect(facts.onAttributes).toEqual([]);
    expect(facts.styleAttributes).toEqual([]);
    expect(facts.styleElementCount).toBe(0);
  });

  it('loads only the module entry script, and every src and href is same-origin or an allowed host', () => {
    expect(facts.scripts.map((s) => s.attrs['src'])).toEqual(['/src/main.ts']);
    for (const link of facts.links) expect(link['href'] ?? '').not.toMatch(/^([a-z][a-z0-9+.-]*:|\/\/)/i);
    const allowed = new Set(['https://github.com/tsang326/exhume', 'https://github.com/andete/disk-peek']);
    for (const el of doc.elements) {
      const src = el.attrs['src'];
      if (src !== undefined) expect(src, `${el.tag} src`).toMatch(/^\/(?!\/)/);
      const href = el.attrs['href'];
      if (href === undefined || href.startsWith('#')) continue;
      if (el.tag === 'a' && /^[a-z][a-z0-9+.-]*:/i.test(href)) {
        expect(allowed.has(href), `anchor ${href}`).toBe(true);
      } else if (el.tag === 'use') {
        expect(href).toMatch(/^#/);
      } else {
        expect(href, `${el.tag} href`).not.toMatch(/^([a-z][a-z0-9+.-]*:|\/\/)/i);
      }
    }
  });

  it('puts no file under public/fonts', () => {
    expect(existsSync(new URL('public/fonts', root))).toBe(false);
  });

  it('keeps the package.json dependency keys unchanged and has no runtime dependencies', () => {
    const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies ?? {})).toEqual([]);
    expect(Object.keys(pkg.devDependencies ?? {}).sort()).toEqual(
      ['@types/node', 'fast-check', 'happy-dom', 'typescript', 'vite', 'vitest'],
    );
  });

  it('has no forbidden phrase in the visible text', () => {
    expect(scanPhrasesInHtml('index.html', html)).toEqual([]);
  });

  it('has one same-origin SVG favicon link to a file that exists', () => {
    const icons = doc.elements.filter((e) => e.tag === 'link' && e.attrs['rel'] === 'icon');
    expect(icons).toHaveLength(1);
    const href = icons[0]!.attrs['href'] ?? '';
    expect(icons[0]!.attrs['type']).toBe('image/svg+xml');
    expect(href).toMatch(/^\/(?!\/)/);
    expect(href).not.toMatch(/^[a-z][a-z0-9+.-]*:/i);
    expect(existsSync(new URL(href.slice(1), root))).toBe(true);
  });

  it('gives every external link rel="noopener noreferrer"', () => {
    const external = doc.elements.filter((e) => e.tag === 'a' && /^https:/.test(e.attrs['href'] ?? ''));
    expect(external.length).toBeGreaterThanOrEqual(3);
    for (const a of external) expect(a.attrs['rel'], a.attrs['href']).toBe('noopener noreferrer');
  });
});

describe('element contract (Req 2)', () => {
  const contract = doc.comments.find((c) => /Element contract/i.test(c)) ?? '';

  it('has the contract comment', () => {
    expect(contract).not.toBe('');
  });

  it('has each retained and added id exactly once, and lists it in the contract comment', () => {
    for (const id of [...RETAINED_IDS, ...ADDED_IDS]) {
      expect(doc.elements.filter((e) => e.attrs['id'] === id), `#${id}`).toHaveLength(1);
      expect(contract, `#${id} in contract`).toContain(`#${id}`);
    }
  });

  it('has no retired id in the markup, records each as retired, and no code looks it up', () => {
    const retiredLine = contract.slice(contract.indexOf('Retired'));
    for (const id of RETIRED_IDS) {
      expect(doc.elements.filter((e) => e.attrs['id'] === id), `#${id}`).toHaveLength(0);
      expect(retiredLine, `#${id} retired`).toContain(id);
      for (const s of sources) {
        const code = stripTsComments(s.code);
        const lookup = new RegExp(`getElementById\\(\\s*['"\`]${id}['"\`]|querySelector(?:All)?\\(\\s*['"\`]#${id}\\b|['"\`]#${id}['"\`]`);
        expect(lookup.test(code), `${s.rel} looks up #${id}`).toBe(false);
      }
    }
  });

  it('keeps the status region attributes', () => {
    const status = byId('status');
    expect(status.attrs['role']).toBe('status');
    expect(status.attrs['aria-live']).toBe('polite');
    expect(status.attrs['aria-atomic']).toBe('true');
  });

  it('has a hidden file input without accept, and hidden cancel and reopen buttons', () => {
    const input = byId('file-input');
    expect(input.tag).toBe('input');
    expect(input.attrs['type']).toBe('file');
    expect(input.attrs['hidden']).toBeDefined();
    expect(input.attrs['accept']).toBeUndefined();
    for (const id of ['cancel-button', 'reopen-button']) {
      expect(byId(id).tag).toBe('button');
      expect(byId(id).attrs['hidden']).toBeDefined();
    }
  });

  it('has no role="dialog", aria-modal or inert in the markup or the web sources', () => {
    for (const el of doc.elements) {
      expect(el.attrs['role']).not.toBe('dialog');
      expect(el.attrs['aria-modal']).toBeUndefined();
      expect(el.attrs['inert']).toBeUndefined();
    }
    for (const s of sources) {
      const code = stripTsComments(s.code);
      expect(/role['"]?\s*[:=,]\s*['"]dialog['"]|aria-modal|\binert\b/.test(code), s.rel).toBe(false);
    }
  });
});

describe('hero, nav, footer and metadata (Req 4, 11, 13.1)', () => {
  it('has lang, one h1, one main, and a heading order without skipped levels', () => {
    expect(facts.lang).toBeTruthy();
    expect(facts.h1Count).toBe(1);
    expect(doc.elements.filter((e) => e.tag === 'main')).toHaveLength(1);
    let prev = 0;
    for (const el of doc.elements) {
      const m = /^h([1-6])$/.exec(el.tag);
      if (m === null) continue;
      const level = Number(m[1]);
      expect(level, `<${el.tag}> after h${prev}`).toBeLessThanOrEqual(prev + 1);
      prev = level;
    }
  });

  it('has the headline "Dig up lost files." with a decorative inline image', () => {
    const h1 = byId('hero-heading');
    expect(h1.tag).toBe('h1');
    expect(norm(textContent(h1))).toBe('Dig up lost files.');
    const imgs = descendants(h1).filter((e) => e.tag === 'img');
    expect(imgs).toHaveLength(1);
    expect(imgs[0]!.attrs['alt']).toBe('');
    const words = descendants(h1).filter((e) => hasClass(e, 'w')).map((e) => norm(textContent(e)));
    expect(words).toEqual(['Dig up', 'lost files.']);
  });

  it('has the supporting sentence, the open button, the demo link and no capability list in the hero', () => {
    const hero = byId('drop-zone');
    const say = descendants(hero).find((e) => hasClass(e, 'say'));
    expect(say).toBeDefined();
    const sentence = norm(textContent(say!));
    expect(sentence).toMatch(/1980s DOS floppy images/);
    expect(sentence).toMatch(/browser/);
    expect(sentence).toMatch(/deleted files/);
    expect(facts.textById['pick-button']).toBe('Open a disk image');
    expect(byId('pick-button').tag).toBe('button');
    const demo = byId('demo-link');
    expect(norm(textContent(demo))).toBe('or try a demo disk');
    expect(demo.attrs['href']).toBe('#yard');
    expect(descendants(hero).filter((e) => e.tag === 'ul' || e.tag === 'ol' || e.tag === 'li')).toEqual([]);
  });

  it('has the extension line with all five extensions and the size limit', () => {
    const exts = descendants(byId('drop-zone')).find((e) => hasClass(e, 'exts'));
    expect(exts).toBeDefined();
    const text = norm(textContent(exts!));
    for (const ext of ['.img', '.ima', '.vfd', '.flp', '.dsk']) expect(text).toContain(ext);
    expect(text).toContain('up to 2.88 MB');
  });

  it('has the privacy note inside the hero, 1 to 140 characters', () => {
    const text = facts.textById['privacy-note'];
    expect(text).toBe('Your files stay in this browser. Nothing is uploaded.');
    expect(text!.length).toBeLessThanOrEqual(140);
    expect(descendants(byId('drop-zone')).some((e) => e.attrs['id'] === 'privacy-note')).toBe(true);
  });

  it('has the nav with the wordmark and four anchors that resolve', () => {
    const nav = doc.elements.find((e) => e.tag === 'header' && hasClass(e, 'nav'));
    expect(nav).toBeDefined();
    const anchors = descendants(nav!).filter((e) => e.tag === 'a');
    expect(anchors.map((a) => norm(textContent(a)))).toEqual(['Exhume', 'Demo disks', 'How it works', 'Formats', 'GitHub']);
    expect(norm(textContent(anchors[0]!))).toContain('Exhume');
    for (const a of anchors) {
      const href = a.attrs['href']!;
      if (href.startsWith('#')) {
        expect(doc.elements.some((e) => e.attrs['id'] === href.slice(1)), href).toBe(true);
      }
    }
    const repo = byId('repo-link');
    expect(repo.attrs['href']).toBe('https://github.com/tsang326/exhume');
    expect(repo.attrs['aria-label']).toContain('GitHub');
  });

  it('has the exact title and one meta description of 1 to 160 characters', () => {
    expect(facts.title).toBe('Exhume - read old floppy disks in your browser');
    const metas = doc.elements.filter((e) => e.tag === 'meta' && (e.attrs['name'] ?? '').toLowerCase() === 'description');
    expect(metas).toHaveLength(1);
    const content = metas[0]!.attrs['content'] ?? '';
    expect(content.length).toBeGreaterThanOrEqual(1);
    expect(content.length).toBeLessThanOrEqual(160);
  });

  it('finds every digit figure of the hero and the meta description in the README', () => {
    const hero = norm(textContent(byId('drop-zone')));
    const meta = doc.elements.find((e) => e.tag === 'meta' && e.attrs['name'] === 'description')!.attrs['content'] ?? '';
    const figures = [...hero.matchAll(/\d+(?:\.\d+)?s?/g), ...meta.matchAll(/\d+(?:\.\d+)?s?/g)].map((m) => m[0]);
    expect(figures.length).toBeGreaterThan(0);
    for (const f of figures) expect(readme, f).toContain(f);
  });

  it('has the footer invitation, second open control, links, Kiroween text and photo credit', () => {
    const foot = byId('foot');
    const inside = descendants(foot);
    expect(inside.some((e) => e.tag === 'h2' && norm(textContent(e)) === 'Found an old disk in a drawer?')).toBe(true);
    expect(byId('pick-button-footer').tag).toBe('button');
    const links = inside.filter((e) => e.tag === 'a');
    const link = (name: string): HtmlElement | undefined => links.find((a) => norm(textContent(a)) === name);
    expect(link('Source on GitHub')?.attrs['href']).toBe('https://github.com/tsang326/exhume');
    expect(link('Prior art: disk-peek')?.attrs['href']).toBe('https://github.com/andete/disk-peek');
    expect(link('Kiroween 2026')).toBeUndefined();
    expect(norm(textContent(foot))).toContain('Kiroween 2026');
    const credits = JSON.parse(readFileSync(new URL('docs/design/redesign/assets/credits.json', root), 'utf8')) as unknown;
    const creditText = JSON.stringify(credits);
    const footText = norm(textContent(foot));
    expect(footText).toContain('“Floppy disk 2009 G1”');
    expect(footText).toContain('George Chernilevsky');
    expect(footText).toContain('public domain');
    expect(footText).toContain('Wikimedia Commons');
    expect(creditText).toContain('George Chernilevsky');
    expect(footText).toContain('Instrument Serif');
    expect(footText).toContain('Hanken Grotesk');
    expect(footText).toContain('SIL Open Font License 1.1');
  });

  it('has the honesty note naming andete/disk-peek, and no "first" claim', () => {
    const text = facts.textById['honesty-note'];
    expect(text).toContain('andete/disk-peek');
    expect(text!.length).toBeLessThanOrEqual(160);
    expect(facts.visibleText).toContain(text!);
  });

  it('hides the buried name from assistive technology', () => {
    const buried = doc.elements.find((e) => hasClass(e, 'buried'));
    expect(buried?.attrs['aria-hidden']).toBe('true');
  });
});

describe('fonts and palette (Req 3)', () => {
  const fontFaces = parseCss(css).filter((r) => r.selector.trim() === '@font-face');

  it('ships the two font files and their OFL texts, and no italic file', () => {
    const dir = new URL('src/assets/fonts/', root);
    const files = readdirSync(dir).sort();
    expect(files).toEqual([
      'OFL-hanken-grotesk.txt',
      'OFL-instrument-serif.txt',
      'hanken-grotesk-latin-wght-normal.woff2',
      'instrument-serif-latin-400-normal.woff2',
    ]);
    expect(files.filter((f) => /italic/i.test(f))).toEqual([]);
    for (const f of files.filter((n) => n.endsWith('.txt'))) {
      expect(readFileSync(new URL(f, dir), 'utf8')).toMatch(/SIL OPEN FONT LICENSE/i);
    }
  });

  it('declares two @font-face rules with swap, normal style and woff2 sources', () => {
    expect(fontFaces).toHaveLength(2);
    const names = fontFaces.map((r) => r.decls.find((d) => d.prop === 'font-family')!.value.replace(/['"]/g, ''));
    expect(names.sort()).toEqual(['Hanken Grotesk', 'Instrument Serif']);
    for (const r of fontFaces) {
      expect(r.decls.find((d) => d.prop === 'font-display')?.value).toBe('swap');
      expect(r.decls.find((d) => d.prop === 'font-style')?.value ?? 'normal').toBe('normal');
      expect(r.decls.find((d) => d.prop === 'src')?.value).toMatch(/\.\/assets\/fonts\/[\w.-]+\.woff2/);
    }
    expect(stripCssComments(css)).not.toMatch(/font-style\s*:\s*italic/i);
  });

  it('defines the Palette_Tokens with the mockup values', () => {
    const root0 = parseCss(css).filter((r) => r.selector.trim() === ':root').flatMap((r) => r.decls);
    const token = (name: string): string | undefined => root0.filter((d) => d.prop === name).at(-1)?.value.toLowerCase();
    const expected: Record<string, string> = {
      '--bg': '#0b0f10',
      '--surface': '#1b1915',
      '--surface-2': '#26231d',
      '--soil1': '#12110e',
      '--soil2': '#16130f',
      '--soil3': '#0e0c0a',
      '--ink': '#e6e6e1',
      '--muted': '#a9b3a6',
      '--accent': '#ffbf5e',
      '--field': '#e4e4df',
      '--field-ink': '#121514',
      '--field-muted': '#4c524d',
      '--ok': '#9ad49c',
      '--part': '#e8b65a',
      '--lost': '#ee8b72',
      '--alive': '#d4cdb9',
    };
    for (const [name, value] of Object.entries(expected)) expect(token(name), name).toBe(value);
    expect(token('--sans') ?? '').toContain('hanken grotesk');
    expect(token('--serif') ?? '').toContain('instrument serif');
  });

  it('declares every Contrast_Pair of the design, and all of them pass', () => {
    const required = [
      'body', 'body-soil', 'body-surface', 'body-surface2',
      'muted', 'muted-soil', 'muted-soil2', 'muted-soil3', 'muted-surface', 'muted-surface2',
      'accent', 'button',
      'field', 'field-proof', 'field-muted', 'field-muted-proof', 'field-cut', 'field-accent',
      'state-ok-soil', 'state-part-soil', 'state-lost-soil', 'state-alive-soil',
      'state-ok-surface2', 'state-part-surface2', 'state-lost-surface2', 'state-alive-surface2',
      'state-part-warn',
      'hs-alive', 'hs-recovered', 'hs-partial', 'hs-lost', 'hs-lost-border-ui',
      'hs-back', 'hs-back-recovered',
      'seg-alive', 'seg-recovered', 'seg-partial', 'seg-lost',
      'focus-ui-ground', 'focus-ui-panel', 'focus-ui-field', 'border-ui', 'buried-ui',
    ];
    const pairs = readPairs(css);
    const ids = new Set(pairs.map((p) => p.id));
    for (const id of required) expect(ids.has(id), `pair ${id} declared`).toBe(true);
    for (const p of pairs) {
      expect(p.ratio, `pair ${p.id} has literal hex colours`).not.toBeNull();
      expect(p.ratio!, `pair ${p.id}`).toBeGreaterThanOrEqual(p.min);
    }
    expect(checkPairs(css)).toEqual([]);
  });

  it('uses the serif and mono faces only where allowed', () => {
    expect(checkFontFamilies(css)).toEqual([]);
  });
});

describe('strata, motion and layout rules (Req 5.8, 6, 12, 13)', () => {
  it('passes checkStrata over the stylesheet and the markup', () => {
    expect(checkStrata(css, html)).toEqual([]);
  });

  it('animates only opacity, transform and clip-path, with hidden starts only in from or under .js', () => {
    expect(checkAnimatedProperties(css)).toEqual([]);
    expect(checkHiddenStartStates(css)).toEqual([]);
  });

  it('has a reduced-motion block', () => {
    expect(checkReducedMotion(css)).toEqual([]);
  });

  it('keeps content interactive and never hides a headstone', () => {
    expect(checkStonesVisible(css)).toEqual([]);
    expect(checkContentInteractive(css)).toEqual([]);
  });

  it('fits six headstones and five gaps in one row at 761px and 1180px', () => {
    expect(checkStoneRowFits(css)).toEqual([]);
  });
  it('narrow block: two rows of three, back row at 85% behind the front row, labels clear (Task 12)', () => {
    expect(checkNarrowStoneDepth(css)).toEqual([]);
    expect(checkStonesVisible(css)).toEqual([]);
    const pairs = readPairs(css);
    for (const id of ['hs-back', 'hs-back-recovered']) {
      const p = pairs.find((x) => x.id === id);
      expect(p?.ratio, `pair ${id}`).not.toBeNull();
      expect(p!.ratio!, `pair ${id}`).toBeGreaterThanOrEqual(4.5);
    }
    const narrow = stripCssComments(css).slice(stripCssComments(css).indexOf('@media (max-width: 760px)'));
    expect(narrow).toContain('var(--pair-hs-back-fg)');
    expect(narrow).toContain('var(--pair-hs-back-bg)');
    expect(narrow).toContain('var(--pair-hs-back-recovered-bg)');
    expect(narrow).toMatch(/--back-scale:\s*0\.85/);
  });
  it('gives hit targets a min-height of at least 40px', () => {
    expect(checkMinHeights(css)).toEqual([]);
  });

  it('has the one-column card list in the narrow block, and NARROW_QUERY equals the CSS narrow width', () => {
    expect(checkNarrowQuery(css, NARROW_QUERY)).toEqual([]);
    expect(checkNarrowCardList(css)).toEqual([]);
  });

  it('has the headstone row as a wrapping flex row with a dashed, sunk partial stone', () => {
    const top = parseCss(css).filter((r) => r.context.length === 0);
    const decls = (sel: string) =>
      top.filter((r) => r.selector.split(',').map((s) => s.trim()).includes(sel)).flatMap((r) => r.decls);
    const last = (sel: string, prop: string): string | undefined =>
      decls(sel).filter((d) => d.prop === prop).at(-1)?.value.trim();
    expect(last('.stoneline', 'display')).toBe('flex');
    expect(last('.stoneline', 'flex-wrap')).toBe('wrap');
    expect(last('.hs--partial', 'border')).toMatch(/dashed/);
    const sunk = (sel: string): number => {
      const v = last(sel, '--sink');
      return v === undefined ? 0 : parseFloat(v);
    };
    expect(sunk('.stone-3')).toBeGreaterThan(0);
    expect(last('.hs.hs--recovered', 'animation')).toBeDefined();
  });

  it('has no external or data: url(), no style-API text and no style attribute in the CSS', () => {
    expect(checkUrls(css)).toEqual([]);
    expect(findStyleApiUse(css)).toEqual([]);
  });

  it('gives alive, partial and lost rows three different stone shapes besides colour (Req 8.5)', () => {
    const top = parseCss(css).filter((r) => r.context.length === 0);
    const shape = (state: string): string =>
      top
        .filter((r) => r.selector.split(',').map((s) => s.trim()).includes(`.grave--${state} .grave-art`))
        .flatMap((r) => r.decls)
        .filter((d) => ['border', 'border-bottom', 'border-radius', 'clip-path', 'height'].includes(d.prop))
        .map((d) => `${d.prop}:${d.value.replace(/var\([^)]*\)/g, 'c')}`)
        .join(';');
    const shapes = ['alive', 'partial', 'lost'].map(shape);
    expect(shape('partial')).toMatch(/dashed/);
    expect(shape('lost')).toMatch(/dashed/);
    expect(shape('lost')).toMatch(/clip-path/);
    expect(new Set(shapes).size).toBe(3);
  });

  it('styles every static class that the DOM modules create with h()', () => {
    const dir = new URL('./dom/', import.meta.url);
    const used = new Set<string>();
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.ts') || f.endsWith('.test.ts')) continue;
      const src = readFileSync(new URL(f, dir), 'utf8');
      for (const m of src.matchAll(/\bclass:\s*'([^']+)'/g)) {
        for (const c of m[1]!.split(/\s+/)) if (c !== '') used.add(c);
      }
    }
    expect(used.size).toBeGreaterThan(10);
    const cssText = stripCssComments(css);
    const missing = [...used].filter((c) => !new RegExp(`\\.${c}(?![A-Za-z0-9_-])`).test(cssText)).sort();
    expect(missing).toEqual([]);
  });
});

describe('web source scans (Req 1.6, 1.8, 1.9)', () => {
  it('finds the non-test web sources', () => {
    expect(sources.length).toBeGreaterThan(10);
    expect(sources.some((s) => s.rel === 'demos.ts')).toBe(true);
  });

  it('uses no HTML sink in non-test web sources', () => {
    const hits = sources.flatMap((s) => scanSinks(`src/web/${s.rel}`, s.code));
    expect(hits).toEqual([]);
  });

  it('uses fetch only in demos.ts', () => {
    const hits = sources.filter((s) => /\bfetch\b/.test(stripTsComments(s.code))).map((s) => s.rel);
    expect(hits).toEqual(['demos.ts']);
  });

  it('references no retired effects, focus-trap or focus-order module', () => {
    for (const s of sources) {
      expect(/effects-math|\/effects['"]|focus-trap|focus-order/.test(stripTsComments(s.code)), s.rel).toBe(false);
    }
    expect(sources.filter((s) => s.rel.includes('effects') || s.rel.includes('focus-'))).toEqual([]);
  });
});
