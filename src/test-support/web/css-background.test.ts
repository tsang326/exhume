import { describe, expect, it } from 'vitest';
import { checkStrata } from './css-scan';

const GOOD_CSS = `
:root { --pair-body-bg: #0b0f10; --soil1: #12110e; --grain-opacity: 0.16; }
html { background: var(--pair-body-bg); }
body { position: relative; }
body::after {
  content: ''; position: fixed; inset: 0; pointer-events: none; z-index: 60;
  background: url('./assets/img/grain.png'); opacity: var(--grain-opacity);
}
.yard { background: #12110e; }
.deep { background-color: #0e0c0a; }
#formats { background: #16130f; }
footer { background: var(--soil1); }
.edge, .soil, .sprite, .buried, .clauses, .rise-ghost { pointer-events: none; }
`;

const GOOD_HTML = `<body>
<svg class="sprite" aria-hidden="true" focusable="false"></svg>
<section class="yard"><svg class="edge" aria-hidden="true"><ellipse fill="#12110e"/></svg></section>
<footer><p class="buried" aria-hidden="true">x</p><svg class="soil" aria-hidden="true"></svg></footer>
</body>`;

const messages = (css: string, html = GOOD_HTML): string =>
  checkStrata(css, html).map((p) => p.message).join('\n');

describe('checkStrata', () => {
  it('accepts well-formed strata', () => {
    expect(checkStrata(GOOD_CSS, GOOD_HTML)).toEqual([]);
  });

  it('accepts the section-background grain fallback', () => {
    const css = GOOD_CSS.replace(/body::after \{[^}]*\}/, '')
      .replace('--grain-opacity: 0.16;', '')
      .replace('.yard { background: #12110e; }', ".yard { background: #12110e url('./g.png'); }");
    expect(checkStrata(css, GOOD_HTML)).toEqual([]);
    expect(messages(css.replace("url('./g.png')", ''))).toContain('no grain');
  });

  it('flags gradients, shadows, filters and blur', () => {
    const bad = GOOD_CSS.replace('.yard { background: #12110e; }', '.yard { background: linear-gradient(red, blue); }') +
      '.deep { box-shadow: 0 0 4px red; filter: blur(2px); }';
    const msgs = messages(bad);
    expect(msgs).toContain('linear-gradient');
    expect(msgs).toContain('box-shadow');
    expect(msgs).toContain('filter');
  });

  it('flags a missing ground, a transparent stratum and a fixed body height', () => {
    expect(messages(GOOD_CSS.replace('html { background: var(--pair-body-bg); }', ''))).toContain('html needs a solid ground');
    expect(messages(GOOD_CSS.replace('.deep { background-color: #0e0c0a; }', '.deep { background: transparent; }'))).toContain(
      '.deep background is not opaque',
    );
    expect(messages(GOOD_CSS.replace('footer {', 'footer { }\nbody { height: 100vh; }\nx {'))).toContain('body must not have a fixed height');
  });

  it('flags decorative layers that take clicks or lack aria-hidden', () => {
    expect(messages(GOOD_CSS.replace('.edge, ', ''))).toContain('.edge needs pointer-events: none');
    expect(messages(GOOD_CSS.replace('.buried, ', '.buried { pointer-events: auto; }\n.x, '))).toContain('.buried needs pointer-events');
    expect(messages(GOOD_CSS, GOOD_HTML.replace('class="edge" aria-hidden="true"', 'class="edge"'))).toContain('class="edge"');
    expect(messages(GOOD_CSS, GOOD_HTML.replace('<svg class="edge" aria-hidden="true">', '<svg>'))).toContain('no .edge element');
  });

  it('flags gradient or filter elements in the markup', () => {
    expect(messages(GOOD_CSS, GOOD_HTML.replace('<ellipse', '<radialGradient></radialGradient><ellipse'))).toContain('radialgradient');
    expect(messages(GOOD_CSS, GOOD_HTML.replace('<ellipse', '<ellipse filter="url(#f)"'))).toContain('filter attribute');
  });

  it('flags a grain overlay with the wrong shape or opacity out of range', () => {
    expect(messages(GOOD_CSS.replace('position: fixed', 'position: absolute'))).toContain('body::after needs position: fixed');
    expect(messages(GOOD_CSS.replace('--grain-opacity: 0.16', '--grain-opacity: 0.3'))).toContain('outside');
    expect(messages(GOOD_CSS.replace('--grain-opacity: 0.16', '--grain-opacity: 0.05'))).toContain('outside');
    expect(messages(GOOD_CSS.replace('opacity: var(--grain-opacity)', 'opacity: 0.2'))).toContain('var(--grain-opacity)');
  });
});
