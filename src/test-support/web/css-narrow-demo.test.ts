import { describe, expect, it } from 'vitest';
import { checkNarrowDemoLayout } from './css-scan';

const GOOD = `
.demo-slot-list { display: grid; grid-template-columns: repeat(3, 1fr); }
@media (max-width: 600px) {
  .demo-slot { padding: 0.75rem; }
  .demo-slot-list { grid-template-columns: 1fr; gap: 0.5rem; }
  .demo-slot-button { padding: 0.5rem; gap: 0; }
  .demo-slot-description {
    font-size: 0.8125rem; display: -webkit-box;
    -webkit-line-clamp: 2; line-clamp: 2; overflow: hidden;
  }
}
`;

const messages = (css: string): string => checkNarrowDemoLayout(css).map((p) => p.message).join('\n');

describe('checkNarrowDemoLayout', () => {
  it('accepts the compact narrow layout', () => {
    expect(checkNarrowDemoLayout(GOOD)).toEqual([]);
  });

  it('reports a missing media block', () => {
    expect(messages('.demo-slot-list { grid-template-columns: 1fr; }')).toContain('max-width: 600px');
  });

  it('ignores declarations outside the narrow block', () => {
    const css = GOOD.replace('grid-template-columns: 1fr;', '').replace(
      '@media',
      '.demo-slot-list { grid-template-columns: 1fr; }\n@media',
    );
    expect(messages(css)).toContain('grid-template-columns: 1fr');
  });

  it('flags a multi-column list, large clamp, missing clamp and large padding', () => {
    expect(messages(GOOD.replace('grid-template-columns: 1fr', 'grid-template-columns: 1fr 1fr'))).toContain(
      'grid-template-columns',
    );
    expect(messages(GOOD.replace('-webkit-line-clamp: 2', '-webkit-line-clamp: 3'))).toContain('-webkit-line-clamp');
    expect(messages(GOOD.replace('line-clamp: 2; overflow', 'overflow'))).toContain('needs line-clamp');
    expect(messages(GOOD.replace('padding: 0.5rem', 'padding: 1rem'))).toContain('padding');
    expect(messages(GOOD.replace('padding: 0.5rem', 'padding: 0.5rem 1rem'))).toContain('padding');
  });

  it('flags hidden demo rules', () => {
    expect(messages(GOOD.replace('gap: 0;', 'display: none;'))).toContain('display: none');
    expect(messages(GOOD.replace('overflow: hidden;', 'visibility: hidden;'))).toContain('visibility: hidden');
  });
});
