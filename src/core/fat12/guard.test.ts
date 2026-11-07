import { describe, expect, it } from 'vitest';
import { guarded } from './guard';
import { WarningCode } from './types';
import { makeWarningSink } from './warnings';

describe('guarded', () => {
  it('returns fn() and adds no warning when nothing throws', () => {
    const sink = makeWarningSink();
    expect(guarded('walk', () => 42, () => -1, sink)).toBe(42);
    expect(sink.list()).toEqual([]);
  });

  it('adds one internal-error warning and keeps earlier results', () => {
    const sink = makeWarningSink();
    const found: number[] = [];
    const result = guarded(
      'walk',
      () => {
        found.push(1, 2);
        throw new Error('disk text: EVIL.TXT');
      },
      () => found,
      sink,
    );
    expect(result).toEqual([1, 2]);
    const warnings = sink.list();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.code).toBe(WarningCode.InternalError);
    expect(warnings[0]?.message).toContain('walk');
    expect(warnings[0]?.message).not.toContain('EVIL');
  });

  it.each([['boom'], [undefined], [null], [7]])('handles thrown non-Error value %s', (value) => {
    const sink = makeWarningSink();
    const result = guarded(
      'x',
      () => {
        throw value;
      },
      () => 'fallback',
      sink,
    );
    expect(result).toBe('fallback');
    expect(sink.list().map((w) => w.code)).toEqual([WarningCode.InternalError]);
  });
});
