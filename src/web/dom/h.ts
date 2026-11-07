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

export function h(
  tag: AllowedTag,
  attrs?: Partial<Record<AttrName, string>>,
  ...children: Array<Node | string>
): HTMLElement {
  const el = document.createElement(tag);
  if (attrs !== undefined) {
    for (const key of Object.keys(attrs)) {
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
export function setDownloadHref(a: HTMLAnchorElement, blobUrl: string, safeFileName: string): void {
  a.setAttribute('href', blobUrl);
  a.setAttribute('download', safeFileName);
}

/** The ONLY place in the web sources that sets `src` or `alt` on an img. */
export function setSrcBlob(img: HTMLImageElement, blobUrl: string, safeName: string): void {
  if (!SAFE_NAME.test(safeName)) throw new Error('unsafe image name');
  img.src = blobUrl;
  img.alt = safeName;
}
