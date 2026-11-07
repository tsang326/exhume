// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { clear, h, setDownloadHref, setSrcBlob } from './h';

describe('h()', () => {
  it('puts string children in Text nodes and keeps markup literal', () => {
    const hostile = '<img src=x onerror=alert(1)><b>hi</b>';
    const el = h('div', {}, hostile, 'plain');
    expect(el.childElementCount).toBe(0);
    expect(el.childNodes.length).toBe(2);
    expect(el.firstChild?.nodeType).toBe(Node.TEXT_NODE);
    expect(el.firstChild?.nodeValue).toBe(hostile);
    expect(el.textContent).toBe(hostile + 'plain');
  });

  it('appends Node children as-is', () => {
    const child = h('span', {}, 'x');
    const el = h('div', undefined, child);
    expect(el.firstElementChild).toBe(child);
  });

  it('sets allowed attributes and data-* attributes', () => {
    const el = h('div', { class: 'a', 'aria-label': '<b>x</b>', title: 't', 'data-row-1': '"q"' });
    expect(el.getAttribute('class')).toBe('a');
    expect(el.getAttribute('aria-label')).toBe('<b>x</b>');
    expect(el.getAttribute('data-row-1')).toBe('"q"');
    expect(el.childElementCount).toBe(0);
  });

  it('throws for forbidden attribute names and creates no element', () => {
    const before = document.body.querySelectorAll('*').length;
    for (const name of ['onclick', 'onerror', 'style', 'href', 'src', 'srcdoc', 'CLASS', 'data-', 'data-A', 'data-a b', 'x y']) {
      expect(() => h('div', { [name]: 'v' } as never)).toThrow('attribute not allowed');
    }
    expect(document.body.querySelectorAll('*').length).toBe(before);
  });

  it('rejects an over-long data-* name', () => {
    expect(() => h('div', { ['data-' + 'a'.repeat(100)]: '1' } as never)).toThrow();
    expect(() => h('div', { ['data-' + 'a'.repeat(95)]: '1' } as never)).not.toThrow();
  });

  it('never creates a script element', () => {
    const el = h('div', {}, '<script>1</script>', h('p', {}, '<script>2</script>'));
    expect(el.querySelectorAll('script').length).toBe(0);
    expect(document.querySelectorAll('script').length).toBe(0);
  });
});

describe('clear()', () => {
  it('removes all children', () => {
    const el = h('div', {}, 'a', h('span'), 'b');
    clear(el);
    expect(el.childNodes.length).toBe(0);
    clear(el);
    expect(el.firstChild).toBeNull();
  });
});

describe('setDownloadHref()', () => {
  const url = 'blob:http://localhost/abc';

  it('sets href and download for an owned blob URL', () => {
    const a = h('a') as HTMLAnchorElement;
    setDownloadHref(a, url, 'disk-1.img', (u) => u === url);
    expect(a.getAttribute('href')).toBe(url);
    expect(a.getAttribute('download')).toBe('disk-1.img');
  });

  it('works without an isOwned callback', () => {
    const a = h('a') as HTMLAnchorElement;
    setDownloadHref(a, url, 'a.txt');
    expect(a.getAttribute('href')).toBe(url);
  });

  it('rejects non-blob URLs, unowned URLs and unsafe names without mutating', () => {
    const a = h('a') as HTMLAnchorElement;
    expect(() => setDownloadHref(a, 'javascript:alert(1)', 'a.txt')).toThrow('not a blob URL');
    expect(() => setDownloadHref(a, 'https://x/y', 'a.txt')).toThrow();
    expect(() => setDownloadHref(a, url, 'a.txt', () => false)).toThrow('blob URL not owned');
    for (const bad of ['', 'a/b', '../x', 'a b', 'a'.repeat(65), 'é.txt']) {
      expect(() => setDownloadHref(a, url, bad)).toThrow('unsafe file name');
    }
    expect(a.hasAttribute('href')).toBe(false);
    expect(a.hasAttribute('download')).toBe(false);
  });
});

describe('setSrcBlob()', () => {
  const url = 'blob:http://localhost/img';

  it('sets src and alt together for a safe name', () => {
    const img = h('img') as HTMLImageElement;
    setSrcBlob(img, url, 'pic_1.png', (u) => u === url);
    expect(img.getAttribute('src')).toBe(url);
    expect(img.getAttribute('alt')).toBe('pic_1.png');
  });

  it('throws for unsafe names, non-blob URLs and unowned URLs, leaving img untouched', () => {
    const img = h('img') as HTMLImageElement;
    expect(() => setSrcBlob(img, url, 'a b')).toThrow('unsafe image name');
    expect(() => setSrcBlob(img, url, '<x>')).toThrow('unsafe image name');
    expect(() => setSrcBlob(img, 'data:image/png;base64,AA', 'a.png')).toThrow('not a blob URL');
    expect(() => setSrcBlob(img, url, 'a.png', () => false)).toThrow('blob URL not owned');
    expect(img.hasAttribute('src')).toBe(false);
    expect(img.hasAttribute('alt')).toBe(false);
  });
});
