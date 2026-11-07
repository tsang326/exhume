import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  dbfCleanTableArb,
  dbfNeedsRepairTableArb,
  expandContent,
  pcxSourceArb,
  rgbaBlockImageArb,
  rgbaImageArb,
  wsParagraphsArb,
  contentSpecArb,
} from './arbitraries';
import { hostileInputArb } from './hostile';
import type { HostileFormat } from './hostile';
import { decodePng, encodePcx, writeDbf, writeWordStar } from './index';

describe('format arbitraries', () => {
  it('WordStar paragraphs are accepted by the writer', () => {
    for (const p of fc.sample(wsParagraphsArb, 20)) {
      expect(writeWordStar(p)).toBeInstanceOf(Uint8Array);
    }
  });

  it('dBase tables (clean and needs-repair) are accepted by the writer', () => {
    for (const t of fc.sample(dbfCleanTableArb, 15)) expect(writeDbf(t).length).toBeGreaterThan(32);
    const repair = fc.sample(dbfNeedsRepairTableArb, 15);
    for (const t of repair) expect(writeDbf(t).length).toBeGreaterThan(32);
  });

  it('PCX sources are accepted by the encoder and cover all five modes', () => {
    const modes = new Set<string>();
    for (const s of fc.sample(pcxSourceArb(64), 60)) {
      expect(s.width).toBeLessThanOrEqual(64);
      expect(s.height).toBeLessThanOrEqual(64);
      expect(encodePcx(s)[0]).toBe(0x0a);
      modes.add(s.mode);
    }
    expect(modes.size).toBe(5);
  });

  it('RGBA images have consistent sizes, and the block arbitrary stays within 300 by 100', () => {
    for (const i of fc.sample(rgbaImageArb(), 10)) expect(i.rgba.length).toBe(i.width * i.height * 4);
    for (const i of fc.sample(rgbaBlockImageArb, 10)) {
      expect(i.width).toBeLessThanOrEqual(300);
      expect(i.height).toBeLessThanOrEqual(100);
      expect(i.rgba.length).toBe(i.width * i.height * 4);
    }
    expect(typeof decodePng).toBe('function');
  });

  it('expandContent is deterministic and has the requested length', () => {
    const a = expandContent(42, 5000);
    expect(a.length).toBe(5000);
    expect(expandContent(42, 5000)).toEqual(a);
    expect(expandContent(43, 5000)).not.toEqual(a);
    for (const c of fc.sample(contentSpecArb(0, 100), 5)) {
      expect(expandContent(c.seed, c.length).length).toBe(c.length);
    }
  });

  it('hostile generators produce Uint8Array inputs for every format', () => {
    const formats: HostileFormat[] = ['wordstar', 'dbase', 'pcx', 'auto'];
    for (const f of formats) {
      for (const h of fc.sample(hostileInputArb(f), 12)) {
        expect(h.bytes).toBeInstanceOf(Uint8Array);
        expect(h.format).toBe(f);
      }
    }
  });
});
