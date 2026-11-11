// @vitest-environment happy-dom
// End-to-end test of startApp() in happy-dom. The page is the real body of index.html. The Worker is
// replaced by an in-process fake that answers with the real handleRequest, fetch serves the committed
// demo disks, and matchMedia is a double passed to startApp. Drop -> graveyard -> inline preview ->
// download runs through the real modules.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeFat12Image } from '../test-support/fat12/index';
import type { FileTree } from '../test-support/fat12/index';
import { encodePcx, writeDbf, writeWordStar } from '../test-support/formats/index';
import { startApp } from './app';
import { GLOBAL_ERROR_MESSAGE } from './dom/errors';
import { DROP_REJECT_MESSAGE } from './logic/drop';
import { NARROW_QUERY } from './logic/layout';
import { MAX_IMAGE_BYTES } from './logic/limits';
import { CANCELLED_MESSAGE } from './logic/session';
import { checkImageSize } from './logic/size';
import { handleRequest, createSession as createWorkerSession } from './worker/disk-handler';
import type { WorkerSession } from './worker/disk-handler';

// ---------------------------------------------------------------------------------------------
// The page: the real body of index.html
// ---------------------------------------------------------------------------------------------

const INDEX_HTML = readFileSync(join(process.cwd(), 'index.html'), 'utf8');

function buildPage(): void {
  const doc = new DOMParser().parseFromString(INDEX_HTML, 'text/html');
  for (const s of Array.from(doc.querySelectorAll('script'))) s.remove();
  document.body.textContent = '';
  for (const node of Array.from(doc.body.childNodes)) document.body.appendChild(document.importNode(node, true));
}

// ---------------------------------------------------------------------------------------------
// Fake Worker: runs the real handleRequest in process
// ---------------------------------------------------------------------------------------------

class FakeWorker {
  static instances: FakeWorker[] = [];
  static auto = true;
  /** When true, answers every open request with a failed response. */
  static failOpen = false;
  /** Request types that are queued but not answered until releaseHeld(). */
  static hold = new Set<string>();
  static last(): FakeWorker {
    const w = FakeWorker.instances[FakeWorker.instances.length - 1];
    if (w === undefined) throw new Error('no worker was created');
    return w;
  }

  readonly sent: unknown[] = [];
  terminated = false;
  private readonly queue: unknown[] = [];
  private held: unknown[] = [];
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

  /** Answers every queued request in order, using the real handler. Held types wait. */
  flush(): void {
    while (this.queue.length > 0) {
      const message = this.queue.shift();
      if (this.terminated) continue;
      const req = message as { type?: string; id?: number };
      if (req.type !== undefined && FakeWorker.hold.has(req.type)) {
        this.held.push(message);
        continue;
      }
      this.answer(message);
    }
  }

  /** Answers the held requests, oldest first. */
  releaseHeld(): void {
    const list = this.held;
    this.held = [];
    for (const message of list) if (!this.terminated) this.answer(message);
  }

  private answer(message: unknown): void {
    const req = message as { type?: string; id?: number };
    if (FakeWorker.failOpen && req.type === 'open') {
      this.emit('message', {
        data: { type: 'failed', id: req.id, request: 'open', cause: 'internal', error: 'boom' },
      });
      return;
    }
    this.emit('message', { data: handleRequest(this.session, message) });
  }

  fail(): void {
    this.emit('error', {});
  }

  private emit(type: string, event: unknown): void {
    for (const l of this.listeners.get(type) ?? []) l(event);
  }
}

// ---------------------------------------------------------------------------------------------
// Fixture disks
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

const demoDisk = (url: string): Uint8Array => {
  const base = url.split('/').pop() ?? '';
  return new Uint8Array(readFileSync(join(process.cwd(), 'public', 'disks', base)));
};

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
const graveNames = (): Array<string | null | undefined> => graves().map((g) => g.querySelector('.grave-name')?.textContent);
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
/** True when the inline panel shows a file (the empty state has no .preview-kind line). */
const previewShown = (): boolean => document.querySelector('#preview .preview-kind') !== null;
const previewTitle = (): string => $('#preview-title').textContent ?? '';
const currentRows = (): HTMLElement[] => Array.from(document.querySelectorAll<HTMLElement>('#graveyard [aria-current]'));
const hidden = (id: string): boolean => $(`#${id}`).hasAttribute('hidden');

async function exhume(name: string): Promise<void> {
  graveButton(name).click();
  await settle();
}

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
const stubFetch = (make: (url: string) => FakeResponse): void => {
  vi.stubGlobal('fetch', (url: string) => Promise.resolve(make(url)));
};

type NetMode = 'hang' | 'disks' | 'fail' | 'deferred';
interface BootOptions {
  net?: NetMode;
}

const env = { reduced: false, narrow: false };
let releaseNet: () => void = () => {};
let revoked: string[] = [];
let downloads: Array<{ href: string; download: string }> = [];
const recorded: Array<{ target: EventTarget; type: string; listener: EventListenerOrEventListenerObject }> = [];
const saved: Record<string, unknown> = {};
let scrollSpy = vi.fn();
let focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');

const matchMedia = (query: string): { matches: boolean } => ({
  matches: query.includes('prefers-reduced-motion') ? env.reduced : query === NARROW_QUERY ? env.narrow : false,
});

/** Builds the page from index.html and starts the app. Default net mode: the Auto_Open fetch never answers. */
function boot(options: BootOptions = {}): void {
  const net = options.net ?? 'hang';
  if (net === 'hang') {
    vi.stubGlobal('fetch', () => new Promise(() => {}));
  } else if (net === 'disks') {
    stubFetch((url) => respond(demoDisk(url)));
  } else if (net === 'fail') {
    stubFetch(() => respond(new Uint8Array(0), 404));
  } else {
    const gate = new Promise<void>((resolve) => {
      releaseNet = resolve;
    });
    vi.stubGlobal('fetch', (url: string) => gate.then(() => respond(demoDisk(url))));
  }
  buildPage();
  startApp({ matchMedia });
}

function removeListeners(): void {
  for (const r of recorded.splice(0)) r.target.removeEventListener(r.type, r.listener);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  FakeWorker.instances = [];
  FakeWorker.auto = true;
  FakeWorker.failOpen = false;
  FakeWorker.hold = new Set();
  env.reduced = false;
  env.narrow = false;
  scrollSpy = vi.fn();
  saved['scrollIntoView'] = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = scrollSpy as unknown as typeof HTMLElement.prototype.scrollIntoView;
  focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
  vi.stubGlobal('Worker', FakeWorker);
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
});

afterEach(() => {
  removeListeners();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  HTMLElement.prototype.scrollIntoView = saved['scrollIntoView'] as typeof HTMLElement.prototype.scrollIntoView;
  (HTMLAnchorElement.prototype as unknown as Record<string, unknown>)['click'] = saved['click'];
  URL.createObjectURL = saved['create'] as typeof URL.createObjectURL;
  URL.revokeObjectURL = saved['revoke'] as typeof URL.revokeObjectURL;
  document.body.textContent = '';
});

// ---------------------------------------------------------------------------------------------

describe('the real page', () => {
  it('has each retained and added id once, no retired id, and no dialog', () => {
    boot();
    const ids = [
      'app', 'drop-zone', 'pick-button', 'file-input', 'status', 'cancel-button', 'reopen-button', 'demo-slot',
      'graveyard', 'privacy-note', 'honesty-note', 'repo-link', 'yard', 'yard-heading', 'preview', 'headstones',
      'pick-button-footer',
    ];
    for (const id of ids) expect(document.querySelectorAll(`#${CSS.escape(id)}`).length, id).toBe(1);
    for (const id of ['intro', 'fx-host', 'preview-root']) expect(document.getElementById(id), id).toBeNull();
    expect(document.querySelector('[role="dialog"], [aria-modal], [inert]')).toBeNull();
    expect($('#status').getAttribute('aria-live')).toBe('polite');
    expect($('#status').getAttribute('role')).toBe('status');
  });

  it('shows the empty preview and the guidance before any disk is open', () => {
    boot();
    expect(previewShown()).toBe(false);
    expect($('#preview .preview-empty').textContent).toBe('Choose a file to read it here.');
    expect($('#graveyard .graveyard-guidance').hasAttribute('hidden')).toBe(false);
    expect(hidden('cancel-button')).toBe(true);
    expect(hidden('reopen-button')).toBe(true);
  });

  it('opens the file chooser from the hero and the footer buttons (4.5, 11.1)', () => {
    boot();
    const clicks = vi.spyOn($('#file-input'), 'click');
    $('#pick-button').click();
    expect(clicks).toHaveBeenCalledTimes(1);
    $('#pick-button-footer').click();
    expect(clicks).toHaveBeenCalledTimes(2);
  });
});

describe('opening a disk', () => {
  beforeEach(() => boot());

  it('renders tombstones and open graves for a valid disk', async () => {
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

  it('replaces the graveyard and clears the preview on a successful second open', async () => {
    await drop(makeDisk());
    await exhume('NOTES.BIN');
    expect(previewShown()).toBe(true);
    expect(currentRows().length).toBe(1);
    await drop(smallDisk());
    expect(previewShown()).toBe(false);
    expect($('#preview .preview-empty')).not.toBeNull();
    expect(currentRows().length).toBe(0);
    expect(graveNames()).toEqual(['ONLY.BIN']);
  });

  it('revokes the preview image URL when the next disk opens', async () => {
    await drop(makeDisk());
    await exhume('PIC.PCX');
    const src = $('#preview img.preview-png').getAttribute('src') ?? '';
    expect(src).toMatch(/^blob:test\//);
    await drop(smallDisk());
    expect(revoked).toContain(src);
    expect(document.querySelector('#preview img')).toBeNull();
  });

  it('keeps the preview when a later open is rejected', async () => {
    await drop(makeDisk());
    await exhume('NOTES.BIN');
    dropFiles([fileOf(new Uint8Array(0))]);
    await settle();
    expect(previewShown()).toBe(true);
    expect(statusText()).toBe('This file is empty.');
  });
});

describe('open flow: focus, reveal and guidance', () => {
  beforeEach(() => boot());
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
    env.reduced = true;
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
    const names = graveNames();
    scrollSpy.mockClear();
    const pick = $('#pick-button');
    pick.focus();
    FakeWorker.failOpen = true;
    await drop(smallDisk());
    expect(graveNames()).toEqual(names);
    expect(guidanceHidden()).toBe(true);
    expect(document.activeElement).toBe(pick);
    expect(scrollSpy).not.toHaveBeenCalled();
  });
});

describe('Auto_Open (7.5, 7.7, 7.8, 7.9, 8.8, 8.14)', () => {
  it('opens the Writer_Disk and shows CHAPTER1.WS quietly', async () => {
    boot({ net: 'disks' });
    await settle();
    expect(graveNames()).toContain('CHAPTER1.WS');
    expect(graveNames().length).toBe(6);
    expect(previewShown()).toBe(true);
    expect(previewTitle()).toBe('CHAPTER1.WS');
    expect($('#preview .paper')).not.toBeNull();
    expect(currentRows()).toEqual([graveButton('CHAPTER1.WS')]);
    expect(graveButton('CHAPTER1.WS').getAttribute('aria-current')).toBe('true');
    expect(statusText()).toBe('');
    expect(document.activeElement === document.body || document.activeElement === null).toBe(true);
    expect(focusSpy).not.toHaveBeenCalled();
    expect(scrollSpy).not.toHaveBeenCalled();
    expect(hidden('cancel-button')).toBe(true);
    const pressed = Array.from(document.querySelectorAll('#demo-slot .demo-slot-button')).map((c) => c.getAttribute('aria-pressed'));
    expect(pressed).toEqual(['true', 'false', 'false']);
  });

  it('a drop during the disk load wins and the Writer_Disk never appears', async () => {
    boot({ net: 'deferred' });
    await settle(0);
    await drop(smallDisk());
    expect(graveNames()).toEqual(['ONLY.BIN']);
    releaseNet();
    await settle();
    expect(graveNames()).toEqual(['ONLY.BIN']);
    expect(previewShown()).toBe(false);
    expect(currentRows().length).toBe(0);
    expect(FakeWorker.instances.length).toBe(1);
  });

  it('a click on Open during the disk load drops the automatic open', async () => {
    boot({ net: 'deferred' });
    await settle(0);
    $('#pick-button').click();
    releaseNet();
    await settle();
    expect(graves().length).toBe(0);
    expect(previewShown()).toBe(false);
    expect(FakeWorker.instances.length).toBe(0);
  });

  // REAL app.ts BUG (reported, not masked): when accept() returns false the automatic result is
  // dropped on purpose, but the `.then` in app.ts reads `accepted === false` as "the load failed" and
  // writes "The demo disk could not be loaded." into #status. That overwrites the user's own
  // "Opened a disk ..." message (7.8) and announces something on the quiet path (7.5).
  it('a dropped automatic open announces nothing and keeps the user result in #status', async () => {
    boot({ net: 'deferred' });
    await settle(0);
    await drop(smallDisk());
    releaseNet();
    await settle();
    expect(statusText()).toBe('Opened a disk with 1 entries.');
  });

  it('a dropped automatic open leaves #status empty when the user only clicked Open', async () => {
    boot({ net: 'deferred' });
    await settle(0);
    $('#pick-button').click();
    releaseNet();
    await settle();
    expect(statusText()).toBe('');
  });

  it('a row click during the automatic preview wins', async () => {
    FakeWorker.hold = new Set(['exhume']);
    boot({ net: 'disks' });
    await settle();
    expect(graves().length).toBe(6);
    expect(previewShown()).toBe(false);
    graveButton('README.TXT').click();
    await settle();
    FakeWorker.last().releaseHeld();
    await settle();
    expect(previewTitle()).toBe('README.TXT');
    expect(currentRows()).toEqual([graveButton('README.TXT')]);
    expect(statusText()).toBe('Opened README.TXT.');
  });

  it('a new disk during the automatic preview wins', async () => {
    FakeWorker.hold = new Set(['exhume']);
    boot({ net: 'disks' });
    await settle();
    expect(graves().length).toBe(6);
    await drop(smallDisk());
    FakeWorker.last().releaseHeld();
    await settle();
    expect(graveNames()).toEqual(['ONLY.BIN']);
    expect(previewShown()).toBe(false);
    expect(currentRows().length).toBe(0);
  });

  it('shows the failure message and leaves the demo cards usable', async () => {
    boot({ net: 'fail' });
    await settle();
    expect(statusText()).toBe('The demo disk request failed (status 404).');
    expect(graves().length).toBe(0);
    const cards = Array.from(document.querySelectorAll<HTMLButtonElement>('#demo-slot .demo-slot-button'));
    expect(cards.length).toBe(3);
    expect(cards.every((c) => !c.disabled)).toBe(true);
    stubFetch((url) => respond(demoDisk(url)));
    cards[1]?.click();
    await settle();
    expect(graveNames()).toContain('LOGO.PCX');
    expect(cards.map((c) => c.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
  });
});

describe('headstones (5.5, 7.6, 8.19)', () => {
  for (const narrow of [false, true]) {
    const width = narrow ? 'narrow' : 'wide';

    it(`${width}: a headstone on the open Writer_Disk ends on the preview heading`, async () => {
      env.narrow = narrow;
      boot({ net: 'disks' });
      await settle();
      scrollSpy.mockClear();
      $('#headstones [data-path="/README.TXT"]').click();
      await settle();
      expect(document.activeElement).toBe($('#preview-title'));
      expect(previewTitle()).toBe('README.TXT');
      expect(scrollSpy.mock.contexts.at(-1)).toBe($('#preview-title'));
      expect(scrollSpy).toHaveBeenLastCalledWith({ behavior: 'smooth', block: 'start' });
      expect(statusText()).toBe('Opened README.TXT.');
      expect(currentRows()).toEqual([graveButton('README.TXT')]);
    });

    it(`${width}: a headstone with no disk open loads the Writer_Disk, then ends on the preview heading`, async () => {
      env.narrow = narrow;
      boot();
      stubFetch((url) => respond(demoDisk(url)));
      $('#headstones [data-path="/CHAPTER3.WS"]').click();
      await settle();
      await settle();
      expect(graves().length).toBe(6);
      expect(previewTitle()).toBe('CHAPTER3.WS');
      expect(document.activeElement).toBe($('#preview-title'));
      expect(scrollSpy.mock.contexts.at(-1)).toBe($('#preview-title'));
      expect(scrollSpy.mock.contexts).toContain($('#graveyard-heading'));
    });
  }

  it('scrolls instantly under reduced motion', async () => {
    env.reduced = true;
    boot({ net: 'disks' });
    await settle();
    scrollSpy.mockClear();
    $('#headstones [data-path="/CHAPTER2.WS"]').click();
    await settle(0);
    expect(document.activeElement).toBe($('#preview-title'));
    expect(scrollSpy).toHaveBeenLastCalledWith({ behavior: 'instant', block: 'start' });
  });

  it('wins over the Auto_Open when clicked during the disk load', async () => {
    boot({ net: 'deferred' });
    await settle(0);
    $('#headstones [data-path="/CHAPTER2.WS"]').click();
    releaseNet();
    await settle();
    await settle();
    expect(previewTitle()).toBe('CHAPTER2.WS');
    expect(currentRows()).toEqual([graveButton('CHAPTER2.WS')]);
    expect(document.activeElement).toBe($('#preview-title'));
  });
});

describe('grave rows and the preview (8.6, 8.17, 8.18)', () => {
  it('wide: focus stays on the row, the page does not scroll, "Opened NAME." is announced', async () => {
    boot({ net: 'disks' });
    await settle();
    scrollSpy.mockClear();
    const row = graveButton('CHAPTER2.WS');
    row.focus();
    row.click();
    await settle();
    expect(previewTitle()).toBe('CHAPTER2.WS');
    expect(document.activeElement).toBe(row);
    expect(scrollSpy).not.toHaveBeenCalled();
    expect(statusText()).toBe('Opened CHAPTER2.WS.');
    expect(currentRows()).toEqual([row]);
  });

  it('narrow: focus moves to the preview heading and the panel scrolls into view', async () => {
    env.narrow = true;
    boot({ net: 'disks' });
    await settle();
    scrollSpy.mockClear();
    const row = graveButton('CHAPTER2.WS');
    row.focus();
    row.click();
    await settle();
    expect(document.activeElement).toBe($('#preview-title'));
    expect(scrollSpy.mock.contexts.at(-1)).toBe($('#preview-title'));
    expect(scrollSpy).toHaveBeenLastCalledWith({ behavior: 'smooth', block: 'start' });
    expect(statusText()).toBe('Opened CHAPTER2.WS.');
  });

  it('narrow with reduced motion scrolls instantly', async () => {
    env.narrow = true;
    boot({ net: 'disks' });
    await settle();
    env.reduced = true;
    scrollSpy.mockClear();
    graveButton('CHAPTER2.WS').click();
    await settle(0);
    expect(scrollSpy).toHaveBeenLastCalledWith({ behavior: 'instant', block: 'start' });
  });

  it('judges the layout when the preview arrives, not when the row was clicked', async () => {
    boot({ net: 'disks' });
    await settle();
    scrollSpy.mockClear();
    FakeWorker.hold = new Set(['exhume']);
    const row = graveButton('CHAPTER2.WS');
    row.focus();
    row.click();
    await settle();
    env.narrow = true;
    FakeWorker.last().releaseHeld();
    await settle();
    expect(document.activeElement).toBe($('#preview-title'));
  });
});

describe('footer and tab order (8.13, 11.1)', () => {
  it('lists the page groups in visual order with no positive tabindex', async () => {
    boot({ net: 'disks' });
    await settle();
    const all = Array.from(document.querySelectorAll<HTMLElement>('a[href], button, input, [tabindex]'));
    const tabbable = all.filter(
      (el) =>
        el.closest('[hidden]') === null &&
        !(el as HTMLButtonElement).disabled &&
        el.getAttribute('tabindex') !== '-1' &&
        !(el.tagName === 'A' && el.closest('svg') !== null),
    );
    expect(all.some((el) => Number(el.getAttribute('tabindex') ?? '0') > 0)).toBe(false);
    const index = (el: Element | null): number => {
      if (el === null) throw new Error('missing group member');
      const i = tabbable.indexOf(el as HTMLElement);
      if (i < 0) throw new Error(`not tabbable: ${el.className || el.id}`);
      return i;
    };
    const range = (els: Element[]): [number, number] => {
      expect(els.length).toBeGreaterThan(0);
      const at = els.map(index);
      return [Math.min(...at), Math.max(...at)];
    };
    const groups: Array<[string, [number, number]]> = [
      ['nav', range(Array.from(document.querySelectorAll('.nav a')))],
      ['open', range([$('#pick-button')])],
      ['demo link', range([$('#demo-link')])],
      ['headstones', range(Array.from(document.querySelectorAll('#headstones button')))],
      ['demo cards', range(Array.from(document.querySelectorAll('#demo-slot button')))],
      ['rows', range(Array.from(document.querySelectorAll('#graveyard button.grave-action')))],
      ['preview', range(Array.from(document.querySelectorAll('#preview button.preview-download, #preview [tabindex="0"]')))],
      ['footer button', range([$('#pick-button-footer')])],
      ['footer links', range(Array.from(document.querySelectorAll('#foot a')))],
    ];
    expect(document.querySelectorAll('#headstones button').length).toBe(6);
    for (let i = 1; i < groups.length; i++) {
      const prev = groups[i - 1];
      const next = groups[i];
      if (prev === undefined || next === undefined) continue;
      expect(prev[1][1], `${prev[0]} before ${next[0]}`).toBeLessThan(next[1][0]);
    }
  });

  it('the footer button counts as user intent and drops the Auto_Open', async () => {
    boot({ net: 'deferred' });
    await settle(0);
    $('#pick-button-footer').click();
    releaseNet();
    await settle();
    expect(graves().length).toBe(0);
    expect(previewShown()).toBe(false);
  });
});

describe('pressed demo card (8.5, 8.6, 8.8)', () => {
  beforeEach(() => boot());
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
    expect(graveNames()).toEqual(['ONLY.BIN']);
    expect(pressed().every((v) => v === 'false')).toBe(true);
  });

  it('clears the preview when a demo opens', async () => {
    stubFetch(() => respond(makeDisk()));
    await clickCard(0);
    await exhume('NOTES.BIN');
    expect(previewShown()).toBe(true);
    await clickCard(1);
    expect(previewShown()).toBe(false);
  });

  it('leaves everything unchanged when a later demo fails to load', async () => {
    stubFetch(() => respond(makeDisk()));
    await clickCard(0);
    const before = pressed();
    const names = graveNames();
    stubFetch(() => respond(new Uint8Array(0), 404));
    await clickCard(1);
    expect(demoStatus()).toBe('The demo disk request failed (status 404).');
    expect(pressed()).toEqual(before);
    expect(graveNames()).toEqual(names);
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

describe('inline previews', () => {
  beforeEach(() => boot());

  it('previews markdown beside the list, with downloads, and keeps focus on the row', async () => {
    await drop(makeDisk());
    const opener = graveButton('LETTER.WS');
    opener.focus();
    await exhume('LETTER.WS');

    const panel = $('#preview');
    expect(panel.querySelector('.preview-markdown')?.textContent).toContain('Hello');
    expect(previewTitle()).toBe('LETTER.WS');
    expect(panel.querySelector('.preview-kind')?.textContent).toBe('Read as Markdown');
    expect($('#app').hasAttribute('inert')).toBe(false);
    expect(document.activeElement).toBe(opener);
    expect(statusText()).toBe('Opened LETTER.WS.');
    expect(opener.getAttribute('aria-current')).toBe('true');
    expect(graveButton('NOTES.BIN').hasAttribute('aria-current')).toBe(false);

    const buttons = Array.from(panel.querySelectorAll<HTMLButtonElement>('.preview-download'));
    expect(buttons.map((b) => b.textContent)).toEqual(['Download .md', 'Download raw bytes']);
    buttons[0]?.click();
    buttons[1]?.click();
    expect(downloads.length).toBe(2);
    expect(downloads[0]?.download).toMatch(/\.md$/);
    expect(downloads[1]?.download).toMatch(/\.bin$/);
    expect(downloads.every((x) => x.href.startsWith('blob:'))).toBe(true);
    await settle(600);
    expect(revoked.length).toBe(2);
  });

  it('Escape does nothing to the inline preview', async () => {
    await drop(makeDisk());
    await exhume('LETTER.WS');
    document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(previewShown()).toBe(true);
  });

  it('previews csv as a table', async () => {
    await drop(makeDisk());
    await exhume('DATA.DBF');
    const table = $('#preview table.csv-table');
    expect(table.textContent).toContain('ABCD');
    expect(table.textContent).toContain('WXYZ');
    expect($('#preview .preview-download').textContent).toBe('Download .csv');
  });

  it('previews png with an owned blob url that is revoked when the preview is replaced', async () => {
    await drop(makeDisk());
    await exhume('PIC.PCX');
    const src = $('#preview img.preview-png').getAttribute('src') ?? '';
    expect(src).toMatch(/^blob:test\//);
    expect($('#preview .preview-download').textContent).toBe('Download .png');
    await exhume('NOTES.BIN');
    expect(revoked).toContain(src);
  });

  it('falls back to a hex view with an error for unknown bytes', async () => {
    await drop(makeDisk());
    await exhume('NOTES.BIN');
    const panel = $('#preview');
    expect(panel.querySelector('.hex-view')).not.toBeNull();
    expect(panel.querySelector('.preview-error')?.textContent).not.toBe('');
    expect(panel.querySelector('.hex-text')?.textContent).toContain('JUNKDATA');
    expect(Array.from(panel.querySelectorAll('.preview-download')).map((b) => b.textContent)).toEqual(['Download raw bytes']);
  });

  it('waits for the rising animation before showing the preview, unless motion is reduced', async () => {
    await drop(makeDisk());
    graveButton('NOTES.BIN').click();
    await settle(0);
    expect(previewShown()).toBe(false);
    expect(graveByName('NOTES.BIN').classList.contains('is-rising')).toBe(true);
    expect(statusText()).toBe('Rising: NOTES.BIN');
    await settle(1000);
    expect(previewShown()).toBe(true);
    expect(graveByName('NOTES.BIN').classList.contains('is-rising')).toBe(false);

    env.reduced = true;
    graveButton('LETTER.WS').click();
    await settle(0);
    expect(previewTitle()).toBe('LETTER.WS');
  });
});

describe('lost reader and cancel', () => {
  beforeEach(() => boot());

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
    expect(previewShown()).toBe(true);
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
    expect(previewShown()).toBe(false);
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
  beforeEach(() => boot());

  it('ignores the answer to an open that a newer drop superseded', async () => {
    FakeWorker.auto = false;
    dropFiles([fileOf(makeDisk())]);
    await settle();
    dropFiles([fileOf(smallDisk())]);
    await settle();
    FakeWorker.last().flush();
    await settle();
    expect(graveNames()).toEqual(['ONLY.BIN']);
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
    expect(previewShown()).toBe(false);
    expect(graveNames()).toEqual(['ONLY.BIN']);
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
