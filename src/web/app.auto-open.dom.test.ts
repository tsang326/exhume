// @vitest-environment happy-dom
// Property 10: Auto_Open never overrides the user, in either step.
// The page is the real index.html body. The Worker is an in-process fake that the test answers one
// message at a time, and fetch is a fake whose responses the test releases one at a time, so the
// two Auto_Open steps (disk load, CHAPTER1.WS preview) can be interleaved with user actions.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeFat12Image } from '../test-support/fat12/index';
import { numRuns } from '../test-support/runs';
import { startApp } from './app';
import { handleRequest, createSession as createWorkerSession } from './worker/disk-handler';
import type { WorkerSession } from './worker/disk-handler';

// ---------------------------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------------------------

interface QueuedMessage {
  owner: FakeWorker;
  message: unknown;
}

let workerQueue: QueuedMessage[] = [];

class FakeWorker {
  readonly session: WorkerSession = createWorkerSession();
  terminated = false;
  private readonly listeners = new Map<string, Array<(event: unknown) => void>>();

  constructor(_url?: unknown, _options?: unknown) {}

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  removeEventListener(): void {}

  postMessage(message: unknown): void {
    workerQueue.push({ owner: this, message });
  }

  terminate(): void {
    this.terminated = true;
  }

  answer(message: unknown): void {
    if (this.terminated) return;
    const data = handleRequest(this.session, message);
    for (const l of this.listeners.get('message') ?? []) l({ data });
  }
}

interface PendingFetch {
  url: string;
  release(): void;
}

let pendingFetches: PendingFetch[] = [];

const WRITERS_URL = '/disks/writers-disk.img';
const writersBytes = new Uint8Array(readFileSync(join(process.cwd(), 'public', 'disks', 'writers-disk.img')));
const ascii = (s: string): Uint8Array => new TextEncoder().encode(s);
const userDisk = writeFat12Image(
  { volumeLabel: 'SECOND', children: [{ kind: 'file', name: 'ONLY.BIN', content: ascii('JUNKJUNK') }] },
  '360K',
);

function fakeFetch(input: RequestInfo | URL): Promise<Response> {
  const url = String(input);
  const bytes = url === WRITERS_URL ? writersBytes : userDisk;
  return new Promise<Response>((resolve) => {
    pendingFetches.push({
      url,
      release: () =>
        resolve({
          status: 200,
          headers: { get: () => null },
          body: null,
          arrayBuffer: () => Promise.resolve(bytes.slice().buffer),
        } as unknown as Response),
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Page environment (one fresh page and app per property run)
// ---------------------------------------------------------------------------------------------

const recorded: Array<{ target: EventTarget; type: string; listener: EventListenerOrEventListenerObject }> = [];
const saved: { scroll?: typeof HTMLElement.prototype.scrollIntoView } = {};
let scrollCalls = 0;
let focusCalls = 0;

function loadPage(): void {
  const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
  const start = html.indexOf('<body>');
  const end = html.indexOf('</body>');
  const inner = html.slice(start + '<body>'.length, end).replace(/<script[\s\S]*?<\/script>/g, '');
  document.body.innerHTML = inner;
}

function setup(): void {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  workerQueue = [];
  pendingFetches = [];
  scrollCalls = 0;
  focusCalls = 0;
  saved.scroll = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = (() => {
    scrollCalls++;
  }) as unknown as typeof HTMLElement.prototype.scrollIntoView;
  const realFocus = HTMLElement.prototype.focus;
  vi.spyOn(HTMLElement.prototype, 'focus').mockImplementation(function (this: HTMLElement, o?: FocusOptions) {
    focusCalls++;
    realFocus.call(this, o);
  });
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('fetch', fakeFetch);
  for (const target of [document, window] as EventTarget[]) {
    const original = target.addEventListener.bind(target);
    vi.spyOn(target, 'addEventListener').mockImplementation(
      (type: string, listener: EventListenerOrEventListenerObject | null, opts?: unknown) => {
        if (listener !== null) recorded.push({ target, type, listener });
        original(type, listener, opts as AddEventListenerOptions);
      },
    );
  }
  loadPage();
  // Reduced motion on: the rise animation ends at once, so only the worker answers gate a preview.
  startApp({ matchMedia: () => ({ matches: true }) as unknown as MediaQueryList });
}

function teardown(): void {
  for (const r of recorded.splice(0)) r.target.removeEventListener(r.type, r.listener);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  HTMLElement.prototype.scrollIntoView = saved.scroll as typeof HTMLElement.prototype.scrollIntoView;
  document.body.textContent = '';
}

async function tick(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(0);
}

// ---------------------------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------------------------

type Action =
  | { kind: 'fetch' } // release the oldest pending demo fetch
  | { kind: 'answerOldest' }
  | { kind: 'answerNewest' }
  | { kind: 'drop' } // user drops another disk
  | { kind: 'card' } // user clicks the small-business demo card
  | { kind: 'pick' } // user clicks the open button (intent without a disk)
  | { kind: 'row'; index: number }; // user activates a file row

const actionArb: fc.Arbitrary<Action> = fc.oneof(
  { weight: 3, arbitrary: fc.constant<Action>({ kind: 'fetch' }) },
  { weight: 4, arbitrary: fc.constant<Action>({ kind: 'answerOldest' }) },
  { weight: 1, arbitrary: fc.constant<Action>({ kind: 'answerNewest' }) },
  { weight: 1, arbitrary: fc.constant<Action>({ kind: 'drop' }) },
  { weight: 1, arbitrary: fc.constant<Action>({ kind: 'card' }) },
  { weight: 1, arbitrary: fc.constant<Action>({ kind: 'pick' }) },
  { weight: 3, arbitrary: fc.nat(20).map<Action>((index) => ({ kind: 'row', index })) },
);

interface Model {
  /** Any user action happened (the page's own notion of intent). */
  intent: boolean;
  /** A user disk (drop or demo card) was started. */
  userDisk: boolean;
  /** The file name of the last row the user activated, or null. */
  lastRow: string | null;
  /** The quiet preview was already on screen when the user first acted. */
  autoShownFirst: boolean;
}

function intent(model: Model): void {
  if (!model.intent) model.autoShownFirst = $('#preview-title')?.textContent === 'CHAPTER1.WS';
  model.intent = true;
}

const $ = (sel: string): HTMLElement | null => document.querySelector<HTMLElement>(sel);

function dropUserDisk(): void {
  const file = {
    name: 'user.img',
    size: userDisk.length,
    arrayBuffer: () => Promise.resolve(userDisk.slice().buffer),
  };
  const ev = new Event('drop', { cancelable: true, bubbles: true });
  Object.defineProperty(ev, 'dataTransfer', { value: { files: [file], items: [{ kind: 'file' }] } });
  document.dispatchEvent(ev);
}

async function perform(action: Action, model: Model): Promise<void> {
  switch (action.kind) {
    case 'fetch':
      pendingFetches.shift()?.release();
      break;
    case 'answerOldest': {
      const next = workerQueue.shift();
      next?.owner.answer(next.message);
      break;
    }
    case 'answerNewest': {
      const next = workerQueue.pop();
      next?.owner.answer(next.message);
      break;
    }
    case 'drop':
      intent(model);
      model.userDisk = true;
      dropUserDisk();
      break;
    case 'card': {
      const cards = Array.from(document.querySelectorAll<HTMLButtonElement>('.demo-slot-button'));
      const card = cards.find((b) => b.textContent?.includes('small-business'));
      if (card === undefined || card.disabled) break;
      intent(model);
      model.userDisk = true;
      card.click();
      break;
    }
    case 'pick':
      intent(model);
      $('#pick-button')?.click();
      break;
    case 'row': {
      // Rows of an earlier disk are not clicked once a user disk is on its way: that is a different race.
      if (model.userDisk) break;
      const rows = Array.from(document.querySelectorAll<HTMLButtonElement>('#graveyard button.grave-action')).filter(
        (b) => !b.disabled,
      );
      const row = rows[action.index % Math.max(rows.length, 1)];
      if (row === undefined) break;
      intent(model);
      model.lastRow = row.querySelector('.grave-name')?.textContent ?? null;
      row.click();
      break;
    }
  }
  await tick();
}

/** Releases every fetch and answers every worker message until nothing is left. */
async function drain(): Promise<void> {
  for (let i = 0; i < 80; i++) {
    if (pendingFetches.length === 0 && workerQueue.length === 0) return;
    while (pendingFetches.length > 0) pendingFetches.shift()?.release();
    await tick();
    while (workerQueue.length > 0) {
      const next = workerQueue.shift();
      next?.owner.answer(next.message);
      await tick();
    }
  }
}

const graveNames = (): string[] =>
  Array.from(document.querySelectorAll('#graveyard .grave-name')).map((n) => n.textContent ?? '');
const previewTitle = (): string => $('#preview-title')?.textContent ?? '';
const currentRows = (): string[] =>
  Array.from(document.querySelectorAll('#graveyard [aria-current="true"] .grave-name')).map((n) => n.textContent ?? '');

// ---------------------------------------------------------------------------------------------

beforeEach(setup);
afterEach(teardown);

describe('Auto_Open (Property 10)', () => {
  it('opens the Writer_Disk and shows CHAPTER1.WS quietly when the user does nothing', async () => {
    await drain();
    expect(graveNames()).toContain('CHAPTER1.WS');
    expect(previewTitle()).toBe('CHAPTER1.WS');
    expect(currentRows()).toEqual(['CHAPTER1.WS']);
    expect($('#status')?.textContent).toBe('');
    expect(focusCalls).toBe(0);
    expect(scrollCalls).toBe(0);
    expect(document.activeElement === document.body || document.activeElement === null).toBe(true);
  });

  it('keeps a user drop in front of an Auto_Open that is still loading', async () => {
    dropUserDisk();
    await tick();
    await drain();
    expect(graveNames()).toEqual(['ONLY.BIN']);
    expect(previewTitle()).toBe('Preview');
  });

  it('does not replace a user row with the quiet preview', async () => {
    // Release the disk and answer its open; the quiet exhume is now queued.
    pendingFetches.shift()?.release();
    await tick();
    const open = workerQueue.shift();
    open?.owner.answer(open.message);
    await tick();
    const row = Array.from(document.querySelectorAll<HTMLButtonElement>('#graveyard button.grave-action')).find(
      (b) => b.querySelector('.grave-name')?.textContent === 'README.TXT',
    );
    expect(row).toBeDefined();
    row?.click();
    await tick();
    await drain();
    expect(previewTitle()).toBe('README.TXT');
    expect(currentRows()).toEqual(['README.TXT']);
  });

  // Feature: page-redesign, Property 10: Auto_Open never overrides the user, in either step
  // **Validates: Requirements 7.5, 7.8, 8.8, 8.14**
  it('never lets either Auto_Open step override a user action, for any interleaving', async () => {
    teardown();
    await fc.assert(
      fc.asyncProperty(fc.array(actionArb, { maxLength: 14 }), async (actions) => {
        setup();
        try {
          const model: Model = { intent: false, userDisk: false, lastRow: null, autoShownFirst: false };
          for (const action of actions) await perform(action, model);
          await drain();

          if (!model.intent) {
            // Nobody acted: both steps applied, quietly.
            return (
              graveNames().includes('CHAPTER1.WS') &&
              previewTitle() === 'CHAPTER1.WS' &&
              currentRows().length === 1 &&
              currentRows()[0] === 'CHAPTER1.WS' &&
              ($('#status')?.textContent ?? '') === '' &&
              focusCalls === 0 &&
              scrollCalls === 0
            );
          }
          if (model.userDisk) {
            // The last user disk wins and nothing from the Writer_Disk survives on the page.
            const names = graveNames();
            return names.length === 1 && names[0] === 'ONLY.BIN' && previewTitle() === 'Preview';
          }
          // The user acted without opening a disk of their own: the quiet preview never appears on top
          // of what they chose. A chosen row is shown; with no row chosen the panel is empty.
          if (model.lastRow !== null) {
            return previewTitle() === model.lastRow && currentRows().length === 1 && currentRows()[0] === model.lastRow;
          }
          if (model.autoShownFirst) return previewTitle() === 'CHAPTER1.WS';
          return previewTitle() === 'Preview' && currentRows().length === 0;
        } finally {
          teardown();
        }
      }),
      { numRuns: numRuns(40) },
    );
    setup();
    expect(true).toBe(true);
  });
});
