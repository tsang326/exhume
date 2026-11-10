// @vitest-environment happy-dom
// End-to-end test of startApp() in happy-dom. The Worker is replaced by an in-process fake that
// answers with the real handleRequest, so drop -> graveyard -> preview -> download -> close runs
// through the real modules. The page elements are built with createElement from the 15.1 element
// contract, and the contract is checked against index.html so the two cannot drift.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeFat12Image } from '../test-support/fat12/index';
import type { FileTree } from '../test-support/fat12/index';
import { encodePcx, writeDbf, writeWordStar } from '../test-support/formats/index';
import { parseHtml } from '../test-support/web/html-scan';
import type { HtmlElement } from '../test-support/web/html-scan';
import { startApp } from './app';
import { GLOBAL_ERROR_MESSAGE } from './dom/errors';
import { DROP_REJECT_MESSAGE } from './logic/drop';
import { MAX_IMAGE_BYTES } from './logic/limits';
import { CANCELLED_MESSAGE } from './logic/session';
import { checkImageSize } from './logic/size';
import { handleRequest, createSession as createWorkerSession } from './worker/disk-handler';
import type { WorkerSession } from './worker/disk-handler';

// ---------------------------------------------------------------------------------------------
// The element contract (15.1) and the page it builds
// ---------------------------------------------------------------------------------------------

interface ContractEntry {
  key: string;
  tag: string;
  attrs: Record<string, string>;
  /** Key of the nearest keyed ancestor, or null for a child of body. */
  parent: string | null;
}

const CONTRACT: ContractEntry[] = [
  { key: 'fx-host', tag: 'div', attrs: { id: 'fx-host', 'aria-hidden': 'true' }, parent: null },
  { key: 'app', tag: 'div', attrs: { id: 'app' }, parent: null },
  { key: '.content', tag: 'div', attrs: { class: 'content' }, parent: 'app' },
  { key: 'drop-zone', tag: 'section', attrs: { id: 'drop-zone' }, parent: '.content' },
  { key: 'pick-button', tag: 'button', attrs: { id: 'pick-button', type: 'button' }, parent: 'drop-zone' },
  { key: 'file-input', tag: 'input', attrs: { id: 'file-input', type: 'file', hidden: '' }, parent: 'drop-zone' },
  { key: 'status', tag: 'p', attrs: { id: 'status', role: 'status', 'aria-live': 'polite' }, parent: '.content' },
  { key: 'cancel-button', tag: 'button', attrs: { id: 'cancel-button', type: 'button', hidden: '' }, parent: '.content' },
  { key: 'reopen-button', tag: 'button', attrs: { id: 'reopen-button', type: 'button', hidden: '' }, parent: '.content' },
  { key: 'demo-slot', tag: 'div', attrs: { id: 'demo-slot' }, parent: '.content' },
  { key: 'graveyard', tag: 'section', attrs: { id: 'graveyard' }, parent: '.content' },
  { key: 'preview-root', tag: 'div', attrs: { id: 'preview-root' }, parent: null },
];

function keyOf(el: HtmlElement): string | undefined {
  const id = el.attrs['id'];
  if (id !== undefined) return id;
  return el.attrs['class'] === 'content' ? '.content' : undefined;
}

function buildPage(): void {
  document.body.textContent = '';
  const made = new Map<string, HTMLElement>();
  for (const entry of CONTRACT) {
    const el = document.createElement(entry.tag);
    for (const [name, value] of Object.entries(entry.attrs)) el.setAttribute(name, value);
    const parent = entry.parent === null ? document.body : made.get(entry.parent);
    if (parent === undefined) throw new Error('contract order');
    parent.appendChild(el);
    made.set(entry.key, el);
  }
}

// ---------------------------------------------------------------------------------------------
// Fake Worker: runs the real handleRequest in process
// ---------------------------------------------------------------------------------------------

class FakeWorker {
  static instances: FakeWorker[] = [];
  static auto = true;
  /** When true, answers every open request with a failed response. */
  static failOpen = false;
  static last(): FakeWorker {
    const w = FakeWorker.instances[FakeWorker.instances.length - 1];
    if (w === undefined) throw new Error('no worker was created');
    return w;
  }

  readonly sent: unknown[] = [];
  terminated = false;
  private readonly queue: unknown[] = [];
  private readonly listeners = new Map<string, Array<(event: unknown) => void>>();
  private readonly session: WorkerSession = createWorkerSession();

  constructor(_url?: unknown, _options?: unknown) {
    FakeWorker.instances.push(this);
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  removeEventListener(): void {}

  postMessage(message: unknown): void {
    this.sent.push(message);
    this.queue.push(message);
    if (FakeWorker.auto) queueMicrotask(() => this.flush());
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Answers every queued request in order, using the real handler. */
  flush(): void {
    while (this.queue.length > 0) {
      const message = this.queue.shift();
      if (this.terminated) continue;
      const req = message as { type?: string; id?: number };
      if (FakeWorker.failOpen && req.type === 'open') {
        this.emit('message', {
          data: { type: 'failed', id: req.id, request: 'open', cause: 'internal', error: 'boom' },
        });
        continue;
      }
      const data = handleRequest(this.session, message);
      this.emit('message', { data });
    }
  }

  fail(): void {
    this.emit('error', {});
  }

  private emit(type: string, event: unknown): void {
    for (const l of this.listeners.get(type) ?? []) l(event);
  }
}

// ---------------------------------------------------------------------------------------------
// Fixture disk
// ---------------------------------------------------------------------------------------------

const ascii = (s: string): Uint8Array => new TextEncoder().encode(s);
const HOSTILE_NAME = '<img src=x onerror=alert(1)>.TXT';

function makeDisk(extra: FileTree['children'] = []): Uint8Array {
  const tree: FileTree = {
    volumeLabel: 'GRAVE',
    children: [
      { kind: 'file', name: 'LETTER.WS', content: writeWordStar([{ spans: [{ text: 'Hello ', styles: ['bold'] }, { text: 'world' }] }]) },
      {
        kind: 'file',
        name: 'DATA.DBF',
        content: writeDbf({
          fields: [{ name: 'NAME', type: 'C', length: 4, decimals: 0 }],
          records: [
            { deleted: false, values: [ascii('ABCD')] },
            { deleted: false, values: [ascii('WXYZ')] },
          ],
        }),
      },
      {
        kind: 'file',
        name: 'PIC.PCX',
        content: encodePcx({ mode: 'mono', width: 8, height: 2, indices: new Uint8Array(16).map((_, i) => i % 2) }),
      },
      { kind: 'file', name: 'NOTES.BIN', content: Uint8Array.from([0x01, 0xfe, ...ascii('JUNKDATA'.repeat(8))]) },
      { kind: 'file', name: 'HOSTILE.TXT', longName: HOSTILE_NAME, content: ascii('plain text') },
      { kind: 'file', name: 'GONE.WS', deleted: true, content: writeWordStar([{ spans: [{ text: 'old news' }] }]) },
      ...extra,
    ],
  };
  return writeFat12Image(tree, '1440K');
}

function smallDisk(): Uint8Array {
  return writeFat12Image(
    { volumeLabel: 'SECOND', children: [{ kind: 'file', name: 'ONLY.BIN', content: ascii('JUNKJUNK') }] },
    '360K',
  );
}

function randomBytes(n: number): Uint8Array {
  let x = 12345;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    x = (Math.imul(x, 1103515245) + 12345) >>> 0;
    out[i] = (x >>> 16) & 0xff;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Test environment
// ---------------------------------------------------------------------------------------------

interface FileLike {
  name: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

const fileOf = (bytes: Uint8Array, name = 'disk.img'): FileLike => ({
  name,
  size: bytes.length,
  arrayBuffer: () => Promise.resolve(bytes.slice().buffer),
});

function dropFiles(files: FileLike[]): void {
  const ev = new Event('drop', { cancelable: true, bubbles: true });
  Object.defineProperty(ev, 'dataTransfer', {
    value: { files, items: files.map(() => ({ kind: 'file' })) },
  });
  document.dispatchEvent(ev);
}

async function settle(ms = 1000): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms);
  await vi.advanceTimersByTimeAsync(0);
}

async function drop(bytes: Uint8Array): Promise<void> {
  dropFiles([fileOf(bytes)]);
  await settle();
}

const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => {
  const el = document.querySelector<T>(sel);
  if (el === null) throw new Error(`missing ${sel}`);
  return el;
};
const statusText = (): string => $('#status').textContent ?? '';
const graves = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('#graveyard li.grave'));
const graveByName = (name: string): HTMLElement => {
  const li = graves().find((g) => g.querySelector('.grave-name')?.textContent === name);
  if (li === undefined) throw new Error(`no grave named ${name}`);
  return li;
};
const graveButton = (name: string): HTMLButtonElement => {
  const b = graveByName(name).querySelector('button');
  if (b === null) throw new Error(`no button for ${name}`);
  return b;
};
const dialog = (): HTMLElement | null => document.querySelector<HTMLElement>('.preview');
const hidden = (id: string): boolean => $(`#${id}`).hasAttribute('hidden');

async function exhume(name: string): Promise<void> {
  graveButton(name).click();
  await settle();
}

function pressEscape(): void {
  const target = document.activeElement ?? document.body;
  target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
}

let reducedMotion = false;
let revoked: string[] = [];
let downloads: Array<{ href: string; download: string }> = [];
const recorded: Array<{ target: EventTarget; type: string; listener: EventListenerOrEventListenerObject }> = [];
const saved: Record<string, unknown> = {};
let scrollSpy = vi.fn();

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  FakeWorker.instances = [];
  FakeWorker.auto = true;
  FakeWorker.failOpen = false;
  scrollSpy = vi.fn();
  saved['scrollIntoView'] = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = scrollSpy as unknown as typeof HTMLElement.prototype.scrollIntoView;
  vi.stubGlobal('Worker', FakeWorker);
  reducedMotion = false;
  revoked = [];
  downloads = [];

  // Record listeners that startApp adds to document/window so each test removes them.
  for (const target of [document, window] as EventTarget[]) {
    const original = target.addEventListener.bind(target);
    vi.spyOn(target, 'addEventListener').mockImplementation((type: string, listener: EventListenerOrEventListenerObject | null, opts?: unknown) => {
      if (listener !== null) recorded.push({ target, type, listener });
      original(type, listener, opts as AddEventListenerOptions);
    });
  }

  const w = window as unknown as Record<string, unknown>;
  saved['matchMedia'] = w['matchMedia'];
  w['matchMedia'] = () => ({ matches: reducedMotion, addEventListener() {}, removeEventListener() {} });
  saved['getContext'] = HTMLCanvasElement.prototype.getContext;
  (HTMLCanvasElement.prototype as unknown as { getContext: () => null }).getContext = () => null;
  saved['click'] = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function (this: HTMLAnchorElement): void {
    downloads.push({ href: this.getAttribute('href') ?? '', download: this.getAttribute('download') ?? '' });
  };
  let n = 0;
  saved['create'] = URL.createObjectURL;
  saved['revoke'] = URL.revokeObjectURL;
  URL.createObjectURL = () => `blob:test/${++n}`;
  URL.revokeObjectURL = (u: string) => {
    revoked.push(u);
  };

  buildPage();
  startApp();
});

afterEach(() => {
  for (const r of recorded.splice(0)) r.target.removeEventListener(r.type, r.listener);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  const w = window as unknown as Record<string, unknown>;
  w['matchMedia'] = saved['matchMedia'];
  HTMLElement.prototype.scrollIntoView = saved['scrollIntoView'] as typeof HTMLElement.prototype.scrollIntoView;
  (HTMLCanvasElement.prototype as unknown as Record<string, unknown>)['getContext'] = saved['getContext'];
  (HTMLAnchorElement.prototype as unknown as Record<string, unknown>)['click'] = saved['click'];
  URL.createObjectURL = saved['create'] as typeof URL.createObjectURL;
  URL.revokeObjectURL = saved['revoke'] as typeof URL.revokeObjectURL;
  document.body.textContent = '';
});

// ---------------------------------------------------------------------------------------------

describe('page contract', () => {
  it('matches the ids, tags, attributes and nesting in index.html', () => {
    const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
    const doc = parseHtml(html);
    const parents = new Map<HtmlElement, string | null>();
    const walk = (el: HtmlElement, nearest: string | null): void => {
      parents.set(el, nearest);
      const key = keyOf(el);
      for (const c of el.children) if (c.kind === 'element') walk(c, key ?? nearest);
    };
    walk(doc.root, null);
    for (const entry of CONTRACT) {
      const el = doc.elements.find((e) => keyOf(e) === entry.key);
      expect(el, entry.key).toBeDefined();
      expect(el?.tag, entry.key).toBe(entry.tag);
      for (const [name, value] of Object.entries(entry.attrs)) {
        expect(el?.attrs[name], `${entry.key}[${name}]`).toBe(value);
      }
      expect(parents.get(el as HtmlElement), `${entry.key} parent`).toBe(entry.parent);
    }
  });
});

describe('opening a disk', () => {
  it('renders tombstones and open graves for a valid disk', async () => {
    expect(hidden('cancel-button')).toBe(true);
    expect(hidden('reopen-button')).toBe(true);
    await drop(makeDisk());
    const all = graves();
    expect(all.length).toBeGreaterThanOrEqual(6);
    expect(statusText()).toBe(`Opened a disk with ${all.length} entries.`);
    expect(document.querySelectorAll('#graveyard li.grave--tombstone').length).toBeGreaterThanOrEqual(5);
    expect(document.querySelectorAll('#graveyard li.grave--open-grave').length).toBeGreaterThanOrEqual(1);
    // a deleted entry loses its first name character on disk, so it comes back as _ONE.WS
    expect(graveByName('_ONE.WS').classList.contains('grave--open-grave')).toBe(true);
    expect(graveByName('_ONE.WS').classList.contains('grave--recovered')).toBe(true);
    expect(graveButton('LETTER.WS').disabled).toBe(false);
    expect(hidden('cancel-button')).toBe(true);
    expect(hidden('reopen-button')).toBe(true);
  });

  it('shows hostile names as text only', async () => {
    await drop(makeDisk());
    const root = $('#graveyard');
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('[onerror]')).toBeNull();
    expect(graveByName(HOSTILE_NAME).querySelector('.grave-name')?.textContent).toBe(HOSTILE_NAME);
  });

  it('keeps the old graveyard after an oversize or an empty drop', async () => {
    await drop(makeDisk());
    const before = $('#graveyard').textContent;
    const requests = FakeWorker.last().sent.length;

    dropFiles([{ name: 'big.img', size: MAX_IMAGE_BYTES + 1, arrayBuffer: () => Promise.reject(new Error('must not be read')) }]);
    await settle();
    const tooLarge = checkImageSize(MAX_IMAGE_BYTES + 1);
    expect(tooLarge.ok).toBe(false);
    expect(statusText()).toBe(tooLarge.ok ? '' : tooLarge.message);
    expect($('#graveyard').textContent).toBe(before);

    dropFiles([fileOf(new Uint8Array(0), 'empty.img')]);
    await settle();
    expect(statusText()).toBe('This file is empty.');
    expect($('#graveyard').textContent).toBe(before);
    expect(FakeWorker.last().sent.length).toBe(requests);
    expect(graveButton('LETTER.WS').disabled).toBe(false);
  });

  it('rejects a drop with no files', async () => {
    dropFiles([]);
    await settle();
    expect(statusText()).toBe(DROP_REJECT_MESSAGE);
    expect(FakeWorker.instances.length).toBe(0);
  });

  it('shows the unreadable message for random bytes', async () => {
    await drop(randomBytes(4096));
    expect(graves().length).toBe(0);
    const message = $('#graveyard .graveyard-message');
    expect(message.hasAttribute('hidden')).toBe(false);
    expect(message.textContent).toBe('This image could not be read as a FAT12 floppy disk.');
  });

  it('replaces the graveyard and closes the preview on a successful second open', async () => {
    await drop(makeDisk());
    await exhume('NOTES.BIN');
    expect(dialog()).not.toBeNull();
    await drop(smallDisk());
    expect(dialog()).toBeNull();
    expect(graves().map((g) => g.querySelector('.grave-name')?.textContent)).toEqual(['ONLY.BIN']);
    expect($('#app').hasAttribute('inert')).toBe(false);
  });

  it('keeps the preview open when a later open is rejected', async () => {
    await drop(makeDisk());
    await exhume('NOTES.BIN');
    dropFiles([fileOf(new Uint8Array(0))]);
    await settle();
    expect(dialog()).not.toBeNull();
    expect(statusText()).toBe('This file is empty.');
  });
});

describe('open flow: focus, reveal and guidance (4.3, 4.4, 5.1-5.6)', () => {
  const heading = (): HTMLElement => $('#graveyard-heading');
  const guidanceHidden = (): boolean => $('#graveyard .graveyard-guidance').hasAttribute('hidden');

  it('focuses the heading and scrolls smoothly after a good open', async () => {
    expect(guidanceHidden()).toBe(false);
    await drop(makeDisk());
    expect(document.activeElement).toBe(heading());
    expect(guidanceHidden()).toBe(true);
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
  });

  it('reveals only after the Cancel button is hidden', async () => {
    const cancelHiddenAtScroll: boolean[] = [];
    scrollSpy.mockImplementation(() => {
      cancelHiddenAtScroll.push(hidden('cancel-button'));
    });
    await drop(makeDisk());
    expect(cancelHiddenAtScroll).toEqual([true]);
  });

  it('scrolls instantly when reduced motion is on', async () => {
    reducedMotion = true;
    await drop(makeDisk());
    expect(document.activeElement).toBe(heading());
    expect(scrollSpy).toHaveBeenCalledTimes(1);
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'instant', block: 'start' });
  });

  it('a failed first open keeps the guidance and leaves focus and scroll alone', async () => {
    const pick = $('#pick-button');
    pick.focus();
    FakeWorker.failOpen = true;
    await drop(makeDisk());
    expect(statusText()).toBe('The disk could not be opened because the reader reported an error.');
    expect(guidanceHidden()).toBe(false);
    expect(heading().hasAttribute('hidden')).toBe(true);
    expect(document.activeElement).toBe(pick);
    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it('a failed open after a good one keeps the earlier disk and hides the guidance', async () => {
    await drop(makeDisk());
    const names = graves().map((g) => g.querySelector('.grave-name')?.textContent);
    scrollSpy.mockClear();
    const pick = $('#pick-button');
    pick.focus();
    FakeWorker.failOpen = true;
    await drop(smallDisk());
    expect(graves().map((g) => g.querySelector('.grave-name')?.textContent)).toEqual(names);
    expect(guidanceHidden()).toBe(true);
    expect(document.activeElement).toBe(pick);
    expect(scrollSpy).not.toHaveBeenCalled();
  });

  it('does not reveal or take focus when a preview was open during the open', async () => {
    await drop(makeDisk());
    await exhume('NOTES.BIN');
    expect(dialog()).not.toBeNull();
    scrollSpy.mockClear();
    await drop(smallDisk());
    expect(dialog()).toBeNull();
    expect(graves().map((g) => g.querySelector('.grave-name')?.textContent)).toEqual(['ONLY.BIN']);
    expect(scrollSpy).not.toHaveBeenCalled();
    expect(document.activeElement).not.toBe(heading());
  });
});

describe('pressed demo card (8.5, 8.6, 8.8)', () => {
  interface FakeResponse {
    status: number;
    headers: { get(name: string): string | null };
    body: null;
    arrayBuffer(): Promise<ArrayBuffer>;
  }
  const respond = (bytes: Uint8Array, status = 200, headers: Record<string, string> = {}): FakeResponse => ({
    status,
    headers: { get: (name) => headers[name.toLowerCase()] ?? null },
    body: null,
    arrayBuffer: () => Promise.resolve(bytes.slice().buffer),
  });
  /** Stubs the global fetch that demos.ts uses; the registry and loader stay real. */
  const stubFetch = (make: () => FakeResponse): void => {
    vi.stubGlobal('fetch', () => Promise.resolve(make()));
  };
  const cards = (): HTMLButtonElement[] => Array.from(document.querySelectorAll<HTMLButtonElement>('#demo-slot .demo-slot-button'));
  const pressed = (): string[] => cards().map((c) => c.getAttribute('aria-pressed') ?? '');
  const demoStatus = (): string => $('#demo-slot .demo-slot-status').textContent ?? '';
  const clickCard = async (index: number): Promise<void> => {
    const card = cards()[index];
    if (card === undefined) throw new Error(`no demo card ${index}`);
    card.click();
    await settle();
  };

  it('has several unpressed cards at the start', () => {
    expect(cards().length).toBeGreaterThanOrEqual(2);
    expect(pressed().every((v) => v === 'false')).toBe(true);
  });

  it('presses only the clicked card after a good open', async () => {
    stubFetch(() => respond(makeDisk()));
    await clickCard(1);
    expect(statusText()).toMatch(/^Opened a disk with \d+ entries\.$/);
    expect(pressed()).toEqual(cards().map((_, i) => (i === 1 ? 'true' : 'false')));
  });

  it('moves the pressed state when another demo opens', async () => {
    stubFetch(() => respond(makeDisk()));
    await clickCard(0);
    await clickCard(2);
    expect(pressed()).toEqual(cards().map((_, i) => (i === 2 ? 'true' : 'false')));
  });

  it('clears every card when a dropped file opens after a demo', async () => {
    stubFetch(() => respond(makeDisk()));
    await clickCard(0);
    expect(pressed()).toContain('true');
    await drop(smallDisk());
    expect(graves().map((g) => g.querySelector('.grave-name')?.textContent)).toEqual(['ONLY.BIN']);
    expect(pressed().every((v) => v === 'false')).toBe(true);
  });

  it('leaves everything unchanged when a later demo fails to load', async () => {
    stubFetch(() => respond(makeDisk()));
    await clickCard(0);
    const before = pressed();
    const names = graves().map((g) => g.querySelector('.grave-name')?.textContent);
    stubFetch(() => respond(new Uint8Array(0), 404));
    await clickCard(1);
    expect(demoStatus()).toBe('The demo disk request failed (status 404).');
    expect(pressed()).toEqual(before);
    expect(graves().map((g) => g.querySelector('.grave-name')?.textContent)).toEqual(names);
  });

  it('does not leak a rejected demo id into a later open', async () => {
    stubFetch(() => respond(new Uint8Array(8), 200, { 'content-length': String(MAX_IMAGE_BYTES + 1) }));
    await clickCard(0);
    expect(demoStatus()).toContain('larger than');
    expect(FakeWorker.instances.length).toBe(0);
    expect(pressed().every((v) => v === 'false')).toBe(true);
    await drop(smallDisk());
    expect(graves().length).toBe(1);
    expect(pressed().every((v) => v === 'false')).toBe(true);
  });
});

describe('previews', () => {
  it('previews markdown, downloads it, and closes with Escape returning focus', async () => {
    await drop(makeDisk());
    const opener = graveButton('LETTER.WS');
    opener.focus();
    await exhume('LETTER.WS');

    const d = dialog();
    expect(d).not.toBeNull();
    expect(d?.querySelector('.preview-markdown')?.textContent).toContain('Hello');
    expect($('#app').hasAttribute('inert')).toBe(true);
    expect(document.activeElement?.id).toBe('preview-title');
    expect(statusText()).toBe('');

    const buttons = Array.from(d?.querySelectorAll<HTMLButtonElement>('.preview-download') ?? []);
    expect(buttons.map((b) => b.textContent)).toEqual(['Download .md', 'Download raw bytes']);
    buttons[0]?.click();
    buttons[1]?.click();
    expect(downloads.length).toBe(2);
    expect(downloads[0]?.download).toMatch(/\.md$/);
    expect(downloads[1]?.download).toMatch(/\.bin$/);
    expect(downloads.every((x) => x.href.startsWith('blob:'))).toBe(true);
    await settle(600);
    expect(revoked.length).toBe(2);

    pressEscape();
    expect(dialog()).toBeNull();
    expect($('#app').hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(opener);
  });

  it('previews csv as a table', async () => {
    await drop(makeDisk());
    await exhume('DATA.DBF');
    const table = dialog()?.querySelector('table.csv-table');
    expect(table?.textContent).toContain('ABCD');
    expect(table?.textContent).toContain('WXYZ');
    expect(dialog()?.querySelector('.preview-download')?.textContent).toBe('Download .csv');
  });

  it('previews png with an owned blob url and revokes it on close', async () => {
    await drop(makeDisk());
    await exhume('PIC.PCX');
    const img = dialog()?.querySelector<HTMLImageElement>('img.preview-png');
    const src = img?.getAttribute('src') ?? '';
    expect(src).toMatch(/^blob:test\//);
    expect(dialog()?.querySelector('.preview-download')?.textContent).toBe('Download .png');
    dialog()?.querySelector<HTMLButtonElement>('.preview-close')?.click();
    expect(dialog()).toBeNull();
    expect(revoked).toContain(src);
  });

  it('falls back to a hex view with an error for unknown bytes', async () => {
    await drop(makeDisk());
    await exhume('NOTES.BIN');
    const d = dialog();
    expect(d?.querySelector('.hex-view')).not.toBeNull();
    expect(d?.querySelector('.preview-error')?.textContent).not.toBe('');
    expect(d?.querySelector('.hex-text')?.textContent).toContain('JUNKDATA');
    expect(Array.from(d?.querySelectorAll('.preview-download') ?? []).map((b) => b.textContent)).toEqual(['Download raw bytes']);
  });

  it('waits for the rising animation before showing the preview, unless motion is reduced', async () => {
    await drop(makeDisk());
    graveButton('NOTES.BIN').click();
    await settle(0);
    expect(dialog()).toBeNull();
    expect(graveByName('NOTES.BIN').classList.contains('is-rising')).toBe(true);
    expect(statusText()).toBe('Rising: NOTES.BIN');
    await settle(1000);
    expect(dialog()).not.toBeNull();
    expect(graveByName('NOTES.BIN').classList.contains('is-rising')).toBe(false);
    pressEscape();

    reducedMotion = true;
    graveButton('NOTES.BIN').click();
    await settle(0);
    expect(dialog()).not.toBeNull();
  });
});

describe('lost reader and cancel', () => {
  it('marks the disk lost on a worker error and Reopen restores it', async () => {
    await drop(makeDisk());
    const count = graves().length;
    FakeWorker.last().fail();
    await settle(0);
    expect(statusText()).toBe('The disk reader stopped. Reopen the disk to continue.');
    expect(graves().length).toBe(count);
    expect(graveButton('LETTER.WS').disabled).toBe(true);
    expect(hidden('reopen-button')).toBe(false);
    expect(FakeWorker.last().terminated).toBe(true);

    $('#reopen-button').click();
    await settle();
    expect(FakeWorker.instances.length).toBe(2);
    expect(statusText()).toBe(`Opened a disk with ${count} entries.`);
    expect(graveButton('LETTER.WS').disabled).toBe(false);
    expect(hidden('reopen-button')).toBe(true);
    await exhume('NOTES.BIN');
    expect(dialog()).not.toBeNull();
  });

  it('shows Cancel only while a request is pending', async () => {
    FakeWorker.auto = false;
    expect(hidden('cancel-button')).toBe(true);
    dropFiles([fileOf(makeDisk())]);
    await settle();
    expect(statusText()).toBe('Opening the disk.');
    expect(hidden('cancel-button')).toBe(false);

    FakeWorker.last().flush();
    await settle(0);
    expect(hidden('cancel-button')).toBe(true);
    expect(graves().length).toBeGreaterThan(0);

    graveButton('NOTES.BIN').click();
    await settle(0);
    expect(hidden('cancel-button')).toBe(false);
    $('#cancel-button').click();
    await settle();
    expect(statusText()).toBe(CANCELLED_MESSAGE);
    expect(hidden('cancel-button')).toBe(true);
    expect(hidden('reopen-button')).toBe(false);
    expect(graveButton('LETTER.WS').disabled).toBe(true);
    expect(dialog()).toBeNull();
  });

  it('cancelling the very first open leaves nothing to reopen', async () => {
    FakeWorker.auto = false;
    dropFiles([fileOf(makeDisk())]);
    await settle();
    $('#cancel-button').click();
    await settle();
    expect(statusText()).toBe(CANCELLED_MESSAGE);
    expect(hidden('reopen-button')).toBe(true);
    expect(graves().length).toBe(0);
  });
});

describe('stale responses and errors', () => {
  it('ignores the answer to an open that a newer drop superseded', async () => {
    FakeWorker.auto = false;
    dropFiles([fileOf(makeDisk())]);
    await settle();
    dropFiles([fileOf(smallDisk())]);
    await settle();
    FakeWorker.last().flush();
    await settle();
    expect(graves().map((g) => g.querySelector('.grave-name')?.textContent)).toEqual(['ONLY.BIN']);
    expect(statusText()).toBe('Opened a disk with 1 entries.');
  });

  it('ignores an exhume answer that arrives after a new disk was dropped', async () => {
    await drop(makeDisk());
    FakeWorker.auto = false;
    graveButton('NOTES.BIN').click();
    await settle();
    dropFiles([fileOf(smallDisk())]);
    await settle();
    FakeWorker.last().flush();
    await settle();
    expect(dialog()).toBeNull();
    expect(graves().map((g) => g.querySelector('.grave-name')?.textContent)).toEqual(['ONLY.BIN']);
    expect(hidden('cancel-button')).toBe(true);
  });

  it('shows the fixed message for an unhandled error and an unhandled rejection', () => {
    window.dispatchEvent(new Event('error'));
    expect(statusText()).toBe(GLOBAL_ERROR_MESSAGE);
    $('#status').textContent = '';
    window.dispatchEvent(new Event('unhandledrejection'));
    expect(statusText()).toBe(GLOBAL_ERROR_MESSAGE);
  });
});
