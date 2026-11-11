import { describe, it, expect } from 'vitest';
import {
  mayApplyAutoOpen,
  mayApplyAutoPreview,
  type AutoOpenInput,
  type AutoPreviewInput,
} from './auto-open';

// Validates: Requirements 7.5, 7.8, 8.14

const openBase: AutoOpenInput = { phase: 'empty', intentSeen: false, tokenAtStart: 3, tokenNow: 3 };
const previewBase: AutoPreviewInput = {
  phase: 'open',
  intentSeen: false,
  shownDiskIsAuto: true,
  exhumeTokenAtStart: 5,
  exhumeTokenNow: 5,
};

describe('mayApplyAutoOpen', () => {
  it('is true when empty, no intent, token unchanged', () => {
    expect(mayApplyAutoOpen(openBase)).toBe(true);
  });

  it('is false for phase open or lost', () => {
    expect(mayApplyAutoOpen({ ...openBase, phase: 'open' })).toBe(false);
    expect(mayApplyAutoOpen({ ...openBase, phase: 'lost' })).toBe(false);
  });

  it('is false once intent was seen', () => {
    expect(mayApplyAutoOpen({ ...openBase, intentSeen: true })).toBe(false);
  });

  it('is false when the open token changed', () => {
    expect(mayApplyAutoOpen({ ...openBase, tokenNow: 4 })).toBe(false);
    expect(mayApplyAutoOpen({ ...openBase, tokenNow: 2 })).toBe(false);
  });
});

describe('mayApplyAutoPreview', () => {
  it('is true when open, auto disk shown, no intent, exhume token unchanged', () => {
    expect(mayApplyAutoPreview(previewBase)).toBe(true);
  });

  it('is false for phase empty or lost', () => {
    expect(mayApplyAutoPreview({ ...previewBase, phase: 'empty' })).toBe(false);
    expect(mayApplyAutoPreview({ ...previewBase, phase: 'lost' })).toBe(false);
  });

  it('is false once intent was seen', () => {
    expect(mayApplyAutoPreview({ ...previewBase, intentSeen: true })).toBe(false);
  });

  it('is false when the shown disk is not the auto one', () => {
    expect(mayApplyAutoPreview({ ...previewBase, shownDiskIsAuto: false })).toBe(false);
  });

  it('is false when the exhume token changed', () => {
    expect(mayApplyAutoPreview({ ...previewBase, exhumeTokenNow: 6 })).toBe(false);
    expect(mayApplyAutoPreview({ ...previewBase, exhumeTokenNow: 4 })).toBe(false);
  });
});
