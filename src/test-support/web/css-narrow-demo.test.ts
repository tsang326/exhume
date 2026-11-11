import { describe, expect, it } from 'vitest';
import { checkNarrowCardList, checkNarrowQuery, queryWidth } from './css-scan';

const GOOD = `
.demo-slot-list { display: grid; grid-template-columns: repeat(3, 1fr); }
@media (max-width: 760px) {
  .demo-slot-list { grid-template-columns: 1fr; gap: 0.5rem; }
  .demo-slot-button { padding: 0.5rem; }
}
`;

const messages = (css: string): string => checkNarrowCardList(css).map((p) => p.message).join('\n');

describe('checkNarrowCardList', () => {
  it('accepts a one-column card list in the narrow block', () => {
    expect(checkNarrowCardList(GOOD)).toEqual([]);
    expect(checkNarrowCardList(GOOD.replace('1fr; gap', 'minmax(0, 1fr); gap'))).toEqual([]);
  });

  it('reports a missing media block', () => {
    expect(messages('.demo-slot-list { grid-template-columns: 1fr; }')).toContain('max-width: 760px');
    expect(messages(GOOD.replace('760px', '600px'))).toContain('max-width: 760px');
  });

  it('ignores declarations outside the narrow block', () => {
    const css = GOOD.replace('grid-template-columns: 1fr;', '').replace(
      '@media',
      '.demo-slot-list { grid-template-columns: 1fr; }\n@media',
    );
    expect(messages(css)).toContain('grid-template-columns: 1fr');
  });

  it('flags a multi-column list', () => {
    expect(messages(GOOD.replace('grid-template-columns: 1fr;', 'grid-template-columns: 1fr 1fr;'))).toContain('1fr 1fr');
  });

  it('flags hidden demo rules in the narrow block', () => {
    expect(messages(GOOD.replace('padding: 0.5rem;', 'display: none;'))).toContain('display: none');
    expect(messages(GOOD.replace('gap: 0.5rem;', 'visibility: hidden;'))).toContain('visibility: hidden');
  });
});

describe('checkNarrowQuery', () => {
  it('reads the width of a max-width query', () => {
    expect(queryWidth('(max-width: 760px)')).toBe(760);
    expect(queryWidth('(prefers-reduced-motion: reduce)')).toBeNull();
  });

  it('accepts a sheet whose only breakpoint equals the query', () => {
    expect(checkNarrowQuery(GOOD, '(max-width: 760px)')).toEqual([]);
  });

  it('reports a different width, a second breakpoint and an unusable query', () => {
    const msgs = (css: string, q: string): string => checkNarrowQuery(css, q).map((p) => p.message).join('\n');
    expect(msgs(GOOD, '(max-width: 600px)')).toContain('no @media (max-width: 600px)');
    expect(msgs(GOOD + '@media (max-width: 480px) { a { color: red; } }', '(max-width: 760px)')).toContain('480px');
    expect(msgs(GOOD, '(min-width: 760px)')).toContain('no max-width');
  });
});
