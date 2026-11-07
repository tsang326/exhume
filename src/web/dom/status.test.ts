import { describe, expect, it } from 'vitest';
import { createStatusRegion } from './status';

describe('createStatusRegion', () => {
  it('sets and clears textContent', () => {
    const el = { textContent: 'old' } as unknown as HTMLElement;
    const region = createStatusRegion(el);
    region.set('<b>hi</b>');
    expect(el.textContent).toBe('<b>hi</b>');
    region.clear();
    expect(el.textContent).toBe('');
  });
});
