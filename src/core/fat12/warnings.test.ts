import { describe, expect, it } from 'vitest';
import { MAX_REASON_CHARS } from './limits';
import { WarningCode } from './types';
import { clampText, makeWarningSink } from './warnings';

describe('clampText', () => {
  it('keeps short text and clamps long text', () => {
    expect(clampText('abc')).toBe('abc');
    expect(clampText('x'.repeat(MAX_REASON_CHARS))).toHaveLength(MAX_REASON_CHARS);
    expect(clampText('x'.repeat(MAX_REASON_CHARS + 50))).toHaveLength(MAX_REASON_CHARS);
    expect(clampText('abcdef', 3)).toBe('abc');
  });
});

describe('makeWarningSink', () => {
  it('records warnings with optional path and clamps messages', () => {
    const s = makeWarningSink();
    s.add(WarningCode.BpbInvalid, 'a', 'P/X');
    s.add(WarningCode.ImageEmpty, 'y'.repeat(1000));
    const l = s.list();
    expect(l[0]).toEqual({ code: WarningCode.BpbInvalid, message: 'a', path: 'P/X' });
    expect(l[1]!.message).toHaveLength(MAX_REASON_CHARS);
    expect('path' in l[1]!).toBe(false);
  });

  it('list returns copies', () => {
    const s = makeWarningSink();
    s.add(WarningCode.BpbInvalid, 'a');
    s.list()[0]!.message = 'changed';
    expect(s.list()[0]!.message).toBe('a');
  });

  it('adds once-per-scan codes only once', () => {
    const s = makeWarningSink();
    for (const c of [
      WarningCode.FatCopiesDiffer,
      WarningCode.EntryLimit,
    ]) {
      s.add(c, 'one');
      s.add(c, 'two');
    }
    expect(s.list()).toHaveLength(2);
    s.add(WarningCode.BpbInvalid, 'one');
    s.add(WarningCode.BpbInvalid, 'two');
    expect(s.list()).toHaveLength(4);
  });

  it('keeps only the first warning per walk', () => {
    const s = makeWarningSink();
    s.beginWalk();
    s.add(WarningCode.BpbInvalid, 'first');
    s.add(WarningCode.ImageEmpty, 'second');
    s.endWalk();
    s.beginWalk();
    s.add(WarningCode.ImageEmpty, 'third');
    s.add(WarningCode.ImageEmpty, 'fourth');
    s.endWalk();
    s.add(WarningCode.ImageEmpty, 'fifth');
    expect(s.list().map((w) => w.message)).toEqual(['first', 'third', 'fifth']);
  });
});
