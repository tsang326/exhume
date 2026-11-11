// @vitest-environment happy-dom
// Request ordering through the real startApp(): a scripted Worker computes each answer when the
// request arrives (as a real worker does, in order) but the test delivers the answers to the page
// in any order and at any time between user operations.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { writeFat12Image } from '../test-support/fat12/index';
import type { FileTree } from '../test-support/fat12/index';
import { numRuns } from '../test-support/runs';
import { startApp } from './app';
import { handleRequest, createSession as createWorkerSession } from './worker/disk-handler';
import type { WorkerSession } from './worker/disk-handler';

// ---------------------------------------------------------------------------------------------
// Scripted worker
// ---------------------------------------------------------------------------------------------

class ScriptedWorker {
  /** Answers that were computed but not yet delivered to the page. */
  static outbox: Array<() => void> = [];

  private readonly listeners = new Map<string, Array<(event: unknown) => void>>();
  private readonly session: WorkerSession = createWorkerSession();

  constructor(_url?: unknown, _options?: unknown) {}

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  removeEventListener(): void {}

  postMessage(message: unknown): void {
    // The worker handles requests in arrival order; only the delivery of the answer is scripted.
    const data = handleRequest(this.session, message);
    ScriptedWorker.outbox.push(() => {
      for (const l of this.listeners.get('message') ?? []) l({ data });
    });
  }

  terminate(): void {}
}

// ---------------------------------------------------------------------------------------------
// Page and helpers
// ---------------------------------------------------------------------------------------------

const encoder = new TextEncoder();
const FILES_PER_DISK = 3;

/** Every open gets its own file names, so a name tells which display a preview came from. */
function diskFor(seq: number): Uint8Array {
  const children: FileTree['children'] = [];
  for (let i = 0; i < FILES_PER_DISK; i++) {
    children.push({ kind: 'file', name: `D${seq}F${i}.TXT`, content: encoder.encode(`disk ${seq} file ${i}`) });
  }
  return writeFat12Image({ volumeLabel: `DISK${seq}`, children }, '360K');
}

function buildPage(): void {
  const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  for (const script of Array.from(parsed.querySelectorAll('script'))) script.remove();
  document.body.innerHTML = parsed.body.innerHTML;
}

function dropBytes(bytes: Uint8Array): void {
  const file = { name: 'disk.img', size: bytes.length, arrayBuffer: () => Promise.resolve(bytes.slice().buffer) };
  const ev = new Event('drop', { cancelable: true, bubbles: true });
  Object.defineProperty(ev, 'dataTransfer', { value: { files: [file], items: [{ kind: 'file' }] } });
  document.dispatchEvent(ev);
}

const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

async function settle(): Promise<void> {
  for (let i = 0; i < 3; i++) await tick();
}

const rowButtons = (): HTMLButtonElement[] =>
  Array.from(document.querySelectorAll<HTMLButtonElement>('#graveyard li.grave button.grave-action'));
const nameOf = (b: HTMLButtonElement): string => b.querySelector('.grave-name')?.textContent ?? '';
const previewTitle = (): string => document.getElementById('preview-title')?.textContent ?? '';
const EMPTY_TITLE = 'Preview';

type Op =
  | { op: 'open' }
  | { op: 'activate'; index: number }
  | { op: 'deliver'; pick: number };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  { weight: 3, arbitrary: fc.constant<Op>({ op: 'open' }) },
  { weight: 4, arbitrary: fc.nat({ max: FILES_PER_DISK - 1 }).map<Op>((index) => ({ op: 'activate', index })) },
  { weight: 5, arbitrary: fc.nat({ max: 1000 }).map<Op>((pick) => ({ op: 'deliver', pick })) },
);

const scenarioArb = fc.record({
  ops: fc.array(opArb, { minLength: 1, maxLength: 14 }),
  drain: fc.array(fc.nat({ max: 1000 }), { maxLength: 40 }),
});

const recorded: Array<{ target: EventTarget; type: string; listener: EventListenerOrEventListenerObject }> = [];
const saved: Record<string, unknown> = {};

beforeEach(() => {
  ScriptedWorker.outbox = [];
  vi.stubGlobal('Worker', ScriptedWorker);
  // The Auto_Open fetch fails; the scenarios start from an empty page.
  vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
  saved['scrollIntoView'] = HTMLElement.prototype.scrollIntoView;
  HTMLElement.prototype.scrollIntoView = (() => {}) as unknown as typeof HTMLElement.prototype.scrollIntoView;
  saved['getContext'] = HTMLCanvasElement.prototype.getContext;
  (HTMLCanvasElement.prototype as unknown as { getContext: () => null }).getContext = () => null;
  let n = 0;
  saved['create'] = URL.createObjectURL;
  saved['revoke'] = URL.revokeObjectURL;
  URL.createObjectURL = () => `blob:test/${++n}`;
  URL.revokeObjectURL = () => {};

  for (const target of [document, window] as EventTarget[]) {
    const original = target.addEventListener.bind(target);
    vi.spyOn(target, 'addEventListener').mockImplementation((type: string, listener: EventListenerOrEventListenerObject | null, opts?: unknown) => {
      if (listener !== null) recorded.push({ target, type, listener });
      original(type, listener, opts as AddEventListenerOptions);
    });
  }
});

afterEach(() => {
  for (const r of recorded.splice(0)) r.target.removeEventListener(r.type, r.listener);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  HTMLElement.prototype.scrollIntoView = saved['scrollIntoView'] as typeof HTMLElement.prototype.scrollIntoView;
  (HTMLCanvasElement.prototype as unknown as Record<string, unknown>)['getContext'] = saved['getContext'];
  URL.createObjectURL = saved['create'] as typeof URL.createObjectURL;
  URL.revokeObjectURL = saved['revoke'] as typeof URL.revokeObjectURL;
  document.body.textContent = '';
});

/** Reduced motion on (no rise timers), narrow layout off. */
const matchMedia = (q: string): { matches: boolean } => ({ matches: q.includes('prefers-reduced-motion') });

interface Activation {
  epoch: number;
  name: string;
}

/**
 * Runs one scenario on a fresh page and reports a violation message, or null when Property 5 holds.
 * A "display" is one graveyard list on the page; it changes each time an open answer is applied.
 */
async function runScenario(ops: Op[], drain: number[]): Promise<string | null> {
  ScriptedWorker.outbox = [];
  buildPage();
  startApp({ matchMedia });
  await settle();
  ScriptedWorker.outbox = []; // anything from the failed Auto_Open

  let seq = 0;
  let epoch = 0;
  let shown: Element | null = null;
  const activations: Activation[] = [];

  const observe = (): void => {
    const first = document.querySelector('#graveyard li.grave');
    if (first !== null && first !== shown) epoch++;
    if (first !== null) shown = first;
  };
  const deliver = async (pick: number): Promise<void> => {
    if (ScriptedWorker.outbox.length === 0) return;
    const [answer] = ScriptedWorker.outbox.splice(pick % ScriptedWorker.outbox.length, 1);
    answer?.();
    await settle();
    observe();
  };

  for (const step of ops) {
    if (step.op === 'open') {
      dropBytes(diskFor(seq++));
      await settle();
    } else if (step.op === 'activate') {
      const buttons = rowButtons();
      const button = buttons[step.index % Math.max(buttons.length, 1)];
      if (button === undefined) continue; // no disk is shown yet
      activations.push({ epoch, name: nameOf(button) });
      button.click();
      await settle();
    } else {
      await deliver(step.pick);
    }
    observe();
  }
  for (const pick of drain) await deliver(pick);
  while (ScriptedWorker.outbox.length > 0) await deliver(0);

  const title = previewTitle();
  if (title === EMPTY_TITLE) return null;
  const latest = [...activations].reverse().find((a) => a.epoch === epoch);
  if (latest === undefined) return `preview "${title}" shown but no file was requested on the displayed disk`;
  if (title !== latest.name) return `preview "${title}" is not the latest request "${latest.name}" on the displayed disk`;
  return null;
}

// ---------------------------------------------------------------------------------------------

describe('request ordering', () => {
  it('shows the file when its answer arrives in order', async () => {
    expect(await runScenario([{ op: 'open' }, { op: 'deliver', pick: 0 }, { op: 'activate', index: 1 }, { op: 'deliver', pick: 0 }], [])).toBeNull();
    expect(previewTitle()).toBe('D0F1.TXT');
  });

  it('drops the answer of an older activation delivered after a newer one', async () => {
    const ops: Op[] = [
      { op: 'open' },
      { op: 'deliver', pick: 0 },
      { op: 'activate', index: 0 },
      { op: 'activate', index: 2 },
      { op: 'deliver', pick: 1 },
      { op: 'deliver', pick: 0 },
    ];
    expect(await runScenario(ops, [])).toBeNull();
    expect(previewTitle()).toBe('D0F2.TXT');
  });

  // Feature: page-redesign, Property 5: A superseded request never shows a preview
  // **Validates: Requirements 8.6, 8.14, 14.4**
  it('Property 5: a superseded request never shows a preview, whatever the answer order', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, async ({ ops, drain }) => {
        try {
          const violation = await runScenario(ops, drain);
          if (violation !== null) throw new Error(violation);
          return true;
        } finally {
          for (const r of recorded.splice(0)) r.target.removeEventListener(r.type, r.listener);
        }
      }),
      { numRuns: numRuns(40) },
    );
  }, 120_000);
});
