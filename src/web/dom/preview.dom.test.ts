// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createBlobUrlManager } from './blob-urls';
import type { BlobUrlApi, BlobUrlManager } from './blob-urls';
import type { Downloader } from './download';
import { createPreviewPanel } from './preview';
import type { PreviewPanel } from './preview';
import type { DownloadSpec, PreviewModel } from '../logic/preview-model';

class FakeBlobApi implements BlobUrlApi {
  created: string[] = [];
  revoked: string[] = [];
  private n = 0;
  create(): string {
    const url = `blob:fake/${++this.n}`;
    this.created.push(url);
    return url;
  }
  revoke(url: string): void {
    this.revoked.push(url);
  }
}

const DL_MD: DownloadSpec = { label: 'Download .md', fileName: 'note.md', mime: 'text/markdown', data: '# hi' };
const DL_RAW: DownloadSpec = {
  label: 'Download raw bytes',
  fileName: 'note.bin',
  mime: 'application/octet-stream',
  data: new Uint8Array([1, 2, 3]),
};

function mdModel(over: Partial<PreviewModel> = {}): PreviewModel {
  return {
    title: 'Note',
    partialNote: null,
    error: null,
    warnings: [],
    body: { kind: 'markdown', text: 'Hello **world**', shortened: false },
    downloads: [DL_MD, DL_RAW],
    ...over,
  };
}

function pngModel(): PreviewModel {
  return {
    title: 'Picture',
    partialNote: null,
    error: null,
    warnings: [],
    body: { kind: 'png', png: new Uint8Array([137, 80, 78, 71]), alt: 'picture.png' },
    downloads: [],
  };
}

function key(target: Element, k: string, shiftKey = false): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
}

describe('createPreviewPanel (happy-dom)', () => {
  let api: FakeBlobApi;
  let blobs: BlobUrlManager;
  let started: DownloadSpec[];
  let downloader: Downloader;
  let background: HTMLElement;
  let fallback: HTMLElement;
  let opener: HTMLButtonElement;
  let panel: PreviewPanel;

  beforeEach(() => {
    document.body.replaceChildren();
    api = new FakeBlobApi();
    blobs = createBlobUrlManager(api);
    started = [];
    downloader = {
      start(spec) {
        started.push(spec);
        return { ok: true };
      },
    };
    background = document.createElement('main');
    fallback = document.createElement('h1');
    fallback.tabIndex = -1;
    opener = document.createElement('button');
    background.append(fallback, opener);
    document.body.appendChild(background);
    panel = createPreviewPanel({ blobs, downloader, fallbackFocus: () => fallback, background });
  });

  afterEach(() => {
    panel.close();
    document.body.replaceChildren();
  });

  const dialog = (): HTMLElement => document.querySelector('[role="dialog"]') as HTMLElement;

  it('is a modal dialog labelled by a non-empty heading', () => {
    panel.open(mdModel(), opener);
    const d = dialog();
    expect(d.getAttribute('aria-modal')).toBe('true');
    const heading = document.getElementById(d.getAttribute('aria-labelledby') as string);
    expect(heading).not.toBeNull();
    expect(heading?.textContent).toBe('Note');
    expect(panel.isOpen()).toBe(true);
  });

  it('moves focus to the heading, inerts the background, and restores both on close', () => {
    opener.focus();
    panel.open(mdModel(), opener);
    const heading = document.getElementById('preview-title');
    expect(document.activeElement).toBe(heading);
    expect(dialog().contains(document.activeElement)).toBe(true);
    expect(background.hasAttribute('inert')).toBe(true);
    panel.close();
    expect(background.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(opener);
    expect(dialog()).toBeNull();
    expect(panel.isOpen()).toBe(false);
  });

  it('leaves an already inert background inert after close', () => {
    background.setAttribute('inert', '');
    panel.open(mdModel(), opener);
    panel.close();
    expect(background.hasAttribute('inert')).toBe(true);
  });

  it('closes on Escape', () => {
    panel.open(mdModel(), opener);
    const e = key(document.activeElement as Element, 'Escape');
    expect(e.defaultPrevented).toBe(true);
    expect(panel.isOpen()).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it('closes with the Close button', () => {
    panel.open(mdModel(), opener);
    (dialog().querySelector('.preview-close') as HTMLElement).click();
    expect(panel.isOpen()).toBe(false);
  });

  it('wraps Tab from the last control to the first and Shift+Tab back', () => {
    panel.open(mdModel(), opener);
    const d = dialog();
    const buttons = Array.from(d.querySelectorAll<HTMLElement>('button'));
    const first = d.querySelector('.preview-close') as HTMLElement;
    const last = buttons[buttons.length - 1] as HTMLElement;
    expect(last.textContent).toBe('Download raw bytes');

    last.focus();
    const e1 = key(last, 'Tab');
    expect(e1.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);

    first.focus();
    key(first, 'Tab', true);
    expect(document.activeElement).toBe(last);
    expect(d.contains(document.activeElement)).toBe(true);
  });

  it('returns focus to the fallback when the opener was removed', () => {
    opener.focus();
    panel.open(mdModel(), opener);
    opener.remove();
    panel.close();
    expect(document.activeElement).toBe(fallback);
  });

  it('returns focus to the fallback when there is no opener', () => {
    panel.open(mdModel(), null);
    panel.close();
    expect(document.activeElement).toBe(fallback);
  });

  it('keeps the first opener and the page inert when a second preview replaces the first', () => {
    panel.open(mdModel(), opener);
    panel.open(mdModel({ title: 'Second' }), null);
    expect(document.querySelectorAll('[role="dialog"]').length).toBe(1);
    expect(document.getElementById('preview-title')?.textContent).toBe('Second');
    expect(background.hasAttribute('inert')).toBe(true);
    panel.close();
    expect(background.hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it('renders markdown as elements without leaking markup', () => {
    panel.open(mdModel(), opener);
    const region = dialog().querySelector('.preview-markdown') as HTMLElement;
    expect(region.querySelector('strong')?.textContent).toBe('world');
    expect(region.textContent).toContain('Hello');
  });

  it('shows the shortened note above-fold only when shortened', () => {
    panel.open(mdModel(), opener);
    expect(dialog().querySelector('.preview-shortened')).toBeNull();
    panel.open(mdModel({ body: { kind: 'markdown', text: 'x', shortened: true } }), opener);
    expect(dialog().querySelector('.preview-shortened')?.textContent).toContain('Only the start of the text');
  });

  it('renders a csv table with header cells and the truncated note', () => {
    panel.open(
      mdModel({
        body: {
          kind: 'csv',
          table: { rows: [['a', 'b'], ['1', '2']], totalRows: 50, totalCols: 9, truncated: true },
        },
      }),
      opener,
    );
    const d = dialog();
    expect(Array.from(d.querySelectorAll('th')).map((t) => t.textContent)).toEqual(['a', 'b']);
    expect(Array.from(d.querySelectorAll('td')).map((t) => t.textContent)).toEqual(['1', '2']);
    expect(d.querySelector('.csv-note')?.textContent).toBe(
      'Preview truncated: showing 2 of 50 rows and 2 of 9 columns.',
    );
  });

  it('renders a hex view and a byte-count note when shortened', () => {
    panel.open(
      mdModel({
        body: {
          kind: 'hex',
          rows: [{ offset: '00000000', hex: '41 42', text: 'AB' }],
          totalBytes: 100,
          shownBytes: 2,
        },
      }),
      opener,
    );
    const d = dialog();
    expect(d.querySelector('.hex-offset')?.textContent).toBe('00000000');
    expect(d.querySelector('.hex-text')?.textContent).toBe('AB');
    expect(d.querySelector('.preview-shortened')?.textContent).toBe('Showing 2 of 100 bytes.');
  });

  it('renders a png img with an owned blob URL and the safe name as alt', () => {
    panel.open(pngModel(), opener);
    const img = dialog().querySelector('img') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.getAttribute('src')).toMatch(/^blob:/);
    expect(blobs.isOwned(img.getAttribute('src') as string)).toBe(true);
    expect(img.getAttribute('alt')).toBe('picture.png');
    expect(blobs.liveCount()).toBe(1);
  });

  it('revokes Blob URLs on close', () => {
    panel.open(pngModel(), opener);
    panel.close();
    expect(api.revoked).toEqual(api.created);
    expect(blobs.liveCount()).toBe(0);
  });

  it('revokes the previous Blob URL when another preview opens', () => {
    panel.open(pngModel(), opener);
    const first = api.created[0] as string;
    panel.open(pngModel(), opener);
    expect(api.revoked).toEqual([first]);
    expect(blobs.liveCount()).toBe(1);
    expect(blobs.isOwned(first)).toBe(false);
  });

  it('shows the partial note above the content', () => {
    panel.open(mdModel({ partialNote: 'Only part of this file survived.' }), opener);
    const note = dialog().querySelector('.preview-partial') as HTMLElement;
    expect(note.textContent).toBe('Only part of this file survived.');
    const content = dialog().querySelector('.preview-markdown') as HTMLElement;
    expect(note.compareDocumentPosition(content) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows error text as an alert', () => {
    panel.open(mdModel({ error: 'This file could not be read.', body: { kind: 'none' } }), opener);
    const err = dialog().querySelector('.preview-error') as HTMLElement;
    expect(err.textContent).toBe('This file could not be read.');
    expect(err.getAttribute('role')).toBe('alert');
  });

  it('renders each warning as its own li', () => {
    panel.open(mdModel({ warnings: ['one', 'two', 'three'] }), opener);
    const items = Array.from(dialog().querySelectorAll('.preview-warnings > li'));
    expect(items.map((li) => li.textContent)).toEqual(['one', 'two', 'three']);
  });

  it('starts downloads through the Downloader with the exact spec', () => {
    panel.open(mdModel(), opener);
    const buttons = Array.from(dialog().querySelectorAll<HTMLButtonElement>('.preview-download'));
    expect(buttons.map((b) => b.textContent)).toEqual(['Download .md', 'Download raw bytes']);
    buttons[0]?.click();
    buttons[1]?.click();
    expect(started).toEqual([DL_MD, DL_RAW]);
    expect(started[0]).toBe(DL_MD);
  });

  it('shows the download failure message in the status line', () => {
    const failing: Downloader = { start: () => ({ ok: false, message: 'The download could not be started.' }) };
    const p = createPreviewPanel({ blobs, downloader: failing, fallbackFocus: () => fallback, background });
    p.open(mdModel(), opener);
    (dialog().querySelector('.preview-download') as HTMLElement).click();
    expect(dialog().querySelector('.preview-status')?.textContent).toBe('The download could not be started.');
    p.close();
  });

  it('keeps hostile title, warnings, note, and error as text', () => {
    const evil = '<img src=x onerror=alert(1)><script>boom()</script>';
    panel.open(
      mdModel({ title: evil, warnings: [evil], partialNote: evil, error: evil, body: { kind: 'none' } }),
      opener,
    );
    const d = dialog();
    expect(d.querySelector('img')).toBeNull();
    expect(d.querySelector('script')).toBeNull();
    expect(document.getElementById('preview-title')?.textContent).toBe(evil);
    expect(d.querySelector('.preview-warnings li')?.textContent).toBe(evil);
    expect(d.querySelector('.preview-partial')?.textContent).toBe(evil);
    expect(d.querySelector('.preview-error')?.textContent).toBe(evil);
  });
});
