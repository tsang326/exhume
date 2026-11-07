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
