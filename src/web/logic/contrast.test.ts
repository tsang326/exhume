import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { compositeOver, contrastRatio, parseHexColor, relativeLuminance, type Rgb } from './contrast';
import { numRuns } from '../../test-support/runs';

const channel = fc.integer({ min: 0, max: 255 });
const rgb: fc.Arbitrary<Rgb> = fc.tuple(channel, channel, channel);
const hexDigit = fc.constantFrom(...'0123456789abcdefABCDEF'.split(''));
const hex3 = fc.array(hexDigit, { minLength: 3, maxLength: 3 }).map((d) => `#${d.join('')}`);
const hex6 = fc.array(hexDigit, { minLength: 6, maxLength: 6 }).map((d) => `#${d.join('')}`);

describe('contrast examples', () => {
  it('black on white is 21 and white on white is 1', () => {
    expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBe(21);
    expect(contrastRatio([255, 255, 255], [255, 255, 255])).toBe(1);
  });

  it('matches known design ratios', () => {
    const fg = parseHexColor('#ffd27a')!;
    const bg = parseHexColor('#141c1e')!;
    expect(contrastRatio(fg, bg)).toBeCloseTo(12.15, 1);
  });

  it('parses the two hex forms and rejects others', () => {
    expect(parseHexColor('#fff')).toEqual([255, 255, 255]);
    expect(parseHexColor('#0b0f10')).toEqual([11, 15, 16]);
    for (const bad of ['', '#', '#ff', '#ffff', '#fffff', '#fffffff', 'fff', '#ggg', '#ffffff80', ' #fff']) {
      expect(parseHexColor(bad)).toBeNull();
    }
  });

  it('luminance of black and white', () => {
    expect(relativeLuminance([0, 0, 0])).toBe(0);
    expect(relativeLuminance([255, 255, 255])).toBe(1);
  });
});

describe('contrast properties', () => {
  // Feature: graveyard-ui, Property 34: The contrast function is a pure WCAG ratio
  // **Validates: Requirements 11.4, 12.15**
  it('Property 34: symmetric, within 1..21, identity is 1, repeatable', () => {
    fc.assert(
      fc.property(rgb, rgb, (a, b) => {
        const r = contrastRatio(a, b);
        return (
          r === contrastRatio(b, a) &&
          r >= 1 &&
          r <= 21 &&
          contrastRatio(a, a) === 1 &&
          r === contrastRatio(a, b)
        );
      }),
      { numRuns: numRuns(100) },
    );
  });

  // Feature: graveyard-ui, Property 34: The contrast function is a pure WCAG ratio
  // **Validates: Requirements 11.4, 12.15**
  it('Property 34: parseHexColor accepts #rgb and #rrggbb and rejects other strings', () => {
    fc.assert(
      fc.property(hex3, hex6, (s3, s6) => {
        const a = parseHexColor(s3);
        const b = parseHexColor(s6);
        if (a === null || b === null) return false;
        const expanded = parseHexColor(`#${s3[1]}${s3[1]}${s3[2]}${s3[2]}${s3[3]}${s3[3]}`);
        return (
          JSON.stringify(a) === JSON.stringify(expanded) &&
          b.every((v) => Number.isInteger(v) && v >= 0 && v <= 255)
        );
      }),
      { numRuns: numRuns(100) },
    );
    const others = fc.string({ maxLength: 12 }).filter((s) => !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s));
    fc.assert(fc.property(others, (s) => parseHexColor(s) === null), { numRuns: numRuns(100) });
  });

  // Feature: graveyard-ui, Property 34: The contrast function is a pure WCAG ratio
  // **Validates: Requirements 11.4, 12.15**
  it('Property 34: compositeOver alpha 0 gives the background and alpha 1 the foreground', () => {
    fc.assert(
      fc.property(rgb, rgb, fc.double({ min: 0, max: 1, noNaN: true }), (fg, bg, alpha) => {
        const mid = compositeOver(fg, alpha, bg);
        return (
          compositeOver(fg, 0, bg).join() === bg.join() &&
          compositeOver(fg, 1, bg).join() === fg.join() &&
          mid.every((v, i) => v >= Math.min(fg[i]!, bg[i]!) - 1e-9 && v <= Math.max(fg[i]!, bg[i]!) + 1e-9)
        );
      }),
      { numRuns: numRuns(100) },
    );
  });
});
