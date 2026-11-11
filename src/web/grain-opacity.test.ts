// Req 6.8: the shipped --grain-opacity is measured, not chosen. Whole-percent steps 22, 20, ..., 10
// are tried against the real grain.png; the highest step for which every text pair still passes
// is the one src/style.css must declare. If none passes, the grain moves into the section backgrounds.
// Run with EXHUME_REPORT=1 to print the result line.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { overTextContrast, parseCss, readPairs } from '../test-support/web/css-scan';
import { readPng } from '../test-support/web/png-read';
import type { Rgb } from './logic/contrast';

const css = readFileSync(new URL('../style.css', import.meta.url), 'utf8');
const png = readPng(new Uint8Array(readFileSync(new URL('../assets/img/grain.png', import.meta.url))));

const STEPS = [22, 20, 18, 16, 14, 12, 10] as const;

/** Every distinct (grey level, alpha) in the texture; alpha 0 pixels change nothing and are skipped. */
function layers(): { grey: number; alpha: number }[] {
  const seen = new Set<number>();
  const out: { grey: number; alpha: number }[] = [];
  for (let i = 0; i < png.width * png.height; i++) {
    const grey = png.rgba[i * 4]!;
    const alpha = png.rgba[i * 4 + 3]!;
    if (alpha === 0) continue;
    const key = grey * 256 + alpha;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ grey, alpha });
  }
  return out;
}

interface Worst {
  readonly id: string;
  readonly ratio: number;
  readonly min: number;
}

/** Text pairs only (not `-ui` borders). Returns whether all pass at `step`, and the tightest margin. */
function measure(step: number): { pass: boolean; worst: Worst } {
  const pairs = readPairs(css).filter((p) => !p.id.endsWith('-ui') && p.fgRgb !== null && p.bgRgb !== null);
  const ls = layers();
  let worst: Worst = { id: '', ratio: Infinity, min: 0 };
  let worstMargin = Infinity;
  let pass = true;
  for (const p of pairs) {
    for (const l of ls) {
      const layer: Rgb = [l.grey, l.grey, l.grey];
      const alpha = (l.alpha / 255) * (step / 100);
      const ratio = overTextContrast(p.fgRgb!, p.bgRgb!, layer, alpha);
      const margin = ratio / p.min;
      if (ratio < p.min) pass = false;
      if (margin < worstMargin) {
        worstMargin = margin;
        worst = { id: p.id, ratio, min: p.min };
      }
    }
  }
  return { pass, worst };
}

function pick(): { step: number | null; worst: Worst } {
  for (const step of STEPS) {
    const m = measure(step);
    if (m.pass) return { step, worst: m.worst };
  }
  return { step: null, worst: measure(STEPS[STEPS.length - 1]!).worst };
}

describe('grain opacity (Req 6.8)', () => {
  const picked = pick();
  const text =
    picked.step === null ? 'grain-opacity: fallback-section-backgrounds' : `grain-opacity: 0.${String(picked.step).padStart(2, '0')}`;

  if (process.env.EXHUME_REPORT === '1') {
    console.log(`${text} (worst pair ${picked.worst.id}: ${picked.worst.ratio.toFixed(2)}:1, needs ${picked.worst.min}:1)`);
  }

  it('reads a real grain texture and text pairs', () => {
    expect(png.width).toBeGreaterThan(0);
    expect(layers().length).toBeGreaterThan(0);
    expect(readPairs(css).length).toBeGreaterThan(0);
  });

  it('declares the highest passing step, or the documented fallback', () => {
    const rules = parseCss(css);
    const decls = rules.flatMap((r) => r.decls.filter((d) => d.prop === '--grain-opacity').map((d) => d.value));
    if (picked.step === null) {
      expect(decls).toEqual([]);
      expect(rules.some((r) => r.selector === 'body::after')).toBe(false);
    } else {
      expect(decls).toHaveLength(1);
      expect(Math.round(parseFloat(decls[0]!) * 100)).toBe(picked.step);
    }
  });
});
