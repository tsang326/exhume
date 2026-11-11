// Demo card art: an <svg><use href="#d-…"/></svg> that points at a symbol in the index.html sprite.
// The symbol id comes from a fixed map keyed by registry id, never from disk or user text.
const SVG_NS = 'http://www.w3.org/2000/svg';

const DEMO_ART: Readonly<Record<string, string>> = {
  'writers-disk': 'd-writers',
  'office-disk': 'd-office',
  'damaged-disk': 'd-damaged',
};

/** The sprite symbol id for a registry id, or null when the id has no art. */
export function demoArtSymbol(id: string): string | null {
  return Object.prototype.hasOwnProperty.call(DEMO_ART, id) ? DEMO_ART[id] : null;
}

/** Builds the decorative SVG for a demo id. Unknown ids give null. */
export function demoArt(id: string): SVGSVGElement | null {
  const symbol = demoArtSymbol(id);
  if (symbol === null) return null;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const use = document.createElementNS(SVG_NS, 'use');
  use.setAttribute('href', `#${symbol}`);
  svg.appendChild(use);
  return svg;
}
