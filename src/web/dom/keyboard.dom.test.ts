// @vitest-environment happy-dom
// Keyboard behaviour of the graveyard and the preview dialog (Requirements 12.2-12.9, 12.19).
// Wiring mirrors src/web/app.ts: graveyard view -> activate -> preview panel, with fake
// Downloader and a real BlobUrlManager over a fake URL api. No worker and no disk are used.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DiskReport, Grave } from '../../core/fat12/index';
import type { PreviewModel } from '../logic/preview-model';
import { toItemViewModels } from '../logic/viewmodel';
import type { ItemViewModel } from '../logic/viewmodel';
import { createBlobUrlManager } from './blob-urls';
import type { Downloader } from './download';
import { createGraveyardView } from './graveyard';
import type { GraveyardView } from './graveyard';
import { createPreviewPanel } from './preview';
import type { PreviewPanel } from './preview';

function grave(id: number, patch: Partial<Grave> = {}): Grave {
  return {
    id,
    path: `/FILE${id}.TXT`,
    size: 10,
    date: null,
    state: 'alive',
    kind: 'file',
    attributes: { readOnly: false, hidden: false, system: false, archive: false },
    startCluster: 2,
    ...patch,
  };
}

function reportOf(files: Grave[]): DiskReport {
  return {
    volume: { label: 'TEST', geometrySource: 'bpb', geometry: null },
    files,
    warnings: [],
  };
}

function model(title: string): PreviewModel {
  return {
    title,
    partialNote: null,
    error: null,
    warnings: [],
    body: { kind: 'none' },
    downloads: [{ label: 'Download', fileName: 'a.txt', mime: 'application/octet-stream', data: new Uint8Array([1]) }],
  };
}

interface Rig {
  app: HTMLElement;
  root: HTMLElement;
  view: GraveyardView;
  panel: PreviewPanel;
  activations: Array<{ id: number; opener: HTMLElement }>;
  items: ItemViewModel[];
  show(files: Grave[]): void;
}

function buildRig(): Rig {
  document.body.textContent = '';
  const app = document.createElement('div');
  app.id = 'app';
  const root = document.createElement('section');
  root.id = 'graveyard';
  app.appendChild(root);
  document.body.appendChild(app);

  let counter = 0;
  const blobs = createBlobUrlManager({
    create: () => `blob:fake/${counter++}`,
    revoke: () => undefined,
  });
  const downloader: Downloader = { start: () => ({ ok: true }) };
  const activations: Array<{ id: number; opener: HTMLElement }> = [];
  let items: ItemViewModel[] = [];

  const panel = createPreviewPanel({
    blobs,
    downloader,
    background: app,
    fallbackFocus: () => view.headingElement(),
  });
  const view = createGraveyardView(root, (item, opener) => {
    activations.push({ id: item.id, opener });
    panel.open(model(`Preview ${item.id}`), opener); // what app.ts does after the rise
  });
  const rig: Rig = {
    app,
    root,
    view,
    panel,
    activations,
    get items() {
      return items;
    },
    show(files: Grave[]) {
      const report = reportOf(files);
      items = toItemViewModels(report);
      view.show(report, items);
    },
  };
  return rig;
}

/**
 * Presses a key on a button the way a browser does: keydown, then keyup, and the browser
 * turns Enter (on keydown) and Space (on keyup) into a click. If the library already
 * synthesised a click, none is added, so a press yields exactly one click either way.
 */
function press(button: HTMLElement, key: 'Enter' | ' '): void {
  let clicks = 0;
  const count = (): void => {
    clicks += 1;
  };
  button.addEventListener('click', count);
  const down = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
  button.dispatchEvent(down);
  const up = new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true });
  button.dispatchEvent(up);
  button.removeEventListener('click', count);
  if (clicks === 0) button.click();
}

function key(target: Element, k: string, shiftKey = false): KeyboardEvent {
  const e = new KeyboardEvent('keydown', { key: k, shiftKey, bubbles: true, cancelable: true });
  target.dispatchEvent(e);
  return e;
}

function itemButton(rig: Rig, id: number): HTMLButtonElement {
  const li = rig.view.itemElement(id);
  const b = li?.querySelector('button');
  if (!(b instanceof HTMLButtonElement)) throw new Error(`no button for item ${id}`);
  return b;
}

let rig: Rig;
beforeEach(() => {
  rig = buildRig();
});
afterEach(() => {
  document.body.textContent = '';
});

describe('activating a grave (12.2, 12.3, 12.19)', () => {
  beforeEach(() => {
    rig.show([grave(0), grave(1, { state: 'recovered', reason: 'deleted' }), grave(2, { kind: 'directory', path: '/DIR' })]);
  });

  it('renders an activatable grave as a native, focusable button of type=button', () => {
    const b = itemButton(rig, 0);
    expect(b.tagName).toBe('BUTTON');
    expect(b.type).toBe('button');
    expect(b.disabled).toBe(false);
    expect(b.hasAttribute('tabindex')).toBe(false); // natively in the tab order
    b.focus();
    expect(document.activeElement).toBe(b);
  });

  it('click activates once with the item id and the button as opener', () => {
    const b = itemButton(rig, 0);
    b.click();
    expect(rig.activations).toHaveLength(1);
    expect(rig.activations[0]!.id).toBe(0);
    expect(rig.activations[0]!.opener).toBe(b);
  });

  it('Enter and Space each produce exactly one activation, the same as a click', () => {
    // Approximation: happy-dom does not guarantee a click from a key press, so press()
    // dispatches keydown/keyup and adds the click a browser would send if none came.
    const b = itemButton(rig, 1);
    b.click();
    const viaClick = rig.activations[0]!;
    rig.panel.close();

    press(b, 'Enter');
    expect(rig.activations).toHaveLength(2);
    rig.panel.close();

    press(b, ' ');
    expect(rig.activations).toHaveLength(3);

    for (const a of rig.activations) {
      expect(a.id).toBe(viaClick.id);
      expect(a.opener).toBe(viaClick.opener);
    }
  });

  it('does not activate on key events alone for a disabled button', () => {
    rig.view.setActionsEnabled(false);
    const b = itemButton(rig, 0);
    expect(b.disabled).toBe(true);
    b.click();
    expect(rig.activations).toHaveLength(0);
  });

  it('directories and lost items are not tab stops', () => {
    rig.show([grave(0), grave(1, { kind: 'directory', path: '/DIR' }), grave(2, { state: 'lost', reason: 'gone' })]);
    for (const id of [1, 2]) {
      const li = rig.view.itemElement(id)!;
      expect(li.querySelector('button')).toBeNull();
      expect(li.querySelector('[tabindex]')).toBeNull();
      expect(li.hasAttribute('tabindex')).toBe(false);
    }
    expect(rig.root.querySelectorAll('button.grave-action')).toHaveLength(1);
  });
});

describe('Escape and focus return (12.5, 12.6, 12.7)', () => {
  beforeEach(() => {
    rig.show([grave(0), grave(1)]);
  });

  it('opens with focus on the dialog heading and Escape closes it', () => {
    const b = itemButton(rig, 0);
    b.focus();
    press(b, 'Enter');
    expect(rig.panel.isOpen()).toBe(true);
    const heading = document.getElementById('preview-title')!;
    expect(document.activeElement).toBe(heading);
    expect(document.querySelector('[role="dialog"]')?.getAttribute('aria-modal')).toBe('true');
    expect(rig.app.hasAttribute('inert')).toBe(true);

    const e = key(heading, 'Escape');
    expect(e.defaultPrevented).toBe(true);
    expect(rig.panel.isOpen()).toBe(false);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(rig.app.hasAttribute('inert')).toBe(false);
  });

  it('Escape from a control inside the dialog also closes it', () => {
    const b = itemButton(rig, 0);
    press(b, ' ');
    const close = document.querySelector<HTMLElement>('.preview-close')!;
    close.focus();
    key(close, 'Escape');
    expect(rig.panel.isOpen()).toBe(false);
  });

  it('returns focus to the opening item after Escape', () => {
    const b = itemButton(rig, 1);
    b.focus();
    press(b, 'Enter');
    key(document.getElementById('preview-title')!, 'Escape');
    expect(document.activeElement).toBe(b);
  });

  it('returns focus to the opening item after the Close button', () => {
    const b = itemButton(rig, 0);
    press(b, 'Enter');
    document.querySelector<HTMLButtonElement>('.preview-close')!.click();
    expect(document.activeElement).toBe(b);
  });

  it('returns focus to the graveyard heading when the opener is no longer rendered', () => {
    const b = itemButton(rig, 0);
    press(b, 'Enter');
    rig.show([grave(5)]); // list rebuilt: the old opener is detached
    expect(b.isConnected).toBe(false);
    key(document.getElementById('preview-title')!, 'Escape');
    expect(document.activeElement).toBe(rig.view.headingElement());
    expect(rig.view.headingElement().id).toBe('graveyard-heading');
  });
});

describe('focus trap in the dialog (12.8)', () => {
  function dialogParts(): { heading: HTMLElement; close: HTMLElement; download: HTMLElement } {
    return {
      heading: document.getElementById('preview-title')!,
      close: document.querySelector<HTMLElement>('.preview-close')!,
      download: document.querySelector<HTMLElement>('.preview-download')!,
    };
  }

  beforeEach(() => {
    rig.show([grave(0)]);
    press(itemButton(rig, 0), 'Enter');
  });

  it('Tab on the last focusable element wraps to the first', () => {
    const { close, download } = dialogParts();
    // The heading is tabindex=-1, so the tab order is Close, then Download.
    download.focus();
    const e = key(download, 'Tab');
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(close);
  });

  it('Shift+Tab on the first focusable element wraps to the last', () => {
    const { close, download } = dialogParts();
    close.focus();
    const e = key(close, 'Tab', true);
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(download);
  });

  it('Tab and Shift+Tab from the heading land on a control inside the dialog', () => {
    const { heading, close, download } = dialogParts();
    expect(document.activeElement).toBe(heading);
    key(heading, 'Tab');
    expect([close, download]).toContain(document.activeElement);
    heading.focus();
    key(heading, 'Tab', true);
    expect([close, download]).toContain(document.activeElement);
  });

  it('Tab steps between controls inside the dialog without leaving it', () => {
    const { close, download } = dialogParts();
    close.focus();
    key(close, 'Tab'); // the trap handles every Tab itself: Close -> Download
    expect(document.activeElement).toBe(download);
    key(download, 'Tab'); // Download -> wraps to Close
    expect(document.activeElement).toBe(close);
    key(close, 'Tab', true); // Close -> wraps back to Download
    expect(document.activeElement).toBe(download);
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});

describe('Show more focus behaviour (12.2, 12.3)', () => {
  it('moves focus to the first newly rendered item and keeps earlier nodes', () => {
    const files = Array.from({ length: 205 }, (_, i) => grave(i));
    rig.show(files);
    const more = rig.root.querySelector<HTMLButtonElement>('button.graveyard-more')!;
    expect(more.hasAttribute('hidden')).toBe(false);
    expect(rig.root.querySelectorAll('li.grave')).toHaveLength(200);
    const firstOld = rig.view.itemElement(0);

    more.focus();
    press(more, 'Enter');

    expect(rig.root.querySelectorAll('li.grave')).toHaveLength(205);
    expect(rig.view.itemElement(0)).toBe(firstOld);
    expect(document.activeElement).toBe(itemButton(rig, 200));
    expect(more.hasAttribute('hidden')).toBe(true);
  });

  it('focuses the new list item itself when the first new item has no button', () => {
    const files = Array.from({ length: 205 }, (_, i) => (i === 200 ? grave(i, { kind: 'directory', path: '/D' }) : grave(i)));
    rig.show(files);
    rig.view.showMore();
    const li = rig.view.itemElement(200)!;
    expect(document.activeElement).toBe(li);
    expect(li.getAttribute('tabindex')).toBe('-1'); // programmatic focus only, not a tab stop
  });

  it('Show more is a native type=button control', () => {
    rig.show(Array.from({ length: 205 }, (_, i) => grave(i)));
    const more = rig.root.querySelector<HTMLButtonElement>('button.graveyard-more')!;
    expect(more.type).toBe('button');
  });
});
