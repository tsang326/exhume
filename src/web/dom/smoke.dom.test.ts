// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';

describe('happy-dom smoke', () => {
  it('provides document, createElement and textContent', () => {
    const el = document.createElement('p');
    el.textContent = '<b>plain</b>';
    document.body.appendChild(el);
    expect(document.body.contains(el)).toBe(true);
    expect(el.textContent).toBe('<b>plain</b>');
    expect(el.children.length).toBe(0);
    el.remove();
  });

  it('dispatches events to listeners', () => {
    const btn = document.createElement('button');
    let clicks = 0;
    btn.addEventListener('click', () => {
      clicks += 1;
    });
    btn.dispatchEvent(new Event('click'));
    expect(clicks).toBe(1);
  });
});
