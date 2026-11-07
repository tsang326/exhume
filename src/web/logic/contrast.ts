// Pure WCAG 2.x contrast helpers. No DOM, no globals.

export type Rgb = readonly [number, number, number];

const HEX3 = /^#([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])$/;
const HEX6 = /^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/;

/** Parse `#rgb` or `#rrggbb` (case-insensitive). Anything else gives null. */
export function parseHexColor(hex: string): Rgb | null {
  if (typeof hex !== 'string') return null;
  const m3 = HEX3.exec(hex);
  if (m3 !== null) {
    return [
      parseInt(m3[1]! + m3[1]!, 16),
      parseInt(m3[2]! + m3[2]!, 16),
      parseInt(m3[3]! + m3[3]!, 16),
    ];
  }
  const m6 = HEX6.exec(hex);
  if (m6 !== null) {
    return [parseInt(m6[1]!, 16), parseInt(m6[2]!, 16), parseInt(m6[3]!, 16)];
  }
  return null;
}

function linear(channel: number): number {
  const s = Math.min(255, Math.max(0, channel)) / 255;
  return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG 2.x relative luminance of an sRGB color with 0..255 channels. */
export function relativeLuminance(c: Rgb): number {
  const l = 0.2126 * linear(c[0]) + 0.7152 * linear(c[1]) + 0.0722 * linear(c[2]);
  return Math.min(1, Math.max(0, l));
}

/** WCAG 2.x contrast ratio, symmetric, always within 1..21. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return Math.min(21, Math.max(1, (hi + 0.05) / (lo + 0.05)));
}

/** Composite `fg` at `alpha` (clamped to 0..1) over `bg`. Alpha 0 gives bg, alpha 1 gives fg. */
export function compositeOver(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  const a = Number.isNaN(alpha) ? 0 : Math.min(1, Math.max(0, alpha));
  return [
    fg[0] * a + bg[0] * (1 - a),
    fg[1] * a + bg[1] * (1 - a),
    fg[2] * a + bg[2] * (1 - a),
  ];
}
