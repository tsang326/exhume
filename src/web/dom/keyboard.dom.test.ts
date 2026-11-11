// @vitest-environment happy-dom
// Keyboard behaviour of the graveyard and the inline preview panel (Requirements 8.13, 8.17, 8.18, 8.19, 13.3).
// Wiring mirrors the activation step of src/web/app.ts: graveyard view -> activate(item, origin) -> preview panel,
// with a fake Downloader and a real BlobUrlManager over a fake URL api. No worker and no disk are used.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DiskReport, Grave } from '../../core/fat12/index';
import type { PreviewModel } from '../logic/preview-model';
import { toItemViewModels } from '../logic/viewmodel';
import type { ItemViewModel } from '../logic/viewmodel';
import { createBlobUrlManager } from './blob-urls';
import type { Downloader } from './download';
import { createGraveyardView } from './graveyard';
import type { GraveyardView } from './graveyard';
import { bindHeadstones } from './headstones';
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
    kindLabel: 'Plain text',
    partialNote: null,
    error: null,
    warnings: [],
    body: { kind: 'none' },
    downloads: [{ label: 'Download', fileName: 'a.txt', mime: 'application/octet-stream', data: new Uint8Array([1]) }],
  };
}

type Origin = 'row' | 'headstone';

interface Rig {
  app: HTMLElement;
  root: HTMLElement;
  previewRoot: HTMLElement;
  stones: HTMLElement;
  view: GraveyardView;
  panel: PreviewPanel;
  activations: Array<{ id: number; origin: Origin; opener: HTMLElement | null }>;
  items: ItemViewModel[];
  /** The layout the activation step sees; app.ts judges it at the moment the preview is shown. */
  narrow: boolean;
  show(files: Grave[]): void;
}

function buildRig(): Rig {
  document.body.textContent = '';
  const app = document.createElement('div');
  app.id = 'app';
  const stones = document.createElement('div');
  stones.id = 'headstones';
  const root = document.createElement('section');
  root.id = 'graveyard';
  const previewRoot = document.createElement('section');
  previewRoot.id = 'preview';
  app.append(stones, root, previewRoot);
  document.body.appendChild(app);

  let counter = 0;
  const blobs = createBlobUrlManager({
    create: () => `blob:fake/${counter++}`,
    revoke: () => undefined,
  });
  const downloader: Downloader = { start: () => ({ ok: true }) };
  const activations: Array<{ id: number; origin: Origin; opener: HTMLElement | null }> = [];
  let items: ItemViewModel[] = [];

  const panel = createPreviewPanel(previewRoot, { blobs, downloader });

  // Mirrors app.ts: show, mark the row, then move to the preview for a headstone, or for a row only when narrow.
  const rig: Rig = {
    app,
    root,
    previewRoot,
    stones,
    get view() {
      return view;
    },
    panel,
    activations,
    get items() {
      return items;
    },
    narrow: false,
    show(files: Grave[]) {
      const report = reportOf(files);
      items = toItemViewModels(report);
      view.show(report, items);
    },
  } as Rig;
  function activate(item: ItemViewModel, origin: Origin, opener: HTMLElement | null): void {
    activations.push({ id: item.id, origin, opener });
    panel.show(model(`Preview ${item.id}`));
    view.setCurrent(item.id);
    if (origin === 'headstone' || rig.narrow) panel.reveal(true);
  }
  const view = createGraveyardView(root, (item, opener) => activate(item, 'row', opener));

  stones.appendChild(stone('/FILE0.TXT'));
  stones.appendChild(stone('/FILE1.TXT'));
  bindHeadstones(stones, (path) => {
    const g = items.find((it) => it.path === path);
    if (g !== undefined) activate(g, 'headstone', null);
  });
  return rig;
}

function stone(path: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'hs';
  b.setAttribute('data-path', path);
  b.textContent = path;
  return b;
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

describe('activating a grave (8.13, 13.3)', () => {
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
    rig.panel.clear();

    press(b, 'Enter');
    expect(rig.activations).toHaveLength(2);
    rig.panel.clear();

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

describe('no focus trap (13.3, 8.12)', () => {
  beforeEach(() => {
    rig.show([grave(0), grave(1)]);
    press(itemButton(rig, 0), 'Enter');
  });

  it('the panel is not a dialog and does not inert or hide the rest of the page', () => {
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector('[aria-modal]')).toBeNull();
    expect(document.querySelector('[inert]')).toBeNull();
  });

  it('Tab from the last panel control is left to the browser, not handled or prevented', () => {
    const download = rig.previewRoot.querySelector<HTMLElement>('.preview-download')!;
    download.focus();
    const e = key(download, 'Tab');
    expect(e.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(download); // the script moved nothing
  });

  it('Shift+Tab from the first panel control is left to the browser too', () => {
    const download = rig.previewRoot.querySelector<HTMLElement>('.preview-download')!;
    download.focus();
    expect(key(download, 'Tab', true).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(download);
  });

  it('Escape does nothing: the preview stays and focus stays where it was', () => {
    const b = itemButton(rig, 0);
    b.focus();
    const e = key(b, 'Escape');
    expect(e.defaultPrevented).toBe(false);
    expect(rig.panel.isShowing()).toBe(true);
    expect(document.activeElement).toBe(b);
  });

  it('the preview controls come after the grave rows in document order, so Tab leaves the list into the panel and on', () => {
    const rows = itemButton(rig, 1);
    const download = rig.previewRoot.querySelector<HTMLElement>('.preview-download')!;
    expect(rows.compareDocumentPosition(download) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});

describe('focus after opening a file (8.17, 8.18, 8.19)', () => {
  beforeEach(() => {
    rig.show([grave(0), grave(1)]);
  });

  it('wide: Enter on a row keeps focus on that row and marks it current', () => {
    rig.narrow = false;
    const b = itemButton(rig, 1);
    b.focus();
    press(b, 'Enter');
    expect(rig.panel.isShowing()).toBe(true);
    expect(rig.panel.headingElement().textContent).toBe('Preview 1');
    expect(document.activeElement).toBe(b);
    expect(b.getAttribute('aria-current')).toBe('true');
  });

  it('wide: Space on a row behaves the same', () => {
    const b = itemButton(rig, 0);
    b.focus();
    press(b, ' ');
    expect(document.activeElement).toBe(b);
  });

  it('narrow: Enter on a row moves focus to the preview heading', () => {
    rig.narrow = true;
    const b = itemButton(rig, 1);
    b.focus();
    press(b, 'Enter');
    expect(document.activeElement).toBe(rig.panel.headingElement());
    expect(document.activeElement?.id).toBe('preview-title');
    expect(b.getAttribute('aria-current')).toBe('true');
  });

  it.each([false, true])('Enter on a headstone always moves focus to the preview heading (narrow=%s)', (narrow) => {
    rig.narrow = narrow;
    const stoneButton = rig.stones.querySelector<HTMLButtonElement>('button.hs[data-path="/FILE1.TXT"]')!;
    stoneButton.focus();
    press(stoneButton, 'Enter');
    expect(rig.activations.at(-1)).toMatchObject({ id: 1, origin: 'headstone' });
    expect(document.activeElement).toBe(rig.panel.headingElement());
    expect(document.activeElement?.id).toBe('preview-title');
  });
});

describe('tab order with the revealed heading (13.3)', () => {
  /** Elements a Tab key can reach, in document order: enabled buttons, links with href, tabindex >= 0. */
  function tabbable(): HTMLElement[] {
    const all = Array.from(document.querySelectorAll<HTMLElement>('button, a[href], input, [tabindex]'));
    return all.filter((el) => {
      if (el.closest('[hidden]') !== null) return false;
      if ((el as HTMLButtonElement).disabled === true) return false;
      const t = el.getAttribute('tabindex');
      return t === null || Number(t) >= 0;
    });
  }

  it('keeps both headings out of the tab order; headstones, rows, panel controls, then the footer link', () => {
    const footer = document.createElement('footer');
    const link = document.createElement('a');
    link.id = 'repo-link';
    link.setAttribute('href', 'https://example.invalid/exhume');
    footer.appendChild(link);
    rig.app.appendChild(footer);

    rig.show([grave(0), grave(1), grave(2, { kind: 'directory', path: '/DIR' })]);
    rig.view.reveal(false);
    expect(document.activeElement).toBe(rig.view.headingElement());
    rig.panel.show(model('Preview 0'));

    const order = tabbable();
    expect(order).not.toContain(rig.view.headingElement());
    expect(order).not.toContain(rig.panel.headingElement());
    const stoneButtons = Array.from(rig.stones.querySelectorAll<HTMLElement>('button.hs'));
    const download = rig.previewRoot.querySelector<HTMLElement>('.preview-download')!;
    // Scrollable text regions (tabindex=0) are absent for body kind 'none'.
    expect(order).toEqual([...stoneButtons, itemButton(rig, 0), itemButton(rig, 1), download, link]);
  });
});

describe('Show more focus behaviour (8.13, 13.3)', () => {
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
