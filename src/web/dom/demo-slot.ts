// Demo slot: a labelled group of native buttons, one per valid registry entry.
// Hidden entirely when there are no valid entries. Bytes go to the shared intake pipeline.
import { DEMO_REGISTRY, loadDemoBytes } from '../demos';
import type { DemoDisk, DemoLoad } from '../demos';
import { selectValidDemos } from '../logic/demo-validate';
import { h } from './h';

export interface DemoSlot {
  /** The container to mount. Hidden when there is nothing to show. */
  readonly element: HTMLElement;
  /** Number of valid demo entries shown. */
  readonly count: number;
  /** aria-pressed="true" on the card with this id, "false" on every other. null or unknown id: all "false". */
  setPressed(id: string | null): void;
}

export interface DemoRunDeps {
  load(demo: DemoDisk): Promise<DemoLoad>;
  onBytes(bytes: Uint8Array, demo: DemoDisk): void;
  setBusy(busy: boolean): void;
  setStatus(text: string): void;
}

export const DEMO_LOADING_MESSAGE = 'Loading the demo disk.';

/**
 * Runs one demo load. Disables buttons and shows a loading status first. On failure the message
 * is shown and buttons come back; on success the bytes are handed on and the status is cleared.
 * Never throws.
 */
export async function runDemo(demo: DemoDisk, deps: DemoRunDeps): Promise<void> {
  deps.setBusy(true);
  deps.setStatus(DEMO_LOADING_MESSAGE);
  let result: DemoLoad;
  try {
    result = await deps.load(demo);
  } catch {
    result = { ok: false, reason: 'network', message: 'The demo disk could not be loaded.' };
  }
  deps.setBusy(false);
  if (!result.ok) {
    deps.setStatus(result.message);
    return;
  }
  deps.setStatus('');
  deps.onBytes(result.bytes, demo);
}

export function createDemoSlot(
  onBytes: (bytes: Uint8Array, demo: DemoDisk) => void,
  registry: readonly DemoDisk[] = DEMO_REGISTRY,
  load: (demo: DemoDisk) => Promise<DemoLoad> = (d) => loadDemoBytes(d),
): DemoSlot {
  const demos = selectValidDemos(registry);
  const root = h('section', { class: 'demo-slot', 'aria-labelledby': 'demo-slot-label' });
  if (demos.length === 0) {
    root.setAttribute('hidden', '');
    return { element: root, count: 0, setPressed() {} };
  }

  const label = h('h2', { id: 'demo-slot-label', class: 'demo-slot-label' }, 'Demo disks');
  const status = h('p', { class: 'demo-slot-status', role: 'status' });
  const list = h('div', { class: 'demo-slot-list', role: 'group', 'aria-labelledby': 'demo-slot-label' });
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
    const button = h(
      'button',
      { type: 'button', class: 'demo-slot-button' },
      h('strong', { class: 'demo-slot-title' }, demo.title),
      h('span', { class: 'demo-slot-description' }, demo.description),
    ) as HTMLButtonElement;
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => {
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

  root.appendChild(label);
  root.appendChild(list);
  root.appendChild(status);
  return { element: root, count: demos.length, setPressed };
}
