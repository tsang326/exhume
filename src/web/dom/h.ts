// DOM helper: the one place that builds nodes for application content.
// No HTML string sink is used here. Text always goes in as Text nodes.

export type AttrName =
  | 'class'
  | 'id'
  | 'role'
  | 'type'
  | 'hidden'
  | 'inert'
  | 'tabindex'
  | 'disabled'
  | 'open'
  | 'aria-label'
  | 'aria-labelledby'
  | 'aria-describedby'
  | 'aria-modal'
  | 'aria-live'
  | 'aria-hidden'
  | 'aria-disabled'
  | 'aria-expanded'
  | 'aria-busy'
  | 'title'
  | 'lang'
  | 'for'
  | 'colspan'
  | 'scope'
  | 'download'
  | `data-${string}`;

export type AllowedTag =
  | 'div'
  | 'span'
  | 'p'
  | 'ul'
  | 'li'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'button'
  | 'a'
  | 'img'
  | 'table'
  | 'thead'
  | 'tbody'
  | 'tr'
  | 'th'
  | 'td'
  | 'details'
  | 'summary'
  | 'section'
  | 'header'
  | 'main'
  | 'footer'
  | 'br'
  | 'hr'
  | 'strong'
  | 'em'
  | 'canvas';

const SAFE_NAME = /^[A-Za-z0-9._-]{1,64}$/;
const DATA_ATTR = /^data-[a-z0-9-]+$/;

// Exact, lower-case names only. Anything else (other case, spaces) is rejected.
const ALLOWED_ATTRS: ReadonlySet<string> = new Set([
  'class',
  'id',
  'role',
  'type',
  'hidden',
  'inert',
  'tabindex',
  'disabled',
  'open',
  'aria-label',
  'aria-labelledby',
  'aria-describedby',
  'aria-modal',
  'aria-live',
  'aria-hidden',
  'aria-disabled',
  'aria-expanded',
  'aria-busy',
  'title',
  'lang',
  'for',
  'colspan',
  'scope',
  'download',
]);

function assertAllowedAttr(name: string): void {
  if (ALLOWED_ATTRS.has(name)) return;
  if (name.length <= 100 && DATA_ATTR.test(name)) return;
  throw new Error('attribute not allowed');
}

function assertBlobUrl(blobUrl: string, isOwned?: (url: string) => boolean): void {
  if (!blobUrl.startsWith('blob:')) throw new Error('not a blob URL');
  if (isOwned !== undefined && !isOwned(blobUrl)) throw new Error('blob URL not owned');
}

export function h(
  tag: AllowedTag,
  attrs?: Partial<Record<AttrName, string>>,
  ...children: Array<Node | string>
): HTMLElement {
  const keys = attrs === undefined ? [] : Object.keys(attrs);
  for (const key of keys) assertAllowedAttr(key);
  const el = document.createElement(tag);
  if (attrs !== undefined) {
    for (const key of keys) {
      const value = (attrs as Record<string, string | undefined>)[key];
      if (value !== undefined) el.setAttribute(key, value);
    }
  }
  for (const child of children) {
    el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return el;
}

/** Removes every child with a removeChild loop. Never an HTML sink. */
export function clear(node: Node): void {
  while (node.firstChild !== null) node.removeChild(node.firstChild);
}

/** Points a download link at a Blob URL made in this session. */
export function setDownloadHref(
  a: HTMLAnchorElement,
  blobUrl: string,
  safeFileName: string,
  isOwned?: (url: string) => boolean,
): void {
  assertBlobUrl(blobUrl, isOwned);
  if (!SAFE_NAME.test(safeFileName)) throw new Error('unsafe file name');
  a.setAttribute('href', blobUrl);
  a.setAttribute('download', safeFileName);
}

/** The ONLY place in the web sources that sets `src` or `alt` on an img. */
export function setSrcBlob(
  img: HTMLImageElement,
  blobUrl: string,
  safeName: string,
  isOwned?: (url: string) => boolean,
): void {
  assertBlobUrl(blobUrl, isOwned);
  if (!SAFE_NAME.test(safeName)) throw new Error('unsafe image name');
  img.src = blobUrl;
  img.alt = safeName;
}
