// Test-only CSS checks for the page test: contrast pairs, effect layers, layout rules,
// reduced motion, external urls. A flat, forgiving CSS reader, not a full parser
// (no nesting support; an inner rule is read as its own rule).

import { compositeOver, contrastRatio, parseHexColor, type Rgb } from '../../web/logic/contrast';

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

// ---------------------------------------------------------------- effect layers

/**
 * Contrast of text over its background after a layer of `layer` at `alpha` is drawn on top
 * of both (Req 11.4). Both colors are composited with `compositeOver`.
 */
export function overTextContrast(text: Rgb, bg: Rgb, layer: Rgb, alpha: number): number {
  return contrastRatio(compositeOver(layer, alpha, text), compositeOver(layer, alpha, bg));
}

const FX_CLASS = /\.fx-[A-Za-z0-9_-]+/g;
const OVER_TEXT_MAX_OPACITY = 0.15;
const FX_MAX_OPACITY = 0.6;

function parseNumber(value: string): number | null {
  const v = value.trim();
  if (/^-?\d+(\.\d+)?%$/.test(v)) return parseFloat(v) / 100;
  if (/^-?(\d+(\.\d*)?|\.\d+)$/.test(v)) return parseFloat(v);
  return null;
}

/**
 * Checks every `.fx-*` class: `pointer-events: none`, an integer z-index below `.content`,
 * and opacity at most 0.6. A layer at or above `.content` is only accepted when its opacity
 * is at most 0.15 and text pairs of 4.5:1 stay at 4.5:1 under a black or white layer.
 */
export function checkFxLayers(css: string): CssProblem[] {
  const rules = parseCss(css);
  const problems: CssProblem[] = [];
  const byClass = new Map<string, CssRule[]>();
  for (const rule of rules) {
    const seen = new Set<string>();
    for (const part of selectorParts(rule.selector)) {
      for (const cls of part.match(FX_CLASS) ?? []) {
        if (seen.has(cls)) continue;
        seen.add(cls);
        byClass.set(cls, [...(byClass.get(cls) ?? []), rule]);
      }
    }
  }
  if (byClass.size === 0) return [{ check: 'fx', message: 'no .fx-* rules found' }];

  const contentRules = rules.filter((r) => selectorParts(r.selector).includes('.content'));
  const contentZs = declValues(contentRules, 'z-index').map(parseNumber);
  const contentZ = contentZs.length === 0 || contentZs.some((z) => z === null) ? null : Math.max(...(contentZs as number[]));
  if (contentZ === null) problems.push({ check: 'fx', message: '.content needs an integer z-index' });

  const textPairs = readPairs(css).filter((p) => p.min === 4.5 && p.fgRgb !== null && p.bgRgb !== null);

  for (const [cls, group] of byClass) {
    const pe = declValues(group, 'pointer-events');
    if (!pe.includes('none') || pe.some((v) => v !== 'none')) {
      problems.push({ check: 'fx', message: `${cls} needs pointer-events: none on every declaration` });
    }
    const opacities = declValues(group, 'opacity').map(parseNumber);
    if (opacities.length === 0 || opacities.some((o) => o === null)) {
      problems.push({ check: 'fx', message: `${cls} needs a numeric opacity` });
    }
    const maxOpacity = Math.max(...opacities.filter((o): o is number => o !== null), 0);
    if (maxOpacity > FX_MAX_OPACITY) {
      problems.push({ check: 'fx', message: `${cls} opacity ${maxOpacity} is above ${FX_MAX_OPACITY}` });
    }
    const zs = declValues(group, 'z-index').map(parseNumber);
    if (zs.length === 0 || zs.some((z) => z === null)) {
      problems.push({ check: 'fx', message: `${cls} needs an integer z-index` });
      continue;
    }
    const maxZ = Math.max(...(zs as number[]));
    if (contentZ === null || maxZ < contentZ) continue;
    // Over-text fallback (Req 11.4).
    if (maxOpacity > OVER_TEXT_MAX_OPACITY) {
      problems.push({
        check: 'fx',
        message: `${cls} is above .content, so its opacity must be at most ${OVER_TEXT_MAX_OPACITY}`,
      });
      continue;
    }
    for (const p of textPairs) {
      for (const layer of [[0, 0, 0], [255, 255, 255]] as const) {
        const r = overTextContrast(p.fgRgb!, p.bgRgb!, layer, maxOpacity);
        if (r < 4.5) {
          problems.push({
            check: 'fx',
            message: `${cls} over pair "${p.id}" leaves contrast ${r.toFixed(2)}, minimum 4.5`,
          });
        }
      }
    }
  }
  return problems;
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

// ---------------------------------------------------------------- page background

function rulesFor(rules: readonly CssRule[], selector: string): CssRule[] {
  return rules.filter((r) => selectorParts(r.selector).includes(selector));
}

/** Top-level comma split of a function argument list. */
function splitArgs(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const c of text) {
    if (c === '(') depth++;
    else if (c === ')') depth--;
    if (c === ',' && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

/** Argument text of every `radial-gradient(` call in a value (balanced parentheses, length capped). */
function radialGradientArgs(value: string): string[] {
  const out: string[] = [];
  const key = 'radial-gradient(';
  let from = 0;
  for (let n = 0; n < 64; n++) {
    const at = value.toLowerCase().indexOf(key, from);
    if (at < 0) break;
    let depth = 1;
    let i = at + key.length;
    while (i < value.length && depth > 0) {
      if (value[i] === '(') depth++;
      else if (value[i] === ')') depth--;
      i++;
    }
    out.push(value.slice(at + key.length, depth === 0 ? i - 1 : i));
    from = i;
  }
  return out;
}

const ABS_LEN = '\\d*\\.?\\d+(?:px|rem|em|vw|vh|vmin|vmax|ch|pt|cm|mm|in)';
const ELLIPSE_SIZE = new RegExp(`^(?:ellipse\\s+)?${ABS_LEN}\\s+${ABS_LEN}\\s+at\\s`, 'i');
const ENDS_TRANSPARENT = /transparent(?:\s+-?\d*\.?\d+(?:%|px|rem|em)?)?$/i;

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

/**
 * Rule-level proxy for "the background covers the whole page" (Req 3.1 to 3.4). It proves the
 * stylesheet has the structure that cannot give a viewport-tall band; it does not prove pixels.
 */
export function checkBackground(css: string): CssProblem[] {
  const rules = parseCss(css);
  const problems: CssProblem[] = [];
  const fail = (message: string): void => void problems.push({ check: 'background', message });
  const last = (group: readonly CssRule[], props: readonly string[]): string | null => {
    let v: string | null = null;
    for (const r of group) for (const d of r.decls) if (props.includes(d.prop)) v = d.value;
    return v;
  };
  const all = (group: readonly CssRule[], props: readonly string[]): string[] =>
    group.flatMap((r) => r.decls.filter((d) => props.includes(d.prop)).map((d) => d.value));

  // 1. html paints the solid ground.
  const groundHex = declValues(rules, '--pair-body-bg').at(-1)?.toLowerCase() ?? null;
  const html = rulesFor(rules, 'html');
  const htmlBg = last(html, BG_PROPS)?.toLowerCase() ?? null;
  const groundOk =
    htmlBg !== null &&
    (htmlBg === 'var(--pair-body-bg)' ||
      htmlBg === 'var(--ground)' ||
      (groundHex !== null && htmlBg === groundHex));
  if (!groundOk) fail(`html needs a solid ground background (found ${htmlBg ?? 'none'})`);

  // 2. body is a positioned, full-height containing block.
  const body = rulesFor(rules, 'body');
  if (last(body, ['position']) !== 'relative') fail('body needs position: relative');
  const minH = last(body, ['min-height']);
  if (minH !== '100vh' && minH !== '100dvh') fail('body needs min-height: 100vh or 100dvh');

  // 3. body::before is an inert absolute layer below .content.
  const before = rulesFor(rules, 'body::before');
  if (before.length === 0) {
    fail('no body::before rule');
  } else {
    if (last(before, ['position']) !== 'absolute') fail('body::before needs position: absolute');
    const inset = last(before, ['inset']);
    const sides = ['top', 'right', 'bottom', 'left'].map((p) => last(before, [p]));
    const zero = (v: string | null): boolean => v !== null && /^0(?:px)?$/.test(v);
    if (!(inset !== null && inset.split(/\s+/).every(zero)) && !sides.every(zero)) {
      fail('body::before needs inset: 0');
    }
    if (last(before, ['pointer-events']) !== 'none') fail('body::before needs pointer-events: none');
    const z = last(before, ['z-index']);
    const contentZs = declValues(rulesFor(rules, '.content'), 'z-index').map(parseNumber);
    const contentZ = contentZs.length === 0 || contentZs.some((n) => n === null)
      ? null
      : Math.max(...(contentZs as number[]));
    const zn = z === null ? null : parseNumber(z);
    if (zn === null || !Number.isInteger(zn)) fail('body::before needs an integer z-index');
    else if (contentZ === null || !Number.isInteger(contentZ)) fail('.content needs an integer z-index');
    else if (zn >= contentZ) fail(`body::before z-index ${zn} must be below .content (${contentZ})`);

    // 4. radial gradients: fixed two-length ellipse, ending in transparent.
    for (const value of all(before, ['background', 'background-image'])) {
      for (const args of radialGradientArgs(value)) {
        const parts = splitArgs(args);
        if (!ELLIPSE_SIZE.test(parts[0] ?? '')) {
          fail(`body::before radial-gradient needs "ellipse <len> <len> at ..." (found "${(parts[0] ?? '').slice(0, 60)}")`);
        }
        if (!ENDS_TRANSPARENT.test(parts[parts.length - 1] ?? '')) {
          fail('body::before radial-gradient must end in transparent');
        }
      }
    }
  }

  // 5. no viewport-tall gradient layers on the fx host.
  for (const sel of ['#fx-host', '#fx-host::before', '#fx-host::after', '.fx-glow']) {
    const bg = all(rulesFor(rules, sel), ['background', 'background-image']);
    if (bg.some((v) => /gradient\(/i.test(v))) fail(`${sel} must not have a gradient background`);
  }

  // 6. no flat opaque panel that could end mid-page.
  for (const sel of ['.content', '#app', 'main', 'header', 'footer']) {
    for (const v of all(rulesFor(rules, sel), BG_PROPS)) {
      if (isOpaqueBackground(v)) fail(`${sel} paints an opaque background (${v.slice(0, 40)})`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------- narrow demo layout

/** Length in rem, or null when not a plain rem/px/em/0 value (px and em read at 16px per rem). */
function toRem(token: string): number | null {
  const m = /^(-?(?:\d+(?:\.\d*)?|\.\d+))(rem|em|px)?$/.exec(token.trim().toLowerCase());
  if (m === null) return null;
  const n = parseFloat(m[1]!);
  if (m[2] === undefined) return n === 0 ? 0 : null;
  return m[2] === 'px' ? n / 16 : n;
}

/**
 * Rule-level proxy for the compact narrow demo layout (Req 5.7, 5.8). Looks only at rules inside
 * `@media (max-width: 600px)`. It does not measure rendered height.
 */
export function checkNarrowDemoLayout(css: string): CssProblem[] {
  const block = parseCss(css).filter((r) =>
    r.context.some((c) => /^@media\b.*\(\s*max-width\s*:\s*600px\s*\)/i.test(c)),
  );
  const problems: CssProblem[] = [];
  const fail = (message: string): void => void problems.push({ check: 'narrow-demo', message });
  if (block.length === 0) return [{ check: 'narrow-demo', message: 'no @media (max-width: 600px) block' }];

  const list = declValues(rulesFor(block, '.demo-slot-list'), 'grid-template-columns');
  if (list.length === 0 || list[list.length - 1]!.trim() !== '1fr') {
    fail('.demo-slot-list needs grid-template-columns: 1fr');
  }

  const desc = rulesFor(block, '.demo-slot-description');
  for (const prop of ['-webkit-line-clamp', 'line-clamp']) {
    const v = declValues(desc, prop).at(-1);
    const n = v === undefined ? null : parseNumber(v);
    if (n === null || !Number.isInteger(n) || n < 1 || n > 2) {
      fail(`.demo-slot-description needs ${prop} of 1 or 2 (found ${v ?? 'none'})`);
    }
  }

  const pad = declValues(rulesFor(block, '.demo-slot-button'), 'padding').at(-1);
  const tokens = pad === undefined ? [] : pad.trim().split(/\s+/);
  const rems = tokens.map(toRem);
  if (tokens.length === 0 || tokens.length > 4 || rems.some((r) => r === null || r > 0.75)) {
    fail(`.demo-slot-button needs padding of 0.75rem or less (found ${pad ?? 'none'})`);
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
    ...checkFxLayers(css),
    ...checkLayout(css),
    ...checkReducedMotion(css),
    ...checkUrls(css),
    ...findStyleApiUse(css).map((v) => ({ check: 'style-api', message: `${v.name} at line ${v.line}` })),
  ];
}
