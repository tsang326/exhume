// Test-only CSS checks for the page test: contrast pairs, strata, motion, fonts, layout rules,
// reduced motion, external urls. `checkStrata` also reads the markup and is run separately.
// A flat, forgiving CSS reader, not a full parser (no nesting support; an inner rule is read as
// its own rule).


import { compositeOver, contrastRatio, parseHexColor, type Rgb } from '../../web/logic/contrast';
import { parseHtml } from './html-scan';


export interface CssDecl {
  readonly prop: string;
  readonly value: string;
}

export interface CssRule {
  readonly selector: string;
  /** Preludes of the enclosing at-rules, outermost first (e.g. `@media (prefers-reduced-motion: reduce)`). */
  readonly context: readonly string[];
  readonly decls: readonly CssDecl[];
}

export interface CssProblem {
  readonly check: string;
  readonly message: string;
}

/** Remove `/* ... *\/` comments, leaving string contents alone. */
export function stripCssComments(css: string): string {
  let out = '';
  let i = 0;
  while (i < css.length) {
    const c = css[i]!;
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== c) j += css[j] === '\\' ? 2 : 1;
      out += css.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end < 0 ? css.length : end + 2;
      out += ' ';
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const GROUP_AT = /^@(media|supports|layer|container|document)\b/i;
const KEYFRAMES_AT = /^@(-\w+-)?keyframes\b/i;

function parseDecl(text: string): CssDecl | null {
  const colon = text.indexOf(':');
  if (colon < 0) return null;
  const rawProp = text.slice(0, colon).trim();
  if (rawProp === '') return null;
  const prop = rawProp.startsWith('--') ? rawProp : rawProp.toLowerCase();
  const value = text
    .slice(colon + 1)
    .replace(/!\s*important\s*$/i, '')
    .trim();
  return { prop, value };
}

export function parseCss(css: string): CssRule[] {
  const src = stripCssComments(css);
  const rules: CssRule[] = [];
  type Frame =
    | { kind: 'group'; prelude: string }
    | { kind: 'rule'; selector: string; decls: CssDecl[] };
  const stack: Frame[] = [];
  let buf = '';
  let paren = 0;
  const context = (): string[] =>
    stack.flatMap((f) => (f.kind === 'group' ? [f.prelude] : []));
  const flushDecl = (): void => {
    const top = stack[stack.length - 1];
    if (top !== undefined && top.kind === 'rule') {
      const d = parseDecl(buf);
      if (d !== null) top.decls.push(d);
    }
    buf = '';
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      buf += src.slice(i, j + 1);
      i = j;
      continue;
    }
    if (c === '(') paren++;
    else if (c === ')' && paren > 0) paren--;
    if (paren > 0) {
      buf += c;
      continue;
    }
    if (c === '{') {
      const prelude = buf.trim();
      buf = '';
      const top = stack[stack.length - 1];
      if (top !== undefined && top.kind === 'rule') {
        // Nested block inside a declaration block: read it as its own rule.
        stack.push({ kind: 'rule', selector: prelude, decls: [] });
      } else if (GROUP_AT.test(prelude) || KEYFRAMES_AT.test(prelude)) {
        stack.push({ kind: 'group', prelude });
      } else {
        stack.push({ kind: 'rule', selector: prelude, decls: [] });
      }
    } else if (c === ';') {
      flushDecl();
    } else if (c === '}') {
      flushDecl();
      const frame = stack.pop();
      if (frame !== undefined && frame.kind === 'rule') {
        rules.push({ selector: frame.selector, context: context(), decls: frame.decls });
      }
    } else {
      buf += c;
    }
  }
  return rules;
}

function selectorParts(selector: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (const c of selector) {
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    if (c === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  parts.push(cur.trim());
  return parts.filter((p) => p !== '');
}

function declValues(rules: readonly CssRule[], prop: string): string[] {
  return rules.flatMap((r) => r.decls.filter((d) => d.prop === prop).map((d) => d.value));
}

// ---------------------------------------------------------------- contrast pairs

export interface ContrastPair {
  readonly id: string;
  readonly fg: string;
  readonly bg: string;
  readonly min: number;
  /** Null when a side is missing or not a literal hex color. */
  readonly ratio: number | null;
  readonly fgRgb: Rgb | null;
  readonly bgRgb: Rgb | null;
}

/** 3:1 for ids ending `-large` or `-ui`, 4.5:1 otherwise. */
export function pairMinimum(id: string): number {
  return id.endsWith('-large') || id.endsWith('-ui') ? 3 : 4.5;
}

/** Read `--pair-<id>-fg` / `--pair-<id>-bg` declarations (last declaration wins). */
export function readPairs(css: string): ContrastPair[] {
  const fg = new Map<string, string>();
  const bg = new Map<string, string>();
  for (const rule of parseCss(css)) {
    for (const d of rule.decls) {
      const m = /^--pair-(.+)-(fg|bg)$/.exec(d.prop);
      if (m === null) continue;
      (m[2] === 'fg' ? fg : bg).set(m[1]!, d.value);
    }
  }
  const ids = [...new Set([...fg.keys(), ...bg.keys()])].sort();
  return ids.map((id) => {
    const f = fg.get(id) ?? '';
    const b = bg.get(id) ?? '';
    const fgRgb = parseHexColor(f);
    const bgRgb = parseHexColor(b);
    return {
      id,
      fg: f,
      bg: b,
      min: pairMinimum(id),
      fgRgb,
      bgRgb,
      ratio: fgRgb !== null && bgRgb !== null ? contrastRatio(fgRgb, bgRgb) : null,
    };
  });
}

export function checkPairs(css: string): CssProblem[] {
  const pairs = readPairs(css);
  if (pairs.length === 0) return [{ check: 'pairs', message: 'no --pair-*-fg / --pair-*-bg colors declared' }];
  const problems: CssProblem[] = [];
  for (const p of pairs) {
    if (p.fgRgb === null || p.bgRgb === null) {
      problems.push({
        check: 'pairs',
        message: `pair "${p.id}" needs literal hex fg and bg (fg="${p.fg}", bg="${p.bg}")`,
      });
    } else if (p.ratio! < p.min) {
      problems.push({
        check: 'pairs',
        message: `pair "${p.id}" has contrast ${p.ratio!.toFixed(2)}, minimum ${p.min}`,
      });
    }
  }
  return problems;
}

// ---------------------------------------------------------------- over-text contrast

/**
 * Contrast of text over its background after a layer of `layer` at `alpha` is drawn on top
 * of both (Req 11.4). Both colors are composited with `compositeOver`.
 */
export function overTextContrast(text: Rgb, bg: Rgb, layer: Rgb, alpha: number): number {
  return contrastRatio(compositeOver(layer, alpha, text), compositeOver(layer, alpha, bg));
}

function parseNumber(value: string): number | null {
  const v = value.trim();
  if (/^-?\d+(\.\d+)?%$/.test(v)) return parseFloat(v) / 100;
  if (/^-?(\d+(\.\d*)?|\.\d+)$/.test(v)) return parseFloat(v);
  return null;
}

// ---------------------------------------------------------------- layout

const PAGE_LEVEL = ['html', 'body', '#app', 'main', '.content'];
export const DEFAULT_WRAP_SELECTORS: readonly string[] = ['.grave-name', '.grave-path', '.preview-title'];

function isFixedWidth(value: string): boolean {
  const v = value.trim().toLowerCase();
  const m = /^(\d+(\.\d+)?|\.\d+)([a-z%]*)$/.exec(v);
  if (m === null) return false;
  const num = parseFloat(m[1]!);
  const unit = m[3]!;
  if (num === 0) return false;
  if (unit === '%' || unit === 'vw') return num > 100;
  return ['px', 'rem', 'em', 'ch', 'pt', 'cm', 'mm', 'in', 'pc'].includes(unit);
}

/** Layout rules of Req 12.17. */
export function checkLayout(
  css: string,
  wrapSelectors: readonly string[] = DEFAULT_WRAP_SELECTORS,
): CssProblem[] {
  const rules = parseCss(css);
  const problems: CssProblem[] = [];
  for (const rule of rules) {
    const parts = selectorParts(rule.selector);
    if (!parts.some((p) => PAGE_LEVEL.includes(p))) continue;
    for (const d of rule.decls) {
      if ((d.prop === 'width' || d.prop === 'min-width') && isFixedWidth(d.value)) {
        problems.push({
          check: 'layout',
          message: `${rule.selector} sets ${d.prop}: ${d.value} on a page-level element`,
        });
      }
    }
  }
  for (const sel of wrapSelectors) {
    const group = rules.filter((r) => selectorParts(r.selector).includes(sel));
    const get = (prop: string): string[] => declValues(group, prop);
    const ok =
      get('overflow-wrap').some((v) => v === 'anywhere' || v === 'break-word') ||
      get('word-break').some((v) => v === 'break-all' || v === 'break-word') ||
      (get('text-overflow').includes('ellipsis') && get('overflow').some((v) => v === 'hidden'));
    if (!ok) problems.push({ check: 'layout', message: `${sel} needs overflow-wrap or truncation` });
  }
  const scroll = rules.filter((r) => selectorParts(r.selector).includes('.scroll-x'));
  if (scroll.length > 0 && !declValues(scroll, 'overflow-x').some((v) => v === 'auto' || v === 'scroll')) {
    problems.push({ check: 'layout', message: '.scroll-x needs overflow-x: auto' });
  }
  return problems;
}

// ---------------------------------------------------------------- shared helpers

function rulesFor(rules: readonly CssRule[], selector: string): CssRule[] {
  return rules.filter((r) => selectorParts(r.selector).includes(selector));
}

function isOpaqueBackground(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (['transparent', 'none', 'initial', 'unset', 'inherit', 'revert'].includes(v)) return false;
  const fn = /^(?:rgba|hsla|rgb|hsl)\(([^)]*)\)$/.exec(v);
  if (fn !== null) {
    const alpha = /[,/]\s*([\d.]+%?)\s*$/.exec(fn[1]!);
    if (alpha === null) return true;
    const a = alpha[1]!.endsWith('%') ? parseFloat(alpha[1]!) / 100 : parseFloat(alpha[1]!);
    return !(a < 1);
  }
  const hex = /^#([0-9a-f]{4}|[0-9a-f]{8})$/.exec(v);
  if (hex !== null) return hex[1]!.slice(-(hex[1]!.length / 4)).split('').every((c) => c === 'f');
  return true;
}

const BG_PROPS = ['background', 'background-color'];

/** Last value of a property over a rule group, or null. */
function lastValue(group: readonly CssRule[], props: readonly string[]): string | null {
  let v: string | null = null;
  for (const r of group) for (const d of r.decls) if (props.includes(d.prop)) v = d.value;
  return v;
}

/** Resolve one `var(--name)` level against the custom properties declared in the sheet. */
function resolveVar(rules: readonly CssRule[], value: string): string {
  const m = /^var\(\s*(--[\w-]+)\s*(?:,[^)]*)?\)$/.exec(value.trim());
  if (m === null) return value.trim();
  return declValues(rules, m[1]!).at(-1)?.trim() ?? value.trim();
}

/** Length in px (rem and em read at 16px), or null when not a plain length. */
function toPx(value: string): number | null {
  const rem = toRem(value);
  return rem === null ? null : rem * 16;
}

// ---------------------------------------------------------------- forbidden constructs

const FORBIDDEN_FUNCTIONS = /(?:linear|radial|conic|repeating-linear|repeating-radial|repeating-conic)-gradient\(|\bblur\(|\bdrop-shadow\(/i;

/**
 * No gradient, filter, blur or shadow constructs in CSS (Req 6.3). Reads declarations, so a
 * word in a comment or selector does not count.
 */
export function checkNoForbiddenConstructs(css: string): CssProblem[] {
  const problems: CssProblem[] = [];
  for (const rule of parseCss(css)) {
    for (const d of rule.decls) {
      const v = d.value.trim().toLowerCase();
      const bad =
        ((d.prop === 'filter' || d.prop === 'backdrop-filter') && v !== 'none') ||
        ((d.prop === 'box-shadow' || d.prop === 'text-shadow') && v !== 'none') ||
        FORBIDDEN_FUNCTIONS.test(d.value);
      if (bad) {
        problems.push({
          check: 'forbidden',
          message: `${rule.selector} uses ${d.prop}: ${d.value.slice(0, 40)} (no gradient, filter, blur or shadow)`,
        });
      }
    }
  }
  return problems;
}

// ---------------------------------------------------------------- strata

export const DEFAULT_STRATA: readonly string[] = ['.yard', '.deep', '#formats', 'footer'];
export const DECORATIVE_SELECTORS: readonly string[] = [
  '.edge',
  '.soil',
  '.sprite',
  '.buried',
  '.clauses',
  'body::after',
  '.rise-ghost',
];
/** Decorative classes whose elements in the markup must be `aria-hidden="true"`. */
const DECORATIVE_CLASSES = ['edge', 'soil', 'sprite', 'buried', 'clauses'];
const GRAIN_MIN = 0.1;
const GRAIN_MAX = 0.22;

/**
 * Rule-level proxy for the strata background (Req 6.1 to 6.5): solid ground on `html`, opaque
 * strata, inert decorative layers that are `aria-hidden` in the markup, the grain overlay (or the
 * documented fallback), and no gradient, filter, blur or shadow in CSS or markup. It does not
 * prove pixels; the owner measures rendered coverage.
 */
export function checkStrata(
  css: string,
  html: string,
  strata: readonly string[] = DEFAULT_STRATA,
): CssProblem[] {
  const rules = parseCss(css);
  const problems: CssProblem[] = [...checkNoForbiddenConstructs(css)];
  const fail = (message: string): void => void problems.push({ check: 'strata', message });

  // html paints the solid ground; the page has no fixed height.
  const groundHex = declValues(rules, '--pair-body-bg').at(-1)?.toLowerCase() ?? null;
  const htmlBg = lastValue(rulesFor(rules, 'html'), BG_PROPS)?.toLowerCase() ?? null;
  const groundOk =
    htmlBg !== null &&
    (htmlBg === 'var(--pair-body-bg)' ||
      htmlBg === 'var(--ground)' ||
      (groundHex !== null && htmlBg === groundHex));
  if (!groundOk) fail(`html needs a solid ground background (found ${htmlBg ?? 'none'})`);
  for (const sel of ['html', 'body']) {
    const h = lastValue(rulesFor(rules, sel), ['height']);
    if (h !== null && toPx(h) !== null) fail(`${sel} must not have a fixed height (found ${h})`);
    if (h !== null && /(?:vh|dvh|svh|lvh)$/i.test(h.trim())) fail(`${sel} must not have a fixed height (found ${h})`);
  }

  // Each stratum is opaque.
  for (const sel of strata) {
    const bg = lastValue(rulesFor(rules, sel), BG_PROPS);
    if (bg === null) fail(`${sel} needs an opaque background`);
    else if (!isOpaqueBackground(bg)) fail(`${sel} background is not opaque (${bg.slice(0, 40)})`);
  }

  // Decorative layers do not take clicks.
  for (const sel of DECORATIVE_SELECTORS) {
    const group = rulesFor(rules, sel);
    if (sel === 'body::after' && group.length === 0) continue; // fallback: grain lives in the strata
    const pe = declValues(group, 'pointer-events');
    if (pe.length === 0 || pe.some((v) => v !== 'none')) {
      fail(`${sel} needs pointer-events: none`);
    }
  }

  // Grain: fixed overlay with a variable opacity in range, or the section-background fallback.
  const after = rulesFor(rules, 'body::after');
  const grainDecl = declValues(rules, '--grain-opacity').at(-1);
  const bgOf = (g: readonly CssRule[]): string[] =>
    g.flatMap((r) => r.decls.filter((d) => d.prop === 'background' || d.prop === 'background-image').map((d) => d.value));
  const hasUrl = (values: readonly string[]): boolean => values.some((v) => /url\(/i.test(v));
  if (after.length > 0) {
    if (lastValue(after, ['position']) !== 'fixed') fail('body::after needs position: fixed');
    if (!hasUrl(bgOf(after))) fail('body::after needs a url() grain image');
    if (lastValue(after, ['opacity']) !== 'var(--grain-opacity)') fail('body::after needs opacity: var(--grain-opacity)');
    const n = grainDecl === undefined ? null : parseNumber(grainDecl);
    if (n === null) fail('--grain-opacity needs a numeric declaration');
    else if (n < GRAIN_MIN - 1e-9 || n > GRAIN_MAX + 1e-9) {
      fail(`--grain-opacity ${n} is outside ${GRAIN_MIN} to ${GRAIN_MAX}`);
    }
  } else if (!strata.some((sel) => hasUrl(bgOf(rulesFor(rules, sel))))) {
    fail('no grain: need body::after or a url() background on the strata');
  }

  // Markup: edges present, decorative elements aria-hidden, no gradient/filter constructs.
  const doc = parseHtml(html);
  let edges = 0;
  for (const el of doc.elements) {
    const classes = (el.attrs['class'] ?? '').split(/\s+/);
    if (classes.includes('edge')) edges++;
    const hit = DECORATIVE_CLASSES.find((c) => classes.includes(c));
    if (hit !== undefined && el.attrs['aria-hidden'] !== 'true') {
      fail(`<${el.tag} class="${hit}"> needs aria-hidden="true"`);
    }
    if (/^(lineargradient|radialgradient|filter|fegaussianblur|fedropshadow)$/.test(el.tag)) {
      fail(`<${el.tag}> is a forbidden gradient or filter construct`);
    }
    if ('filter' in el.attrs) fail(`<${el.tag}> has a filter attribute`);
  }
  if (edges === 0) fail('no .edge element in the markup');
  return problems;
}

// ---------------------------------------------------------------- motion

const ANIMATABLE: readonly string[] = ['opacity', 'transform', 'clip-path'];
const TIMING_WORDS = /^(?:ease|ease-in|ease-out|ease-in-out|linear|step-start|step-end)$/;
const KEYFRAMES_CTX = /^@(?:-\w+-)?keyframes\b/i;

function inKeyframes(rule: CssRule): boolean {
  return rule.context.some((c) => KEYFRAMES_CTX.test(c));
}

/** Property names that a `transition` shorthand names ("all" when an item names none). */
function transitionProps(value: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  const items: string[] = [];
  for (const c of value) {
    if (c === '(') depth++;
    else if (c === ')') depth--;
    if (c === ',' && depth === 0) {
      items.push(cur);
      cur = '';
    } else cur += c;
  }
  items.push(cur);
  for (const item of items) {
    const tokens = item.replace(/\([^)]*\)/g, (m) => m.replace(/\s+/g, '')).trim().split(/\s+/).filter((t) => t !== '');
    if (tokens.length === 1 && tokens[0]!.toLowerCase() === 'none') continue;
    const name = tokens.find(
      (t) => !/^[\d.]+m?s$/i.test(t) && !TIMING_WORDS.test(t.toLowerCase()) && !/^(?:cubic-bezier|steps|linear|var)\(/i.test(t),
    );
    out.push(name === undefined ? 'all' : name.toLowerCase());
  }
  return out;
}

/** Only `opacity`, `transform` and `clip-path` are animated or transitioned (Req 12.4). */
export function checkAnimatedProperties(css: string): CssProblem[] {
  const problems: CssProblem[] = [];
  const fail = (message: string): void => void problems.push({ check: 'motion', message });
  for (const rule of parseCss(css)) {
    if (inKeyframes(rule)) {
      for (const d of rule.decls) {
        if (d.prop === 'animation-timing-function') continue;
        if (!ANIMATABLE.includes(d.prop)) fail(`@keyframes step "${rule.selector}" animates ${d.prop}`);
      }
      continue;
    }
    for (const d of rule.decls) {
      if (d.prop === 'transition-property') {
        for (const p of d.value.split(',').map((x) => x.trim().toLowerCase())) {
          if (p !== 'none' && !ANIMATABLE.includes(p)) fail(`${rule.selector} transitions ${p}`);
        }
      } else if (d.prop === 'transition') {
        for (const p of transitionProps(d.value)) {
          if (!ANIMATABLE.includes(p)) fail(`${rule.selector} transitions ${p}`);
        }
      }
    }
  }
  return problems;
}

/** A value that hides an element: opacity 0, or a scale-down transform. */
function isHidingDecl(d: CssDecl): boolean {
  if (d.prop === 'opacity') return parseNumber(d.value) === 0;
  if (d.prop === 'transform') {
    for (const m of d.value.matchAll(/scale[xy]?\(\s*([^)]*)\)/gi)) {
      const nums = m[1]!.split(',').map((x) => parseNumber(x));
      if (nums.some((n) => n !== null && n < 1)) return true;
    }
  }
  return false;
}

/**
 * A hidden start state exists only in the `from` (or `0%`) step of a keyframes block, or in a rule
 * whose every selector is under `.js` (Req 12.3, 12.4). The reduced-motion block may only show things.
 */
export function checkHiddenStartStates(css: string): CssProblem[] {
  const problems: CssProblem[] = [];
  for (const rule of parseCss(css)) {
    const hiding = rule.decls.filter(isHidingDecl);
    if (hiding.length === 0) continue;
    if (inKeyframes(rule)) {
      if (!selectorParts(rule.selector).every((s) => s === 'from' || s === '0%')) {
        problems.push({
          check: 'hidden-start',
          message: `@keyframes step "${rule.selector}" hides an element outside "from"`,
        });
      }
    } else if (!selectorParts(rule.selector).every((s) => /\.js(?![\w-])/.test(s))) {
      problems.push({
        check: 'hidden-start',
        message: `${rule.selector} hides an element (${hiding[0]!.prop}: ${hiding[0]!.value}) without .js in the selector`,
      });
    }
  }
  return problems;
}

// ---------------------------------------------------------------- fonts

const SERIF_USE = /var\(\s*--serif\s*\)|instrument serif|(?:^|[\s,'"])serif\b/i;
const MONO_USE = /var\(\s*--mono\s*\)|monospace/i;
const SERIF_SELECTOR = /(?:^|[\s>+~])(?:h[1-3]|\.buried)(?![\w-])/;
const MONO_SELECTOR = /\.(?:preview-text|hex-view)(?![\w-])/;

/**
 * `font-family` rules (Req 3.1, 3.2): the serif only on h1 to h3 and `.buried` (and their
 * descendants), the mono only in the plain-text preview and the hex view (and their descendants).
 */
export function checkFontFamilies(css: string): CssProblem[] {
  const problems: CssProblem[] = [];
  for (const rule of parseCss(css)) {
    if (rule.selector.startsWith('@')) continue;
    for (const d of rule.decls) {
      if (d.prop !== 'font-family') continue;
      const parts = selectorParts(rule.selector);
      if (SERIF_USE.test(d.value) && !parts.every((p) => SERIF_SELECTOR.test(p))) {
        problems.push({ check: 'fonts', message: `${rule.selector} uses the serif face; only h1 to h3 and .buried may` });
      }
      if (MONO_USE.test(d.value) && !parts.every((p) => MONO_SELECTOR.test(p))) {
        problems.push({ check: 'fonts', message: `${rule.selector} uses the mono face; only .preview-text and .hex-view may` });
      }
    }
  }
  return problems;
}

// ---------------------------------------------------------------- headstones and hit areas

/** No rule hides a Headstone, in any media block (Req 5.8). */
export function checkStonesVisible(css: string): CssProblem[] {
  const problems: CssProblem[] = [];
  for (const rule of parseCss(css)) {
    if (!selectorParts(rule.selector).some((s) => /\.hs(?![\w-])/.test(s))) continue;
    for (const d of rule.decls) {
      const v = d.value.trim().toLowerCase();
      if ((d.prop === 'display' && v === 'none') || (d.prop === 'visibility' && v === 'hidden')) {
        problems.push({ check: 'stones', message: `${rule.selector} must not use ${d.prop}: ${v}` });
      }
    }
  }
  return problems;
}

export const DEFAULT_HIT_SELECTORS: readonly string[] = [
  '.btn',
  '.demo-slot-button',
  '.grave-action',
  '.hs',
  '.nav .links a',
];
export const MIN_HIT_PX = 40;

/** Each listed selector has `min-height` of at least 40px (Req 13.4). */
export function checkMinHeights(
  css: string,
  selectors: readonly string[] = DEFAULT_HIT_SELECTORS,
): CssProblem[] {
  const rules = parseCss(css);
  const problems: CssProblem[] = [];
  for (const sel of selectors) {
    const group = rulesFor(rules, sel).filter((r) => r.context.length === 0);
    const raw = lastValue(group, ['min-height']);
    const px = raw === null ? null : toPx(resolveVar(rules, raw));
    if (px === null) problems.push({ check: 'hit-area', message: `${sel} needs min-height of ${MIN_HIT_PX}px or more (found ${raw ?? 'none'})` });
    else if (px < MIN_HIT_PX) problems.push({ check: 'hit-area', message: `${sel} min-height ${raw} is below ${MIN_HIT_PX}px` });
  }
  return problems;
}

const CONTENT_SELECTORS: readonly string[] = [
  '.stoneline',
  '.hs',
  '.panel',
  '.preview',
  '.btn',
  '.demo-slot-button',
  '.grave-action',
];

/** Content stays clickable: no `pointer-events: none` on content selectors (Req 12.5). */
export function checkContentInteractive(css: string): CssProblem[] {
  const problems: CssProblem[] = [];
  for (const rule of parseCss(css)) {
    const hit = selectorParts(rule.selector).find((s) => CONTENT_SELECTORS.includes(s));
    if (hit === undefined) continue;
    if (rule.decls.some((d) => d.prop === 'pointer-events' && d.value.trim() === 'none')) {
      problems.push({ check: 'interactive', message: `${hit} must not set pointer-events: none` });
    }
  }
  return problems;
}

// ---------------------------------------------------------------- narrow layout

/** Length in rem, or null when not a plain rem/px/em/0 value (px and em read at 16px per rem). */
function toRem(token: string): number | null {
  const m = /^(-?(?:\d+(?:\.\d*)?|\.\d+))(rem|em|px)?$/.exec(token.trim().toLowerCase());
  if (m === null) return null;
  const n = parseFloat(m[1]!);
  if (m[2] === undefined) return n === 0 ? 0 : null;
  return m[2] === 'px' ? n / 16 : n;
}

const MAX_WIDTH_CTX = /\(\s*max-width\s*:\s*(\d+(?:\.\d+)?)px\s*\)/i;

/** Evaluate a px / vw / min() / max() / clamp() / calc(+,-,*) length at a viewport width. */
function evalLength(expr: string, vw: number, vars: ReadonlyMap<string, string>, depth = 0): number | null {
  if (depth > 8) return null;
  const s = expr.trim();
  const fn = /^(min|max|clamp|calc)\((.*)\)$/s.exec(s);
  if (fn !== null) {
    const parts: string[] = [];
    let level = 0;
    let cur = '';
    for (const ch of fn[2]!) {
      if (ch === '(') level++;
      if (ch === ')') level--;
      if (ch === ',' && level === 0) {
        parts.push(cur);
        cur = '';
      } else cur += ch;
    }
    parts.push(cur);
    if (fn[1] === 'calc') return evalCalc(parts.join(','), vw, vars, depth + 1);
    const vals = parts.map((p) => evalLength(p, vw, vars, depth + 1));
    if (vals.some((v) => v === null)) return null;
    const n = vals as number[];
    if (fn[1] === 'min') return Math.min(...n);
    if (fn[1] === 'max') return Math.max(...n);
    return n.length === 3 ? Math.max(n[0]!, Math.min(n[1]!, n[2]!)) : null;
  }
  const v = /^var\((--[\w-]+)\)$/.exec(s);
  if (v !== null) {
    const d = vars.get(v[1]!);
    return d === undefined ? null : evalLength(d, vw, vars, depth + 1);
  }
  const m = /^(-?\d*\.?\d+)(px|vw)?$/.exec(s);
  if (m === null) return null;
  return m[2] === 'vw' ? (parseFloat(m[1]!) * vw) / 100 : parseFloat(m[1]!);
}

/** Left-to-right `a * b`, `a + b`, `a - b` (no nesting beyond function calls). */
function evalCalc(expr: string, vw: number, vars: ReadonlyMap<string, string>, depth: number): number | null {
  const tokens: string[] = [];
  let level = 0;
  let cur = '';
  for (const ch of expr) {
    if (ch === '(') level++;
    if (ch === ')') level--;
    if (level === 0 && (ch === ' ' || ch === '*')) {
      if (cur !== '') tokens.push(cur);
      cur = '';
      if (ch === '*') tokens.push('*');
    } else cur += ch;
  }
  if (cur !== '') tokens.push(cur);
  let acc: number | null = null;
  let op = '+';
  for (const t of tokens) {
    if (t === '*' || t === '+' || t === '-') {
      op = t;
      continue;
    }
    const v = evalLength(t, vw, vars, depth + 1);
    if (v === null) return null;
    acc = acc === null ? v : op === '*' ? acc * v : op === '-' ? acc - v : acc + v;
  }
  return acc;
}

/**
 * Six headstones plus five gaps fit in the content width (`100vw - 2 * --m`) at the given viewport
 * widths, using the declared top-level `--w`/`--wv` (wide size is `min(--w, --wv)`) and the
 * `.stoneline` gap. Static proxy; it does not measure the rendered row.
 */
export function checkStoneRowFits(css: string, widths: readonly number[] = [761, 1180]): CssProblem[] {
  const problems: CssProblem[] = [];
  const fail = (message: string): void => void problems.push({ check: 'stone-row', message });
  const top = parseCss(css).filter((r) => r.context.length === 0);
  const last = (sel: string, prop: string): string | undefined =>
    top
      .filter((r) => r.selector.split(',').map((s) => s.trim()).includes(sel))
      .flatMap((r) => r.decls)
      .filter((d) => d.prop === prop)
      .at(-1)
      ?.value.trim();
  const root = new Map<string, string>();
  for (const r of top.filter((x) => x.selector.split(',').map((s) => s.trim()).includes(':root'))) {
    for (const d of r.decls) if (d.prop.startsWith('--')) root.set(d.prop, d.value.trim());
  }
  const m = root.get('--m');
  const gapDecl = last('.stoneline', 'gap');
  const gap = gapDecl === undefined ? undefined : gapDecl.trim().split(/\s+(?![^(]*\))/).at(-1);
  if (m === undefined || gap === undefined) return [{ check: 'stone-row', message: 'missing --m or .stoneline gap' }];
  const widthDecl = last('.hs', 'width');
  if (widthDecl === undefined) return [{ check: 'stone-row', message: 'missing .hs width' }];
  for (const width of widths) {
    let sum = 0;
    for (let i = 0; i < 6; i++) {
      const vars = new Map(root);
      for (const p of ['--w', '--wv']) {
        const v = last(`.stone-${i}`, p);
        if (v !== undefined) vars.set(p, v);
      }
      const w = evalLength(widthDecl, width, vars);
      if (w === null) return [{ check: 'stone-row', message: `cannot resolve width of .stone-${i}` }];
      sum += w;
    }
    const g = evalLength(gap, width, root);
    const mm = evalLength(m, width, root);
    if (g === null || mm === null) return [{ check: 'stone-row', message: 'cannot resolve gap or --m' }];
    const need = sum + 5 * g;
    const have = width - 2 * mm;
    if (need > have) fail(`at ${width}px six stones and gaps need ${need.toFixed(1)}px, content is ${have.toFixed(1)}px`);
  }
  return problems;
}

/** Width in px of a `(max-width: Npx)` query, or null. */
export function queryWidth(query: string): number | null {
  const m = MAX_WIDTH_CTX.exec(query);
  return m === null ? null : parseFloat(m[1]!);
}

/** Rules inside `@media (max-width: <width>px)`. */
function narrowBlock(rules: readonly CssRule[], width: number): CssRule[] {
  return rules.filter((r) =>
    r.context.some((c) => /^@media\b/i.test(c) && queryWidth(c) === width),
  );
}

/**
 * The narrow media block of the stylesheet has the same width as the query the script uses
 * (Req 13.6), and no other max-width breakpoint exists.
 */
export function checkNarrowQuery(css: string, query: string): CssProblem[] {
  const width = queryWidth(query);
  if (width === null) return [{ check: 'narrow-query', message: `query "${query}" has no max-width in px` }];
  const rules = parseCss(css);
  const problems: CssProblem[] = [];
  if (narrowBlock(rules, width).length === 0) {
    problems.push({ check: 'narrow-query', message: `no @media (max-width: ${width}px) block` });
  }
  const others = new Set<number>();
  for (const r of rules) {
    for (const c of r.context) {
      if (!/^@media\b/i.test(c)) continue;
      const w = queryWidth(c);
      if (w !== null && w !== width) others.add(w);
    }
  }
  for (const w of others) {
    problems.push({ check: 'narrow-query', message: `another breakpoint @media (max-width: ${w}px) differs from ${width}px` });
  }
  return problems;
}

/** Lines of label text a back stone must show above the front row: top padding, two name lines, gap, state line. */
export const BACK_LABEL_BLOCK_PX = 32 + 2 * 0.7 * 16 * 1.1 + 6 + 0.7 * 16;

/**
 * Two rows of three with depth in the narrow block (Task 12). Static proxy over the declared
 * values, evaluated at each viewport width: the row wraps and holds three stones but not four; the
 * back stones (.stone-0 to .stone-2) are about 85% size, have a negative bottom margin, a darker
 * fill from the `--pair-hs-back-*` pairs and a raised focus z-index; the front row is above the
 * back row; the front tops leave the label block of every back stone visible. Rendered overlap is
 * measured by the owner.
 */
export function checkNarrowStoneDepth(css: string, width = 760, viewports: readonly number[] = [360, 390, 760]): CssProblem[] {
  const problems: CssProblem[] = [];
  const fail = (message: string): void => void problems.push({ check: 'stone-depth', message });
  const rules = parseCss(css);
  const block = narrowBlock(rules, width);
  if (block.length === 0) return [{ check: 'stone-depth', message: `no @media (max-width: ${width}px) block` }];
  const root = new Map<string, string>();
  for (const r of rules.filter((x) => x.context.length === 0 && selectorParts(x.selector).includes(':root'))) {
    for (const d of r.decls) if (d.prop.startsWith('--')) root.set(d.prop, d.value.trim());
  }
  const line = rulesFor(block, '.stoneline');
  for (const r of line) for (const d of r.decls) if (d.prop.startsWith('--')) root.set(d.prop, d.value.trim());
  const decl = (sel: string, prop: string): string | null => lastValue(rulesFor(block, sel), [prop]);
  if (lastValue(line, ['flex-wrap'])?.trim() !== 'wrap' && lastValue(rulesFor(rules.filter((r) => r.context.length === 0), '.stoneline'), ['flex-wrap'])?.trim() !== 'wrap') {
    fail('.stoneline must wrap in the narrow block');
  }
  const gapDecl = lastValue(line, ['gap']);
  const gapParts = gapDecl === null ? [] : gapDecl.trim().split(/\s+(?![^(]*\))/);
  const gap = gapParts.length === 0 ? null : evalLength(gapParts.at(-1)!, 360, root);
  const mDecl = root.get('--m');
  const widthDecl = decl('.hs', 'width');
  const heightDecl = decl('.hs', 'height');
  const scale = parseFloat(root.get('--back-scale') ?? 'NaN');
  const backW = decl('.stone-0', 'width');
  const backH = decl('.stone-0', 'height');
  const marginX = decl('.stone-0', 'margin-inline');
  const marginB = decl('.stone-0', 'margin-bottom');
  if (gap === null || mDecl === undefined || widthDecl === null || heightDecl === null || backW === null || backH === null || marginX === null || marginB === null) {
    return [...problems, { check: 'stone-depth', message: 'narrow block lacks gap, --m, .hs size or back-row size, margin-inline and margin-bottom' }];
  }
  if (!(scale >= 0.8 && scale <= 0.9)) fail(`--back-scale ${scale} is not about 0.85`);
  for (const sel of ['.stone-0', '.stone-1', '.stone-2']) {
    if (decl(sel, 'margin-bottom') !== marginB || decl(sel, 'width') !== backW) fail(`${sel} needs the back-row width and negative margin-bottom`);
  }
  const zFront = parseFloat(decl('.hs', 'z-index') ?? 'NaN');
  const zBack = parseFloat(decl('.stone-0', 'z-index') ?? 'NaN');
  const zFocus = Math.max(
    ...['.hs.stone-0:focus-visible', '.hs.stone-1:focus-visible', '.hs.stone-2:focus-visible'].map((s) => parseFloat(decl(s, 'z-index') ?? 'NaN')),
  );
  if (!(zFront > zBack)) fail('the front row needs a higher z-index than the back row');
  if (!(zFocus > zFront)) fail('a focused back stone needs a z-index above the front row');
  for (const bg of ['.hs.stone-0', '.hs.stone-1', '.hs.stone-2']) {
    if (!/var\(--pair-hs-back-/.test(decl(bg, 'background') ?? '')) fail(`${bg} needs a --pair-hs-back-* fill`);
    if (!/var\(--pair-hs-back-/.test(decl(bg, 'color') ?? '')) fail(`${bg} needs a --pair-hs-back-* label colour`);
  }
  const sinkFront = decl('.stone-3', '--sink');
  if (sinkFront === null || decl('.stone-0', '--sink') === null) fail('narrow block must set --sink for both rows');
  for (const vw of viewports) {
    const m = evalLength(mDecl, vw, root);
    const w = evalLength(widthDecl, vw, root);
    const h = evalLength(heightDecl, vw, root);
    const bw = evalLength(backW, vw, root);
    const bh = evalLength(backH, vw, root);
    const mx = evalLength(marginX, vw, root);
    const mb = evalLength(marginB, vw, root);
    const sink = sinkFront === null ? null : evalLength(sinkFront, vw, root);
    if ([m, w, h, bw, bh, mx, mb, sink].some((v) => v === null)) {
      fail(`cannot resolve the narrow stone sizes at ${vw}px`);
      continue;
    }
    const content = vw - 2 * m!;
    const front3 = 3 * w! + 2 * gap;
    const back3 = 3 * (bw! + 2 * mx!) + 2 * gap;
    const four = 4 * Math.min(w!, bw! + 2 * mx!) + 3 * gap;
    if (front3 > content || back3 > content) fail(`at ${vw}px three stones do not fit a row (${Math.max(front3, back3).toFixed(1)} > ${content.toFixed(1)})`);
    if (four <= content) fail(`at ${vw}px four stones fit a row, so rows would not be three`);
    if (mb! >= 0) fail(`at ${vw}px the back row needs a negative bottom margin`);
    if (Math.abs(bh! / h! - scale) > 0.02) fail(`at ${vw}px the back stone is not ${scale} of the front stone height`);
    const visible = bh! + mb! + sink!;
    if (visible < BACK_LABEL_BLOCK_PX) fail(`at ${vw}px a back stone shows ${visible.toFixed(1)}px above the front row, its labels need ${BACK_LABEL_BLOCK_PX.toFixed(1)}px`);
    if (-mb! - sink! < 0.05 * bh!) fail(`at ${vw}px the front row hides almost none of the back row`);
  }
  return problems;
}

/**
 * Rule-level proxy for the one-column card list at the narrow width (Req 7.1, 8.1): inside the
 * narrow block `.demo-slot-list` has one column, and no `.demo-slot*` rule hides anything.
 * It does not measure rendered height.
 */
export function checkNarrowCardList(css: string, width = 760): CssProblem[] {
  const block = narrowBlock(parseCss(css), width);
  const problems: CssProblem[] = [];
  const fail = (message: string): void => void problems.push({ check: 'narrow-cards', message });
  if (block.length === 0) return [{ check: 'narrow-cards', message: `no @media (max-width: ${width}px) block` }];
  const cols = lastValue(rulesFor(block, '.demo-slot-list'), ['grid-template-columns'])?.trim() ?? null;
  if (cols !== '1fr' && cols !== 'minmax(0, 1fr)' && cols !== 'minmax(0,1fr)') {
    fail(`.demo-slot-list needs grid-template-columns: 1fr in the narrow block (found ${cols ?? 'none'})`);
  }
  for (const rule of block) {
    if (!selectorParts(rule.selector).some((s) => s.includes('.demo-slot'))) continue;
    for (const d of rule.decls) {
      const v = d.value.trim().toLowerCase();
      if ((d.prop === 'display' && v === 'none') || (d.prop === 'visibility' && v === 'hidden')) {
        fail(`${rule.selector} must not use ${d.prop}: ${v}`);
      }
    }
  }
  return problems;
}

// ---------------------------------------------------------------- reduced motion

/** A `prefers-reduced-motion: reduce` block that turns animation or transition off. */
export function checkReducedMotion(css: string): CssProblem[] {
  const inBlock = parseCss(css).filter((r) =>
    r.context.some((c) => /prefers-reduced-motion\s*:\s*reduce/i.test(c)),
  );
  if (inBlock.length === 0) {
    return [{ check: 'reduced-motion', message: 'no @media (prefers-reduced-motion: reduce) block' }];
  }
  const touches = inBlock.some((r) =>
    r.decls.some((d) => d.prop.startsWith('animation') || d.prop.startsWith('transition')),
  );
  return touches
    ? []
    : [{ check: 'reduced-motion', message: 'reduced-motion block sets no animation or transition property' }];
}

// ---------------------------------------------------------------- urls and style API

/** Every `url(...)` and `@import` target that is not a relative path or fragment. */
export function checkUrls(css: string): CssProblem[] {
  const src = stripCssComments(css);
  const problems: CssProblem[] = [];
  const targets: string[] = [];
  for (const m of src.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)) {
    targets.push((m[1] ?? m[2] ?? m[3] ?? '').trim());
  }
  for (const m of src.matchAll(/@import\s+(?:"([^"]*)"|'([^']*)')/gi)) {
    targets.push((m[1] ?? m[2] ?? '').trim());
  }
  for (const t of targets) {
    if (t.startsWith('#')) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(t) || t.startsWith('//')) {
      problems.push({ check: 'urls', message: `external or data url: ${t.slice(0, 60)}` });
    }
  }
  return problems;
}

/** Style-API names that must not appear in CSS text or the sources that set styles. */
export function findStyleApiUse(text: string): { line: number; name: string }[] {
  const names: [string, RegExp][] = [
    ['.style.', /\.style\./g],
    ['cssText', /cssText/g],
    ["createElement('style')", /createElement\(\s*(['"`])style\1\s*\)/g],
    ["setAttribute('style'", /setAttribute\(\s*(['"`])style\1/g],
  ];
  const out: { line: number; name: string }[] = [];
  for (const [name, re] of names) {
    for (const m of text.matchAll(re)) {
      out.push({ name, line: text.slice(0, m.index).split('\n').length });
    }
  }
  return out;
}

/** All CSS checks together. */
export function checkCss(css: string): CssProblem[] {
  return [
    ...checkPairs(css),
    ...checkNoForbiddenConstructs(css),
    ...checkAnimatedProperties(css),
    ...checkHiddenStartStates(css),
    ...checkFontFamilies(css),
    ...checkStonesVisible(css),
    ...checkMinHeights(css),
    ...checkContentInteractive(css),
    ...checkNarrowCardList(css),
    ...checkLayout(css),
    ...checkReducedMotion(css),
    ...checkUrls(css),
    ...findStyleApiUse(css).map((v) => ({ check: 'style-api', message: `${v.name} at line ${v.line}` })),
  ];
}
