import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { numRuns } from '../../test-support/runs';
import { MAX_WARNINGS } from './limits';
import { ConversionWarningCode } from './types';
import { makeWarningCollector } from './warnings';

const CODE = ConversionWarningCode.ControlCodesDropped;

describe('warning collector', () => {
  // Feature: format-resurrection, Property 4: The warning collector is bounded
  it('is bounded, capped exactly once, and keeps the first warnings in order', () => {
    // **Validates: Requirements 1.12**
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { minLength: 0, maxLength: 300 }),
        (useOnce) => {
          const c = makeWarningCollector();
          useOnce.forEach((once, i) => {
            if (once) c.addOnce(CODE, 'm' + i, i);
            else c.add(CODE, 'm' + i);
          });
          const list = c.list();
          const n = useOnce.length;
          if (list.length > MAX_WARNINGS + 1) return false;
          const capped = list.filter((w) => w.code === ConversionWarningCode.WarningsCapped);
          if (n <= MAX_WARNINGS) {
            if (list.length !== n || capped.length !== 0) return false;
          } else {
            if (list.length !== MAX_WARNINGS + 1 || capped.length !== 1) return false;
            if (list[MAX_WARNINGS]!.code !== ConversionWarningCode.WarningsCapped) return false;
          }
          const kept = Math.min(n, MAX_WARNINGS);
          for (let i = 0; i < kept; i++) {
            if (list[i]!.message !== 'm' + i) return false;
          }
          return true;
        },
      ),
      { numRuns: numRuns(100) },
    );
  });

  it('exactly 100 adds give 100 warnings and no cap', () => {
    const c = makeWarningCollector();
    for (let i = 0; i < 100; i++) c.add(CODE, 'x');
    const list = c.list();
    expect(list).toHaveLength(100);
    expect(list.some((w) => w.code === ConversionWarningCode.WarningsCapped)).toBe(false);
  });

  it('101 adds give 100 plus one warnings-capped', () => {
    const c = makeWarningCollector();
    for (let i = 0; i < 101; i++) c.add(CODE, 'x');
    const list = c.list();
    expect(list).toHaveLength(101);
    expect(list[100]!.code).toBe(ConversionWarningCode.WarningsCapped);
  });

  it('addOnce duplicates do not count toward the cap', () => {
    const c = makeWarningCollector();
    for (let i = 0; i < 500; i++) c.addOnce(CODE, 'dup', 7);
    expect(c.list()).toHaveLength(1);
    for (let i = 0; i < 99; i++) c.add(CODE, 'x');
    for (let i = 0; i < 50; i++) c.addOnce(CODE, 'dup', 7);
    const list = c.list();
    expect(list).toHaveLength(100);
    expect(list.some((w) => w.code === ConversionWarningCode.WarningsCapped)).toBe(false);
  });

  it('adds after the cap are ignored', () => {
    const c = makeWarningCollector();
    for (let i = 0; i < 300; i++) c.add(CODE, 'x');
    expect(c.list()).toHaveLength(101);
  });
});
