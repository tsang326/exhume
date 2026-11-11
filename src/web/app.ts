// App wiring: finds the page elements, builds the modules and runs the session.
// Nothing here reads a disk; the worker client moves messages and this file shows the results.
import { createBlobUrlManager } from './dom/blob-urls';
import { createDemoSlot } from './dom/demo-slot';
import type { DemoSlot } from './dom/demo-slot';
import { createDownloader } from './dom/download';
import { installGlobalErrorHandlers } from './dom/errors';
import { createGraveyardView } from './dom/graveyard';
import { h } from './dom/h';
import { bindHeadstones } from './dom/headstones';
import { createIntake } from './dom/intake';
import { createPreviewPanel } from './dom/preview';
import { playRise } from './dom/rising';
import type { RiseHandle } from './dom/rising';
import { createStatusRegion } from './dom/status';
import type { StatusRegion } from './dom/status';
import { createWorkerClient } from './dom/worker-client';
import type { WorkerClient } from './dom/worker-client';
import { mayApplyAutoOpen, mayApplyAutoPreview } from './logic/auto-open';
import { isNarrow } from './logic/layout';
import type { MatchMediaLike } from './logic/layout';
import { buildPreviewModel } from './logic/preview-model';
import type { ExhumeOutcome } from './logic/preview-model';
import { startRise, stepRise } from './logic/rise-gate';
import type { RiseEvent, RiseState } from './logic/rise-gate';
import {
  CANCELLED_MESSAGE,
  OPENING_MESSAGE,
  RISING_MESSAGE,
  actionsEnabled,
  applyLost,
  applyOpened,
  createSession,
  reopenBytes,
} from './logic/session';
import type { Session } from './logic/session';
import { toItemViewModels } from './logic/viewmodel';
import type { ItemViewModel } from './logic/viewmodel';

type ActivateOrigin = 'row' | 'headstone';

const AUTO_PREVIEW_PATH = '/CHAPTER1.WS';
const MISSING_ELEMENTS_MESSAGE = 'Part of this page did not load, so some controls may not work.';
const OPEN_FAILED_MESSAGE = 'The disk could not be opened because the reader reported an error.';
const OPEN_INVALID_MESSAGE = 'The disk could not be opened because the request was not valid.';
const REOPEN_NEEDED_MESSAGE = 'The disk reader stopped. Reopen the disk to continue.';

function byId(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function setHidden(el: HTMLElement | null, hidden: boolean): void {
  if (el === null) return;
  if (hidden) el.setAttribute('hidden', '');
  else el.removeAttribute('hidden');
}

export interface StartOptions {
  /** Injected for tests; defaults to window.matchMedia. */
  matchMedia?: MatchMediaLike;
}

function defaultMatchMedia(): MatchMediaLike | undefined {
  return typeof window.matchMedia === 'function' ? (q) => window.matchMedia(q) : undefined;
}

/** The status region: the page element, or a detached-then-appended paragraph if it is missing. */
function findStatus(missing: string[]): StatusRegion {
  let el = byId('status');
  if (el === null) {
    missing.push('status');
    el = h('p', { id: 'status', role: 'status', 'aria-live': 'polite' });
    document.body.appendChild(el);
  }
  return createStatusRegion(el);
}

export function startApp(options: StartOptions = {}): void {
  const matchMedia = options.matchMedia ?? defaultMatchMedia();
  const prefersReducedMotion = (): boolean => {
    try {
      return matchMedia !== undefined && matchMedia('(prefers-reduced-motion: reduce)').matches === true;
    } catch {
      return false;
    }
  };
  const missing: string[] = [];
  const status = findStatus(missing);
  const scrollStatusIntoView = (): void => {
    const el = byId('status');
    if (el !== null && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: prefersReducedMotion() ? 'instant' : 'smooth', block: 'nearest' });
    }
  };
  installGlobalErrorHandlers(status);

  let graveyardRoot = byId('graveyard');
  if (graveyardRoot === null) {
    missing.push('graveyard');
    graveyardRoot = h('section', { 'aria-label': 'Graveyard' }); // detached
  }
  let previewRoot = byId('preview');
  if (previewRoot === null) {
    missing.push('preview');
    previewRoot = h('section', { 'aria-label': 'Preview' }); // detached
  }
  let headstonesRoot = byId('headstones');
  if (headstonesRoot === null) {
    missing.push('headstones');
    headstonesRoot = h('div', {}); // detached
  }
  let footerPick = byId('pick-button-footer');
  if (footerPick === null) {
    missing.push('pick-button-footer');
    footerPick = h('button', { type: 'button' }); // detached
  }
  const cancelButton = byId('cancel-button');
  const reopenButton = byId('reopen-button');
  const demoMount = byId('demo-slot');
  if (demoMount === null) missing.push('demo-slot');
  if (cancelButton === null) missing.push('cancel-button');
  if (reopenButton === null) missing.push('reopen-button');

  // Session and per-request bookkeeping
  let session: Session = createSession();
  let openToken = 0;
  let exhumeToken = 0;
  let slot: DemoSlot | null = null;
  // Set synchronously around the intake call by the demo and headstone paths; openBytes consumes it.
  const pending: { source: string | null; after: string | null; quiet: boolean } = {
    source: null,
    after: null,
    quiet: false,
  };
  let openSource: string | null = null;
  // True once the user acts (click, chooser change, drop). Never goes back to false. Read by the Auto_Open gates.
  let intentSeen = false;
  const markIntent = (): void => {
    intentSeen = true;
  };
  let rise: { state: RiseState; handle: RiseHandle | null; outcome: ExhumeOutcome | null; item: ItemViewModel; origin: ActivateOrigin } | null = null;

  const blobs = createBlobUrlManager();
  const downloader = createDownloader(blobs);

  const preview = createPreviewPanel(previewRoot, { blobs, downloader });

  function refreshControls(): void {
    setHidden(cancelButton, !client.hasPending());
    setHidden(reopenButton, reopenBytes(session) === null);
    graveyard.setActionsEnabled(actionsEnabled(session));
  }

  const client: WorkerClient = createWorkerClient(undefined, {
    onLost: () => {
      markLost(REOPEN_NEEDED_MESSAGE);
    },
  });

  const graveyard = createGraveyardView(graveyardRoot, (item) => {
    markIntent();
    activate(item, 'row');
  });

  function markLost(message: string): void {
    session = applyLost(session);
    status.set(message);
    refreshControls();
  }

  // ----- Opening a disk -----
  function openBytes(bytes: Uint8Array, reopenSource?: string | null): void {
    const source = reopenSource !== undefined ? reopenSource : pending.source;
    const after = reopenSource !== undefined ? null : pending.after;
    const quiet = reopenSource === undefined && pending.quiet;
    let autoItem: ItemViewModel | null = null;
    pending.source = null;
    pending.after = null;
    pending.quiet = false;
    const mine = ++openToken;
    client.supersedeAll();
    abandonRise();
    status.set(OPENING_MESSAGE);
    const pendingOpen = client.open(bytes);
    refreshControls();
    void pendingOpen.then((settled) => {
      if (mine !== openToken) return;
      switch (settled.status) {
        case 'superseded':
          break;
        case 'ok': {
          const report = settled.value.report;
          const items = toItemViewModels(report);
          abandonRise(); // an exhume started on the previous disk's rows must not land on this one
          preview.clear();
          blobs.revokeAll();
          graveyard.show(report, items);
          session = applyOpened(session, bytes, report, items); // the previous held bytes are dropped here
          openSource = source;
          slot?.setPressed(source);
          if (quiet) {
            // Auto_Open: no announcement, no focus move, no scroll (7.5).
            status.clear();
            const grave = report.files.find((g) => g.path === AUTO_PREVIEW_PATH);
            autoItem = grave === undefined ? null : (items.find((it) => it.id === grave.id) ?? null);
          } else {
            status.set(`Opened a disk with ${items.length} entries.`);
            refreshControls(); // hide Cancel first so the layout above the heading is final before it scrolls
            graveyard.reveal(prefersReducedMotion());
            if (after !== null) openAfter(report.files, items, after);
          }
          break;
        }
        case 'failed':
          status.set(settled.cause === 'invalid-request' ? OPEN_INVALID_MESSAGE : OPEN_FAILED_MESSAGE);
          break;
        case 'lost':
          markLost(settled.reason === 'cancelled' ? CANCELLED_MESSAGE : settled.message);
          break;
      }
      refreshControls();
      if (autoItem !== null) previewQuiet(autoItem, mine);
    });
  }

  /**
   * Auto_Open step 2: exhume without animation, busy state, status text, focus or scroll.
   * The result is applied only while the gate still holds; otherwise the preview stays empty.
   */
  function previewQuiet(item: ItemViewModel, autoOpenToken: number): void {
    if (item.action !== 'exhume') return;
    const exhumeTokenAtStart = exhumeToken;
    void client.exhume(item.id).then((settled) => {
      if (settled.status !== 'ok') return;
      const allowed = mayApplyAutoPreview({
        phase: session.phase,
        intentSeen,
        shownDiskIsAuto: openToken === autoOpenToken,
        exhumeTokenAtStart,
        exhumeTokenNow: exhumeToken,
      });
      if (!allowed) return;
      preview.show(buildPreviewModel(item, { status: 'ok', response: settled.value }));
      graveyard.setCurrent(item.id);
    });
  }

  /** Headstone path: find the file on the freshly shown disk and open it, or say it is missing. */
  function openAfter(files: readonly { id: number; path: string }[], items: ItemViewModel[], path: string): void {
    const grave = files.find((g) => g.path === path);
    const item = grave === undefined ? undefined : items.find((it) => it.id === grave.id);
    if (item === undefined) {
      status.set('That file was not found on this disk.');
      return;
    }
    activate(item, 'headstone');
  }

  // ----- Exhuming a file -----
  function abandonRise(): void {
    exhumeToken++;
    const current = rise;
    rise = null;
    if (current !== null && current.handle !== null) current.handle.cancel();
  }

  function applyGate(token: number, event: RiseEvent): void {
    const current = rise;
    if (current === null || token !== exhumeToken) return;
    const step = stepRise(current.state, event);
    current.state = step.state;
    if (step.stopAnimation && current.handle !== null) current.handle.cancel();
    if (!step.show) return;
    rise = null;
    const outcome = current.outcome;
    if (outcome === null) return;
    preview.show(buildPreviewModel(current.item, outcome));
    graveyard.setCurrent(current.item.id);
    if (outcome.status !== 'lost-disk') status.set(`Opened ${current.item.name}.`);
    // Headstone: always move to the preview. Row: only on a narrow layout, judged now, not at click time.
    if (current.origin === 'headstone' || isNarrow(matchMedia)) preview.reveal(prefersReducedMotion());
    refreshControls();
  }

  function activate(item: ItemViewModel, origin: ActivateOrigin): void {
    if (session.phase !== 'open' || item.action !== 'exhume') return;
    abandonRise();
    const token = exhumeToken;
    const reduced = prefersReducedMotion();
    const target = graveyard.itemElement(item.id) ?? graveyard.headingElement();
    const handle = playRise(target, reduced);
    rise = { state: startRise(reduced), handle, outcome: null, item, origin };
    void handle.finished.then(() => applyGate(token, 'animation-end'));
    status.set(`${RISING_MESSAGE}: ${item.name}`);
    const pendingExhume = client.exhume(item.id);
    refreshControls();
    void pendingExhume.then((settled) => {
      if (token !== exhumeToken || rise === null) return;
      switch (settled.status) {
        case 'superseded':
          break;
        case 'ok':
          rise.outcome = { status: 'ok', response: settled.value };
          applyGate(token, 'result');
          break;
        case 'failed':
          rise.outcome = { status: 'read-failed', error: settled.error };
          applyGate(token, 'error');
          break;
        case 'lost':
          if (settled.reason === 'cancelled') {
            applyGate(token, 'cancel');
            markLost(CANCELLED_MESSAGE);
          } else {
            rise.outcome = { status: 'lost-disk', error: settled.message };
            markLost(settled.message);
            applyGate(token, 'error');
          }
          break;
      }
      refreshControls();
    });
  }

  // ----- Intake, demos, buttons -----
  const onBytes = (bytes: Uint8Array): void => {
    openBytes(bytes);
  };

  const dropZone = byId('drop-zone');
  const pick = byId('pick-button');
  const input = byId('file-input');
  let intakeBytes: ((bytes: Uint8Array, name: string) => boolean) | null = null;
  if (dropZone !== null && pick instanceof HTMLButtonElement && input instanceof HTMLInputElement) {
    // Intake failures are announced and scrolled into view; the status line may be off screen.
    const intakeStatus: StatusRegion = {
      set(text: string): void {
        status.set(text);
        scrollStatusIntoView();
      },
      clear: () => status.clear(),
    };
    const intake = createIntake({ dropZone, picker: pick, input, status: intakeStatus, onBytes });
    intake.attach();
    pick.addEventListener('click', markIntent);
    input.addEventListener('change', markIntent);
    document.addEventListener('drop', markIntent);
    intakeBytes = (bytes, name) => intake.intakeBytes(bytes, name);
    footerPick.addEventListener('click', () => {
      markIntent();
      input.click();
    });
  } else {
    missing.push('drop-zone/pick-button/file-input');
  }

  if (demoMount !== null) {
    slot = createDemoSlot(
      (bytes, demo) => {
        pending.source = demo.id;
        try {
          if (intakeBytes !== null) intakeBytes(bytes, demo.title);
          else onBytes(bytes);
        } finally {
          pending.source = null;
          pending.quiet = false;
        }
      },
      undefined,
      undefined,
      { labelledBy: 'yard-heading', onIntent: markIntent },
    );
    demoMount.appendChild(slot.element);
  }

  // Headstones: open the Writer_Disk if needed, then that file; focus ends on the preview heading.
  bindHeadstones(headstonesRoot, (path) => {
    markIntent();
    if (session.phase === 'open' && openSource === 'writers-disk') {
      const found = session.report?.files.find((g) => g.path === path);
      const item = found === undefined ? undefined : session.items.find((it) => it.id === found.id);
      if (item === undefined) {
        status.set('That file was not found on this disk.');
        return;
      }
      graveyard.reveal(prefersReducedMotion());
      activate(item, 'headstone');
      return;
    }
    if (slot === null) {
      status.set('The demo disk is not available.');
      return;
    }
    pending.after = path;
    void slot.openDemo('writers-disk').then((ok) => {
      // A failed or rejected load must not leak the path into a later open.
      if (!ok || pending.after === path) pending.after = null;
    });
  });

  cancelButton?.addEventListener('click', () => {
    client.cancel();
  });
  reopenButton?.addEventListener('click', () => {
    const bytes = reopenBytes(session);
    if (bytes !== null) openBytes(bytes, openSource);
  });

  refreshControls();
  if (missing.length > 0) status.set(MISSING_ELEMENTS_MESSAGE);

  // ----- Auto_Open: quietly open the Writer_Disk; any user action wins (7.5, 7.7, 7.8, 8.14) -----
  if (slot !== null && slot.has('writers-disk')) {
    const autoSlot = slot;
    const tokenAtStart = openToken;
    let dropped = false;
    void autoSlot
      .openDemo('writers-disk', {
        quiet: true,
        accept: () => {
          const accepted = mayApplyAutoOpen({ phase: session.phase, intentSeen, tokenAtStart, tokenNow: openToken });
          dropped = !accepted;
          pending.quiet = accepted; // consumed by openBytes when the bytes arrive
          return accepted;
        },
      })
      .then((ok) => {
        if (ok || dropped) return;
        // The load itself failed (a dropped result would have called accept). Show the slot's message.
        const text = autoSlot.element.querySelector('.demo-slot-status')?.textContent ?? '';
        status.set(text !== '' ? text : 'The demo disk could not be loaded.');
      });
  }
}
