// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { numRuns } from '../../test-support/runs';
import { parseMarkdown, plainText } from '../logic/markdown';
import { buildCsvTable, buildHexView, buildMarkdown } from './preview-content';

const MD_TAGS = new Set(['P', 'BR', 'STRONG', 'EM', 'HR']);

function build(text: string): HTMLElement {
  const host = document.createElement('div');
  host.appendChild(buildMarkdown(parseMarkdown(text)));
  return host;
}

function tagNames(root: Element): string[] {
  return Array.from(root.querySelectorAll('*')).map((e) => e.tagName);
}

function attributeCount(root: Element): number {
  let n = 0;
  for (const e of Array.from(root.querySelectorAll('*'))) n += e.attributes.length;
  return n;
}

describe('buildMarkdown hostile input', () => {
  it('shows <img onerror> as text with no img and no onerror attribute', () => {
    const text = '<img src=x onerror=alert(1)>';
    const host = build(text);
    expect(host.querySelector('img')).toBeNull();
    expect(host.querySelector('[onerror]')).toBeNull();
    expect(attributeCount(host)).toBe(0);
    expect(host.textContent).toBe(text);
  });

  const fixtures = [
    '[x](http://a)',
    '![x](http://a/b.png)',
    '<a href="http://a">x</a>',
    '<script>alert(1)</script>',
    '<iframe src="http://a"></iframe>',
    '<object data=x></object><embed src=x><form action=x></form><link rel=stylesheet href=x>',
    '[click](javascript:alert(1))',
    'javascript:alert(1)',
    '<a href="javascript:alert(1)" onclick="x()">y</a>',
  ];

  it.each(fixtures)('produces only safe elements and no attributes for %s', (text) => {
    const host = build(text);
    for (const sel of ['a', 'img', 'iframe', 'object', 'embed', 'form', 'script', 'link']) {
      expect(host.querySelector(sel)).toBeNull();
    }
    expect(tagNames(host).every((t) => MD_TAGS.has(t))).toBe(true);
    expect(attributeCount(host)).toBe(0);
    expect(host.textContent).toBe(text);
  });

  it('nests strong inside emphasis for ***x***', () => {
    const host = build('***x***');
    const p = host.firstElementChild as Element;
    expect(p.tagName).toBe('P');
    expect(host.children.length).toBe(1);
    expect(p.children.length).toBe(1);
    const outer = p.firstElementChild as Element;
    expect(['STRONG', 'EM']).toContain(outer.tagName);
    expect(outer.children.length).toBe(1);
    const inner = outer.firstElementChild as Element;
    expect(['STRONG', 'EM']).toContain(inner.tagName);
    expect(inner.tagName).not.toBe(outer.tagName);
    expect(inner.children.length).toBe(0);
    expect(inner.textContent).toBe('x');
    expect(host.textContent).toBe('x');
  });

  it('renders strong, emphasis, br and hr structure', () => {
    const host = build('a **b** *c*\nd\n\n---\n\ne');
    expect(host.querySelectorAll('p').length).toBe(2);
    expect(host.querySelectorAll('strong').length).toBe(1);
    expect(host.querySelectorAll('em').length).toBe(1);
    expect(host.querySelectorAll('br').length).toBe(1);
    expect(host.querySelectorAll('hr').length).toBe(1);
  });

  it('turns escapes into literal text', () => {
    const host = build('\\*not em\\* \\<b\\> \\[x\\]');
    expect(host.querySelector('em')).toBeNull();
    expect(host.querySelector('b')).toBeNull();
    expect(host.textContent).toBe('*not em* <b> [x]');
  });

  it('handles very long text without extra structure', () => {
    const text = 'word '.repeat(40000);
    const host = build(text);
    expect(host.children.length).toBe(1);
    expect(host.textContent).toBe(text);
  });

  it('keeps all text for arbitrary strings (property)', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 300 }), (s) => {
        const model = parseMarkdown(s);
        const host = document.createElement('div');
        host.appendChild(buildMarkdown(model));
        const tagsOk = tagNames(host).every((t) => MD_TAGS.has(t));
        // Line breaks are <br> elements and carry no text, so textContent is plainText exactly.
        const textOk = host.textContent === plainText(model);
        return tagsOk && textOk && attributeCount(host) === 0;
      }),
      { numRuns: numRuns(100) },
    );
  });
});

describe('buildCsvTable hostile cells', () => {
  const hostile = '<img src=x onerror=alert(1)>';
  const table = {
    rows: [
      [hostile, '<script>x</script>'],
      ['<b>bold</b>', '[x](javascript:alert(1))'],
    ],
    totalRows: 50,
    totalCols: 9,
    truncated: true,
  };

  it('creates th/td cells holding text only', () => {
    const el = buildCsvTable(table);
    const ths = Array.from(el.querySelectorAll('th'));
    const tds = Array.from(el.querySelectorAll('td'));
    expect(ths.map((c) => c.textContent)).toEqual([hostile, '<script>x</script>']);
    expect(tds.map((c) => c.textContent)).toEqual(['<b>bold</b>', '[x](javascript:alert(1))']);
    for (const c of [...ths, ...tds]) expect(c.children.length).toBe(0);
    expect(el.querySelectorAll('thead tr').length).toBe(1);
    expect(el.querySelectorAll('tbody tr').length).toBe(1);
    for (const sel of ['img', 'script', 'a', 'b', 'iframe', 'form']) {
      expect(el.querySelector(sel)).toBeNull();
    }
    expect(el.querySelector('[onerror]')).toBeNull();
  });

  it('adds the truncated note only when truncated', () => {
    const el = buildCsvTable(table);
    const note = el.querySelector('.csv-note');
    expect(note).not.toBeNull();
    expect(note?.textContent).toBe('Preview truncated: showing 2 of 50 rows and 2 of 9 columns.');
    const plain = buildCsvTable({ ...table, truncated: false });
    expect(plain.querySelector('.csv-note')).toBeNull();
  });
});

describe('buildHexView hostile text', () => {
  it('puts hostile row text in spans as text only', () => {
    const hostile = '<img src=x onerror=1>';
    const el = buildHexView([{ offset: '00000000', hex: '3c 69 6d 67', text: hostile }]);
    const rows = el.querySelectorAll('.hex-row');
    expect(rows.length).toBe(1);
    const spans = Array.from(rows[0]!.children);
    expect(spans.map((s) => s.tagName)).toEqual(['SPAN', 'SPAN', 'SPAN']);
    for (const s of spans) expect(s.children.length).toBe(0);
    expect(spans[2]!.textContent).toBe(hostile);
    expect(el.querySelector('img')).toBeNull();
    expect(el.querySelector('[onerror]')).toBeNull();
  });
});
