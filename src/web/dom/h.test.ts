// DOM-free checks of the helper, using plain object stubs.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clear, h, setDownloadHref, setSrcBlob } from './h';

function fakeImg(): { src: string; alt: string } {
  return { src: '', alt: '' };
}

describe('setSrcBlob', () => {
  it('sets src and alt together for a safe name', () => {
    const img = fakeImg();
    setSrcBlob(img as unknown as HTMLImageElement, 'blob:abc', 'PIC-1_a.png');
    expect(img).toEqual({ src: 'blob:abc', alt: 'PIC-1_a.png' });
  });

  it.each(['', 'a b', 'a/b', '<x>', 'é', 'a'.repeat(65), 'a\n'])('throws for %j and leaves the img untouched', (name) => {
    const img = fakeImg();
    expect(() => setSrcBlob(img as unknown as HTMLImageElement, 'blob:abc', name)).toThrow();
    expect(img).toEqual({ src: '', alt: '' });
  });

  it('accepts a 64 character name', () => {
    const img = fakeImg();
    setSrcBlob(img as unknown as HTMLImageElement, 'blob:x', 'a'.repeat(64));
    expect(img.alt).toHaveLength(64);
  });
});

describe('setDownloadHref', () => {
  it('sets href and download attributes', () => {
    const attrs: Record<string, string> = {};
    const a = { setAttribute: (k: string, v: string) => void (attrs[k] = v) };
    setDownloadHref(a as unknown as HTMLAnchorElement, 'blob:u', 'f.bin');
    expect(attrs).toEqual({ href: 'blob:u', download: 'f.bin' });
  });
});

describe('blob URL checks', () => {
  const bad = ['http://x', 'data:text/plain,hi', 'javascript:void(0)', '', 'BLOB:abc'];

  it.each(bad)('setSrcBlob rejects %j and leaves the img untouched', (url) => {
    const img = fakeImg();
    expect(() => setSrcBlob(img as unknown as HTMLImageElement, url, 'a.png')).toThrow();
    expect(img).toEqual({ src: '', alt: '' });
  });

  it.each(bad)('setDownloadHref rejects %j and sets nothing', (url) => {
    const attrs: Record<string, string> = {};
    const a = { setAttribute: (k: string, v: string) => void (attrs[k] = v) };
    expect(() => setDownloadHref(a as unknown as HTMLAnchorElement, url, 'f.bin')).toThrow();
    expect(attrs).toEqual({});
  });

  it('rejects a URL the isOwned check refuses, accepts one it allows', () => {
    const img = fakeImg();
    const attrs: Record<string, string> = {};
    const a = { setAttribute: (k: string, v: string) => void (attrs[k] = v) };
    const no = (): boolean => false;
    expect(() => setSrcBlob(img as unknown as HTMLImageElement, 'blob:x', 'a.png', no)).toThrow();
    expect(() => setDownloadHref(a as unknown as HTMLAnchorElement, 'blob:x', 'f.bin', no)).toThrow();
    expect(img).toEqual({ src: '', alt: '' });
    expect(attrs).toEqual({});
    const yes = (u: string): boolean => u === 'blob:x';
    setSrcBlob(img as unknown as HTMLImageElement, 'blob:x', 'a.png', yes);
    setDownloadHref(a as unknown as HTMLAnchorElement, 'blob:x', 'f.bin', yes);
    expect(img).toEqual({ src: 'blob:x', alt: 'a.png' });
    expect(attrs).toEqual({ href: 'blob:x', download: 'f.bin' });
  });

  it('rejects an unsafe download name without mutating', () => {
    const attrs: Record<string, string> = {};
    const a = { setAttribute: (k: string, v: string) => void (attrs[k] = v) };
    expect(() => setDownloadHref(a as unknown as HTMLAnchorElement, 'blob:x', 'a/b')).toThrow();
    expect(attrs).toEqual({});
  });
});

describe('h attribute allow-list at runtime', () => {
  interface FakeEl {
    attrs: Record<string, string>;
    children: unknown[];
    setAttribute(k: string, v: string): void;
    appendChild(c: unknown): void;
  }
  let created = 0;
  const made: FakeEl[] = [];

  beforeEach(() => {
    created = 0;
    made.length = 0;
    vi.stubGlobal('document', {
      createElement: () => {
        created++;
        const el: FakeEl = {
          attrs: {},
          children: [],
          setAttribute: (k, v) => void (el.attrs[k] = v),
          appendChild: (c) => void el.children.push(c),
        };
        made.push(el);
        return el;
      },
      createTextNode: (t: string) => ({ text: t }),
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const forbidden = [
    'onclick',
    'ONCLICK',
    'style',
    'src',
    'href',
    'srcdoc',
    'alt',
    ' data-x',
    'data-x ',
    'data-X',
    'data-',
    'data-a_b',
    'inert',
    'aria-modal',
    'Class',
    'class ',
  ];

  it.each(forbidden)('throws for %j and creates nothing', (name) => {
    const attrs = { class: 'ok', [name]: 'v' } as unknown as Parameters<typeof h>[1];
    expect(() => h('div', attrs)).toThrow();
    expect(created).toBe(0);
    expect(made).toHaveLength(0);
  });

  it('accepts allow-listed names and data-foo-1', () => {
    h('div', { class: 'a', id: 'b', 'aria-label': 'c', 'data-foo-1': 'd', download: 'e' }, 'text');
    expect(made[0]?.attrs).toEqual({ class: 'a', id: 'b', 'aria-label': 'c', 'data-foo-1': 'd', download: 'e' });
    expect(made[0]?.children).toEqual([{ text: 'text' }]);
  });

  it('accepts aria-pressed and aria-current', () => {
    h('button', { 'aria-pressed': 'true', 'aria-current': 'true' });
    expect(made[0]?.attrs).toEqual({ 'aria-pressed': 'true', 'aria-current': 'true' });
  });
});

describe('clear', () => {
  it('removes all children', () => {
    const kids = [{}, {}, {}];
    const node = {
      get firstChild() {
        return kids[0] ?? null;
      },
      removeChild: (c: unknown) => {
        kids.splice(kids.indexOf(c as object), 1);
      },
    };
    clear(node as unknown as Node);
    expect(kids).toHaveLength(0);
  });
});
