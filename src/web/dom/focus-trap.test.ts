import { describe, it, expect } from 'vitest';
import { trapTab, focusableIn } from './focus-trap';

function item(name: string, log: string[], attrs: Record<string, string> = {}): HTMLElement {
  return {
    hasAttribute: (k: string) => k in attrs,
    getAttribute: (k: string) => attrs[k] ?? null,
    getClientRects: () => [{}],
    focus: () => {
      log.push(name);
    },
  } as unknown as HTMLElement;
}

function setup(items: HTMLElement[], active: HTMLElement | null) {
  const root = {
    querySelectorAll: () => items,
    ownerDocument: { activeElement: active },
  } as unknown as HTMLElement;
  return root;
}

function key(shift: boolean, k = 'Tab') {
  const state = { prevented: false };
  const e = { key: k, shiftKey: shift, preventDefault: () => (state.prevented = true) } as unknown as KeyboardEvent;
  return { e, state };
}

describe('trapTab', () => {
  it('wraps forward from the last item to the first', () => {
    const log: string[] = [];
    const a = item('a', log);
    const b = item('b', log);
    const { e, state } = key(false);
    trapTab(setup([a, b], b), e);
    expect(log).toEqual(['a']);
    expect(state.prevented).toBe(true);
  });

  it('wraps backward from the first item to the last', () => {
    const log: string[] = [];
    const a = item('a', log);
    const b = item('b', log);
    trapTab(setup([a, b], a), key(true).e);
    expect(log).toEqual(['b']);
  });

  it('pulls focus in when it is outside the dialog', () => {
    const log: string[] = [];
    const a = item('a', log);
    const b = item('b', log);
    trapTab(setup([a, b], null), key(false).e);
    expect(log).toEqual(['a']);
  });

  it('skips disabled and hidden items and ignores other keys', () => {
    const log: string[] = [];
    const a = item('a', log);
    const off = item('off', log, { disabled: '' });
    const gone = item('gone', log, { hidden: '' });
    expect(focusableIn(setup([off, a, gone], a))).toEqual([a]);
    const { e, state } = key(false, 'Enter');
    trapTab(setup([a], a), e);
    expect(state.prevented).toBe(false);
    expect(log).toEqual([]);
  });
});
