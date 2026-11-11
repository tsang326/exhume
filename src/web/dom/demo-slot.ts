// Demo slot: a labelled group of native buttons, one per valid registry entry.
// Hidden entirely when there are no valid entries. Bytes go to the shared intake pipeline.
import { DEMO_REGISTRY, loadDemoBytes } from '../demos';
import type { DemoDisk, DemoLoad } from '../demos';
import { selectValidDemos } from '../logic/demo-validate';
import { h } from './h';
import { demoArt } from './svg-art';

export interface DemoSlot {
  /** The container to mount. Hidden when there is nothing to show. */
  readonly element: HTMLElement;
  /** Number of valid demo entries shown. */
  readonly count: number;
  /** aria-pressed="true" on the card with this id, "false" on every other. null or unknown id: all "false". */
  setPressed(id: string | null): void;
  /**
   * Runs the same load path as a click. Resolves true when bytes were handed on, false on failure,
   * on a rejected `accept`, or for an unknown id. Never throws.
   */
  openDemo(id: string, opts?: { quiet?: boolean; accept?: () => boolean }): Promise<boolean>;
  /** True when a valid entry with this id is shown. */
  has(id: string): boolean;
}

export interface DemoSlotOptions {
  /** Id of the page heading that labels the card group. Without it the slot renders its own heading. */
  labelledBy?: string;
  /** Called synchronously on a card click, before the load starts. */
  onIntent?: () => void;
}

export interface DemoRunDeps {
  load(demo: DemoDisk): Promise<DemoLoad>;
  onBytes(bytes: Uint8Array, demo: DemoDisk): void;
  setBusy(busy: boolean): void;
  setStatus(text: string): void;
  /** No busy state and no loading text. A failure still goes to the status line. */
  quiet?: boolean;
  /** Checked after the load and before `onBytes`. False drops the result. */
  accept?: () => boolean;
}

export const DEMO_LOADING_MESSAGE = 'Loading the demo disk.';

/**
 * Runs one demo load. Disables buttons and shows a loading status first. On failure the message
 * is shown and buttons come back; on success the bytes are handed on and the status is cleared.
 * Never throws.
 * Resolves true when the bytes were handed on.
 */
export async function runDemo(demo: DemoDisk, deps: DemoRunDeps): Promise<boolean> {
  const quiet = deps.quiet === true;
  if (!quiet) {
    deps.setBusy(true);
    deps.setStatus(DEMO_LOADING_MESSAGE);
  }
  let result: DemoLoad;
  try {
    result = await deps.load(demo);
  } catch {
    result = { ok: false, reason: 'network', message: 'The demo disk could not be loaded.' };
  }
  if (!quiet) deps.setBusy(false);
  if (!result.ok) {
    deps.setStatus(result.message);
    return false;
  }
  if (deps.accept !== undefined && !deps.accept()) {
    if (!quiet) deps.setStatus('');
    return false;
  }
  if (!quiet) deps.setStatus('');
  deps.onBytes(result.bytes, demo);
  return true;
}

export function createDemoSlot(
  onBytes: (bytes: Uint8Array, demo: DemoDisk) => void,
  registry: readonly DemoDisk[] = DEMO_REGISTRY,
  load: (demo: DemoDisk) => Promise<DemoLoad> = (d) => loadDemoBytes(d),
  options: DemoSlotOptions = {},
): DemoSlot {
  const demos = selectValidDemos(registry);
  const ownHeading = options.labelledBy === undefined;
  const labelId = options.labelledBy ?? 'demo-slot-label';
  const root = h('section', { class: 'demo-slot', 'aria-labelledby': labelId });
  if (demos.length === 0) {
    root.setAttribute('hidden', '');
    return {
      element: root,
      count: 0,
      setPressed() {},
      openDemo: () => Promise.resolve(false),
      has: () => false,
    };
  }

  const label = ownHeading ? h('h2', { id: labelId, class: 'demo-slot-label' }, 'Demo disks') : null;
  const status = h('p', { class: 'demo-slot-status', role: 'status' });
  const list = h('div', { class: 'demo-slot-list', role: 'group', 'aria-labelledby': labelId });
  const buttons: HTMLButtonElement[] = [];
  const ids: string[] = [];

  const deps: DemoRunDeps = {
    load,
    onBytes,
    setBusy(busy) {
      for (const b of buttons) {
        if (busy) b.setAttribute('disabled', '');
        else b.removeAttribute('disabled');
      }
      if (busy) root.setAttribute('aria-busy', 'true');
      else root.removeAttribute('aria-busy');
    },
    setStatus(text) {
      status.textContent = text;
    },
  };

  for (const demo of demos) {
    const art = demoArt(demo.id);
    const button = h(
      'button',
      { type: 'button', class: 'demo-slot-button' },
      ...(art === null ? [] : [h('span', { class: 'demo-art', 'aria-hidden': 'true' }, art)]),
      h('strong', { class: 'demo-slot-title' }, demo.title),
      h('span', { class: 'demo-slot-description' }, demo.description),
    ) as HTMLButtonElement;
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => {
      options.onIntent?.();
      void runDemo(demo, deps);
    });
    buttons.push(button);
    ids.push(demo.id);
    list.appendChild(button);
  }

  const setPressed = (id: string | null): void => {
    buttons.forEach((b, i) => {
      b.setAttribute('aria-pressed', id !== null && ids[i] === id ? 'true' : 'false');
    });
  };

  const openDemo = (
    id: string,
    opts: { quiet?: boolean; accept?: () => boolean } = {},
  ): Promise<boolean> => {
    const demo = demos.find((d) => d.id === id);
    if (demo === undefined) return Promise.resolve(false);
    return runDemo(demo, { ...deps, quiet: opts.quiet === true, accept: opts.accept });
  };

  if (label !== null) root.appendChild(label);
  root.appendChild(list);
  root.appendChild(status);
  return { element: root, count: demos.length, setPressed, openDemo, has: (id) => ids.includes(id) };
}
