// App wiring: finds the page elements, builds the modules and runs the session.
// Nothing here reads a disk; the worker client moves messages and this file shows the results.
import { createBlobUrlManager } from './dom/blob-urls';
import { createDemoSlot } from './dom/demo-slot';
import type { DemoSlot } from './dom/demo-slot';
import { createDownloader } from './dom/download';
import { createEffects } from './dom/effects';
import { installGlobalErrorHandlers } from './dom/errors';
import { createGraveyardView } from './dom/graveyard';
import { h } from './dom/h';
import { createIntake } from './dom/intake';
import { createPreviewPanel } from './dom/preview';
import { playRise } from './dom/rising';
import type { RiseHandle } from './dom/rising';
import { createStatusRegion } from './dom/status';
import type { StatusRegion } from './dom/status';
import { createWorkerClient } from './dom/worker-client';
import type { WorkerClient } from './dom/worker-client';
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

function prefersReducedMotion(): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
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

export function startApp(): void {
  const missing: string[] = [];
  const status = findStatus(missing);
  installGlobalErrorHandlers(status);

  let appEl = byId('app');
  if (appEl === null) {
    missing.push('app');
    appEl = h('div', {}); // detached: never inert-ing the body, which holds the preview
  }
  const background: HTMLElement = appEl;
  let graveyardRoot = byId('graveyard');
  if (graveyardRoot === null) {
    missing.push('graveyard');
    graveyardRoot = h('section', { 'aria-label': 'Graveyard' });
    document.body.appendChild(graveyardRoot);
  }
  const cancelButton = byId('cancel-button');
  const reopenButton = byId('reopen-button');
  const fxHost = byId('fx-host');
  if (fxHost === null) missing.push('fx-host');
  const demoMount = byId('demo-slot');
  if (demoMount === null) missing.push('demo-slot');
  if (cancelButton === null) missing.push('cancel-button');
  if (reopenButton === null) missing.push('reopen-button');

  // Session and per-request bookkeeping
  let session: Session = createSession();
  let openToken = 0;
  let exhumeToken = 0;
  let slot: DemoSlot | null = null;
  let pendingSource: string | null = null;
  let rise: { state: RiseState; handle: RiseHandle | null; outcome: ExhumeOutcome | null; item: ItemViewModel; opener: HTMLElement | null } | null = null;

  const blobs = createBlobUrlManager();
  const downloader = createDownloader(blobs);

  let effectsStarted = false;
  if (fxHost !== null) {
    try {
      createEffects(fxHost);
      effectsStarted = true;
    } catch {
      effectsStarted = false; // decoration only
    }
  }
  void effectsStarted;

  const preview = createPreviewPanel({
    blobs,
    downloader,
    background,
    fallbackFocus: () => graveyard.headingElement(),
  });

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

  const graveyard = createGraveyardView(graveyardRoot, (item, opener) => activate(item, opener));

  function markLost(message: string): void {
    session = applyLost(session);
    status.set(message);
    refreshControls();
  }

  // ----- Opening a disk -----
  function openBytes(bytes: Uint8Array): void {
    const source = pendingSource; // set only while a demo card's bytes are handed in synchronously
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
          const previewWasOpen = preview.isOpen();
          preview.close();
          blobs.revokeAll();
          graveyard.show(report, items);
          session = applyOpened(session, bytes, report, items); // the previous held bytes are dropped here
          slot?.setPressed(source);
          status.set(`Opened a disk with ${items.length} entries.`);
          refreshControls(); // hide Cancel first so the layout above the heading is final before it scrolls
          if (!previewWasOpen) graveyard.reveal(prefersReducedMotion());
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
    });
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
    if (outcome.status !== 'lost-disk') status.clear();
    preview.open(buildPreviewModel(current.item, outcome), current.opener);
    refreshControls();
  }

  function activate(item: ItemViewModel, opener: HTMLElement): void {
    if (session.phase !== 'open' || item.action !== 'exhume') return;
    abandonRise();
    const token = exhumeToken;
    const reduced = prefersReducedMotion();
    const target = graveyard.itemElement(item.id) ?? opener;
    const handle = playRise(target, reduced);
    rise = { state: startRise(reduced), handle, outcome: null, item, opener };
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
    const intake = createIntake({ dropZone, picker: pick, input, status, onBytes });
    intake.attach();
    intakeBytes = (bytes, name) => intake.intakeBytes(bytes, name);
  } else {
    missing.push('drop-zone/pick-button/file-input');
  }

  if (demoMount !== null) {
    slot = createDemoSlot((bytes, demo) => {
      pendingSource = demo.id;
      try {
        if (intakeBytes !== null) intakeBytes(bytes, demo.title);
        else onBytes(bytes);
      } finally {
        pendingSource = null;
      }
    });
    demoMount.appendChild(slot.element);
  }

  cancelButton?.addEventListener('click', () => {
    client.cancel();
  });
  reopenButton?.addEventListener('click', () => {
    const bytes = reopenBytes(session);
    if (bytes !== null) openBytes(bytes);
  });

  refreshControls();
  if (missing.length > 0) status.set(MISSING_ELEMENTS_MESSAGE);
}
