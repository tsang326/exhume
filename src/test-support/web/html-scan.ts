// Test-only static HTML reader for the page test. A small, forgiving parser that
// turns a string into an element tree plus the facts `page.static.test.ts` needs.
// It is not a full HTML5 parser: no implied html/head/body, no foster parenting.

export interface HtmlElement {
  readonly kind: 'element';
  readonly tag: string;
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: HtmlNode[];
  /** 0-based position among all start tags, in document order. */
  readonly order: number;
}

export interface HtmlText {
  readonly kind: 'text';
  readonly text: string;
}

export type HtmlNode = HtmlElement | HtmlText;

export interface HtmlDocument {
  readonly root: HtmlElement;
  /** Every element in document order. */
  readonly elements: readonly HtmlElement[];
  /** Comment bodies, in order. */
  readonly comments: readonly string[];
}

export interface HtmlScriptFact {
  readonly attrs: Readonly<Record<string, string>>;
  readonly content: string;
  readonly order: number;
}

export interface HtmlFacts {
  readonly cspMetaCount: number;
  /** `content` of the first CSP meta, or null. */
  readonly cspContent: string | null;
  /** Start-tag order of the first CSP meta, or null. */
  readonly cspOrder: number | null;
  /** Start-tag order of the first script, link or style element, or null. */
  readonly firstResourceOrder: number | null;
  /** True when there is a CSP meta and no script, link or style precedes it. */
  readonly cspBeforeResources: boolean;
  readonly scripts: readonly HtmlScriptFact[];
  /** Scripts whose content is not empty or whitespace. */
  readonly inlineScripts: readonly HtmlScriptFact[];
  readonly links: readonly Readonly<Record<string, string>>[];
  readonly styleElementCount: number;
  /** Every `on*` attribute (event handler), with its element tag. */
  readonly onAttributes: readonly { readonly tag: string; readonly name: string }[];
  /** Every element carrying a `style` attribute. */
  readonly styleAttributes: readonly { readonly tag: string }[];
  readonly lang: string | null;
  readonly title: string | null;
  readonly h1Count: number;
  /** Collapsed text content of each element that has an id (first wins). */
  readonly textById: Readonly<Record<string, string>>;
  /** Text outside tags, comments, script and style, joined with single spaces. */
  readonly visibleText: string;
}

const VOID = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr',
]);
const RAW_TEXT = new Set(['script', 'style', 'textarea', 'title']);
const NO_DECODE = new Set(['script', 'style']);

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const cp = parseInt(body.slice(2), 16);
      return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : whole;
    }
    if (body.startsWith('#')) {
      const cp = parseInt(body.slice(1), 10);
      return cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : whole;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

function isSpace(c: string | undefined): boolean {
  return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f';
}

function isLetter(c: string | undefined): boolean {
  return c !== undefined && /^[A-Za-z]$/.test(c);
}

/** Parse a tag body starting just after `<`. Returns the element data and the index after `>`. */
function readStartTag(
  html: string,
  start: number,
): { tag: string; attrs: Record<string, string>; selfClosing: boolean; next: number } {
  const n = html.length;
  let i = start;
  while (i < n && !isSpace(html[i]) && html[i] !== '>' && html[i] !== '/') i++;
  const tag = html.slice(start, i).toLowerCase();
  const attrs: Record<string, string> = {};
  let selfClosing = false;
  while (i < n) {
    while (i < n && isSpace(html[i])) i++;
    const c = html[i];
    if (c === undefined) break;
    if (c === '>') {
      i++;
      break;
    }
    if (c === '/') {
      if (html[i + 1] === '>') selfClosing = true;
      i++;
      continue;
    }
    const nameStart = i;
    while (i < n && !isSpace(html[i]) && html[i] !== '=' && html[i] !== '>' && html[i] !== '/') i++;
    const name = html.slice(nameStart, i).toLowerCase();
    while (i < n && isSpace(html[i])) i++;
    let value = '';
    if (html[i] === '=') {
      i++;
      while (i < n && isSpace(html[i])) i++;
      const q = html[i];
      if (q === '"' || q === "'") {
        const end = html.indexOf(q, i + 1);
        const stop = end < 0 ? n : end;
        value = html.slice(i + 1, stop);
        i = end < 0 ? n : end + 1;
      } else {
        const vs = i;
        while (i < n && !isSpace(html[i]) && html[i] !== '>') i++;
        value = html.slice(vs, i);
      }
    }
    if (name !== '' && !(name in attrs)) attrs[name] = decodeEntities(value);
  }
  return { tag, attrs, selfClosing, next: i };
}

export function parseHtml(html: string): HtmlDocument {
  const elements: HtmlElement[] = [];
  const comments: string[] = [];
  const root: HtmlElement = { kind: 'element', tag: '#document', attrs: {}, children: [], order: -1 };
  const stack: HtmlElement[] = [root];
  const top = (): HtmlElement => stack[stack.length - 1]!;
  const n = html.length;
  let order = 0;
  let i = 0;

  const addText = (text: string): void => {
    if (text !== '') top().children.push({ kind: 'text', text });
  };

  while (i < n) {
    if (html[i] !== '<') {
      const next = html.indexOf('<', i);
      const end = next < 0 ? n : next;
      addText(decodeEntities(html.slice(i, end)));
      i = end;
      continue;
    }
    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i + 4);
      comments.push(html.slice(i + 4, end < 0 ? n : end));
      i = end < 0 ? n : end + 3;
      continue;
    }
    const after = html[i + 1];
    if (after === '!' || after === '?') {
      const end = html.indexOf('>', i);
      i = end < 0 ? n : end + 1;
      continue;
    }
    if (after === '/' && isLetter(html[i + 2])) {
      const end = html.indexOf('>', i);
      const name = html.slice(i + 2, end < 0 ? n : end).trim().split(/\s/)[0]!.toLowerCase();
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k]!.tag === name) {
          stack.length = k;
          break;
        }
      }
      i = end < 0 ? n : end + 1;
      continue;
    }
    if (isLetter(after)) {
      const { tag, attrs, selfClosing, next } = readStartTag(html, i + 1);
      if ((tag === 'p' || tag === 'li') && top().tag === tag) stack.pop();
      const el: HtmlElement = { kind: 'element', tag, attrs, children: [], order: order++ };
      top().children.push(el);
      elements.push(el);
      i = next;
      if (RAW_TEXT.has(tag)) {
        const lower = html.toLowerCase();
        const close = lower.indexOf('</' + tag, i);
        const stop = close < 0 ? n : close;
        const body = html.slice(i, stop);
        el.children.push({ kind: 'text', text: NO_DECODE.has(tag) ? body : decodeEntities(body) });
        const gt = close < 0 ? -1 : html.indexOf('>', close);
        i = gt < 0 ? n : gt + 1;
      } else if (!VOID.has(tag) && !selfClosing) {
        stack.push(el);
      }
      continue;
    }
    addText('<');
    i++;
  }
  return { root, elements, comments };
}

function collapse(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Collapsed text content of a node, including script and style text. */
export function textContent(node: HtmlNode): string {
  const parts: string[] = [];
  const walk = (nd: HtmlNode): void => {
    if (nd.kind === 'text') parts.push(nd.text);
    else for (const c of nd.children) walk(c);
  };
  walk(node);
  return collapse(parts.join(' '));
}

/** Text outside tags, comments, script and style, joined with single spaces. */
export function visibleText(doc: HtmlDocument): string {
  const parts: string[] = [];
  const walk = (nd: HtmlNode): void => {
    if (nd.kind === 'text') {
      const t = collapse(nd.text);
      if (t !== '') parts.push(t);
    } else if (nd.tag !== 'script' && nd.tag !== 'style') {
      for (const c of nd.children) walk(c);
    }
  };
  walk(doc.root);
  return parts.join(' ');
}

export function isCspMeta(el: HtmlElement): boolean {
  return el.tag === 'meta' && (el.attrs['http-equiv'] ?? '').trim().toLowerCase() === 'content-security-policy';
}

export function scanHtml(html: string): HtmlFacts {
  const doc = parseHtml(html);
  const els = doc.elements;
  const csp = els.filter(isCspMeta);
  const resources = els.filter((e) => e.tag === 'script' || e.tag === 'link' || e.tag === 'style');
  const firstCsp = csp[0];
  const firstRes = resources[0];
  const scripts: HtmlScriptFact[] = els
    .filter((e) => e.tag === 'script')
    .map((e) => ({
      attrs: e.attrs,
      content: e.children.map((c) => (c.kind === 'text' ? c.text : '')).join(''),
      order: e.order,
    }));
  const onAttributes: { tag: string; name: string }[] = [];
  const styleAttributes: { tag: string }[] = [];
  const textById: Record<string, string> = {};
  for (const e of els) {
    for (const name of Object.keys(e.attrs)) {
      if (name.startsWith('on')) onAttributes.push({ tag: e.tag, name });
      if (name === 'style') styleAttributes.push({ tag: e.tag });
    }
    const id = e.attrs['id'];
    if (id !== undefined && !(id in textById)) textById[id] = textContent(e);
  }
  const titleEl = els.find((e) => e.tag === 'title');
  const htmlEl = els.find((e) => e.tag === 'html');
  return {
    cspMetaCount: csp.length,
    cspContent: firstCsp === undefined ? null : (firstCsp.attrs['content'] ?? ''),
    cspOrder: firstCsp === undefined ? null : firstCsp.order,
    firstResourceOrder: firstRes === undefined ? null : firstRes.order,
    cspBeforeResources:
      firstCsp !== undefined && (firstRes === undefined || firstCsp.order < firstRes.order),
    scripts,
    inlineScripts: scripts.filter((s) => s.content.trim() !== ''),
    links: els.filter((e) => e.tag === 'link').map((e) => e.attrs),
    styleElementCount: els.filter((e) => e.tag === 'style').length,
    onAttributes,
    styleAttributes,
    lang: htmlEl === undefined ? null : (htmlEl.attrs['lang'] ?? null),
    title: titleEl === undefined ? null : textContent(titleEl),
    h1Count: els.filter((e) => e.tag === 'h1').length,
    textById,
    visibleText: visibleText(doc),
  };
}
