import { describe, expect, it } from 'vitest';
import { checkBackground } from './css-scan';

const GOOD = `
:root { --pair-body-bg: #0b0f10; }
html { background: var(--pair-body-bg); }
body { position: relative; min-height: 100dvh; }
body::before {
  content: ''; position: absolute; inset: 0; pointer-events: none; z-index: 0;
  background: radial-gradient(ellipse 900px 600px at 50% 0, rgba(1, 2, 3, 0.4), transparent 70%);
}
#fx-host { position: fixed; z-index: 0; pointer-events: none; }
.content { position: relative; z-index: 10; background: transparent; }
`;

describe('checkBackground', () => {
  it('accepts a well-formed background', () => {
    expect(checkBackground(GOOD)).toEqual([]);
  });

  it('flags a percentage-sized gradient, a gradient on #fx-host and an opaque .content', () => {
    const bad = GOOD.replace('ellipse 900px 600px', 'ellipse 80% 50%')
      .replace('#fx-host { ', '#fx-host { background: radial-gradient(ellipse 1px 1px at 0 0, red, transparent); ')
      .replace('background: transparent', 'background: #111');
    const msgs = checkBackground(bad).map((p) => p.message).join('\n');
    expect(msgs).toContain('ellipse <len> <len>');
    expect(msgs).toContain('#fx-host must not have a gradient');
    expect(msgs).toContain('.content paints an opaque background');
  });
});
