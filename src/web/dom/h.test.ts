// DOM-free checks of the helper, using plain object stubs.
import { describe, expect, it } from 'vitest';
import { clear, setDownloadHref, setSrcBlob } from './h';

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
