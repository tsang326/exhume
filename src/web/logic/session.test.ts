import { describe, expect, it } from 'vitest';
import type { DiskReport } from '../../core/fat12/index';
import {
  actionsEnabled,
  applyLost,
  applyOpenFailed,
  applyOpened,
  canExhume,
  canReopen,
  createSession,
  reopenBytes,
} from './session';

const report = { files: [] } as unknown as DiskReport;

describe('session transitions', () => {
  it('starts empty and cannot exhume or reopen', () => {
    const s = createSession();
    expect(s.phase).toBe('empty');
    expect(canExhume(s)).toBe(false);
    expect(canReopen(s)).toBe(false);
    expect(reopenBytes(s)).toBeNull();
  });

  it('opened replaces held bytes, report and items', () => {
    const a = new Uint8Array([1]);
    const b = new Uint8Array([2]);
    const s1 = applyOpened(createSession(), a, report, []);
    expect(s1.phase).toBe('open');
    expect(canExhume(s1)).toBe(true);
    const s2 = applyOpened(s1, b, report, []);
    expect(s2.held).toBe(b);
  });

  it('lost keeps list and held bytes and offers reopen', () => {
    const a = new Uint8Array([1]);
    const s1 = applyOpened(createSession(), a, report, []);
    const s2 = applyLost(s1);
    expect(s2.phase).toBe('lost');
    expect(s2.report).toBe(report);
    expect(actionsEnabled(s2)).toBe(false);
    expect(reopenBytes(s2)).toBe(a);
    expect(applyLost(s2)).toBe(s2);
  });

  it('lost before any disk opened stays empty', () => {
    const s = applyLost(createSession());
    expect(s.phase).toBe('empty');
    expect(canReopen(s)).toBe(false);
  });

  it('a successful open after lost returns to open', () => {
    const a = new Uint8Array([1]);
    const lost = applyLost(applyOpened(createSession(), a, report, []));
    const again = applyOpened(lost, a, report, []);
    expect(again.phase).toBe('open');
  });

  it('a failed open changes nothing', () => {
    const s = applyOpened(createSession(), new Uint8Array([1]), report, []);
    expect(applyOpenFailed(s)).toBe(s);
  });
});
