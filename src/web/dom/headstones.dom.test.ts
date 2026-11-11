// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { bindHeadstones } from './headstones';

const build = (): HTMLElement => {
  const root = document.createElement('div');
  root.innerHTML =
    '<button type="button" class="hs" data-path="/CHAPTER1.WS"><span class="sn">CHAPTER1.WS</span></button>' +
    '<button type="button" class="hs" data-path="/_RAFT1.WS"><span class="sn">_RAFT1.WS</span></button>' +
    '<button type="button" class="hs"><span class="sn">no path</span></button>' +
    '<button type="button" class="other" data-path="/X.TXT">x</button>';
  return root;
};

describe('bindHeadstones (happy-dom)', () => {
  it('calls onOpen with the data-path of the clicked stone', () => {
    const root = build();
    const onOpen = vi.fn();
    bindHeadstones(root, onOpen);
    root.querySelectorAll<HTMLElement>('button.hs')[1]?.click();
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith('/_RAFT1.WS');
  });

  it('ignores stones without data-path and buttons that are not stones', () => {
    const root = build();
    const onOpen = vi.fn();
    bindHeadstones(root, onOpen);
    root.querySelectorAll<HTMLElement>('button.hs')[2]?.click();
    root.querySelector<HTMLElement>('button.other')?.click();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('is a no-op for a missing root', () => {
    expect(() => bindHeadstones(null, vi.fn())).not.toThrow();
  });
});
