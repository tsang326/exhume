// Graveyard renderer. All nodes come from h(); all text goes in as Text nodes.
import type { DiskReport } from '../../core/fat12/index';
import { hasMore, progressText, visibleCount } from '../logic/paging';
import { summarize, warningLines } from '../logic/viewmodel';
import type { ItemViewModel } from '../logic/viewmodel';
import { clear, h } from './h';

export interface GraveyardView {
  show(report: DiskReport, items: ItemViewModel[]): void;
  /** Focuses the heading and scrolls it into view. */
  reveal(reducedMotion: boolean): void;
  showMore(): void;
  setActionsEnabled(enabled: boolean): void;
  itemElement(id: number): HTMLElement | null;
  /** The interactive row button for an id, or null for non-interactive or unknown rows. */
  rowButton(id: number): HTMLButtonElement | null;
  /** Marks the open file's row with aria-current="true"; null clears the marker. */
  setCurrent(id: number | null): void;
  headingElement(): HTMLElement;
}

function buildItem(
  item: ItemViewModel,
  onActivate: (item: ItemViewModel, opener: HTMLElement) => void,
  enabled: boolean,
): HTMLElement {
  const inner: HTMLElement[] = [
    h('span', { class: 'grave-art', 'aria-hidden': 'true' }),
    h('span', item.showPath ? { class: 'grave-name', title: item.path } : { class: 'grave-name' }, item.name),
  ];
  if (item.nameHint !== null) inner.push(h('span', { class: 'grave-hint' }, item.nameHint));
  if (item.showPath) inner.push(h('span', { class: 'grave-path' }, item.path));
  inner.push(h('span', { class: 'grave-meta' }, `${item.sizeText} \u00b7 ${item.dateText}`));
  inner.push(h('span', { class: 'grave-state' }, item.stateLabel));
  if (item.reason !== null) inner.push(h('span', { class: 'grave-reason' }, item.reason));
  const markerText = item.marker ?? item.note;
  if (markerText !== null) inner.push(h('span', { class: 'grave-marker' }, markerText));

  let body: HTMLElement;
  if (item.action === 'exhume') {
    body = h('button', { class: 'grave-action', type: 'button' }, ...inner);
    const button = body as HTMLButtonElement;
    button.disabled = !enabled;
    button.addEventListener('click', () => onActivate(item, button));
  } else {
    body = h('div', { class: 'grave-body' }, ...inner);
  }
  return h(
    'li',
    {
      class: `grave grave--${item.state} grave--${item.visual}`,
      'data-grave-id': String(item.id),
    },
    body,
  );
}

export function createGraveyardView(
  root: HTMLElement,
  onActivate: (item: ItemViewModel, opener: HTMLElement) => void,
): GraveyardView {
  const guidance = h('p', { class: 'graveyard-guidance' }, 'Open a disk to see its files.');
  const heading = h(
    'h3',
    {
      id: 'graveyard-heading',
      tabindex: '-1',
      'aria-describedby': 'graveyard-summary',
      hidden: '',
    },
    'Graveyard',
  );
  const summary = h('p', { id: 'graveyard-summary', class: 'graveyard-summary' });
  const progress = h('p', { class: 'graveyard-progress', hidden: '' });
  const stats = h('div', { class: 'graveyard-stats', hidden: '' }, summary, progress);
  const message = h('p', { class: 'graveyard-message', hidden: '' });
  const warnings = h('div', {
    class: 'graveyard-warnings',
    role: 'group',
    'aria-label': 'Warnings',
    hidden: '',
  });
  const list = h('ul', { class: 'graveyard-list', 'aria-labelledby': 'graveyard-heading' });
  const moreButton = h('button', { class: 'graveyard-more', type: 'button', hidden: '' }, 'Show more') as HTMLButtonElement;
  root.appendChild(guidance);
  root.appendChild(heading);
  root.appendChild(stats);
  root.appendChild(message);
  root.appendChild(warnings);
  root.appendChild(list);
  root.appendChild(moreButton);

  let current: ItemViewModel[] = [];
  let pages = 0;
  let rendered = 0;
  let enabled = true;
  let currentId: number | null = null;
  const byId = new Map<number, HTMLElement>();

  function rowButton(id: number): HTMLButtonElement | null {
    const li = byId.get(id);
    if (li === undefined) return null;
    return li.querySelector('button.grave-action') as HTMLButtonElement | null;
  }

  function applyCurrent(): void {
    for (const el of Array.from(list.querySelectorAll('[aria-current]'))) el.removeAttribute('aria-current');
    if (currentId === null) return;
    rowButton(currentId)?.setAttribute('aria-current', 'true');
  }

  function setHidden(el: HTMLElement, hidden: boolean): void {
    if (hidden) el.setAttribute('hidden', '');
    else el.removeAttribute('hidden');
  }

  /** Appends items [rendered, target) and returns the first new li, if any. */
  function renderUpTo(): HTMLElement | null {
    const target = visibleCount(current.length, pages);
    let first: HTMLElement | null = null;
    for (let i = rendered; i < target; i++) {
      const item = current[i];
      if (item === undefined) break;
      const li = buildItem(item, onActivate, enabled);
      byId.set(item.id, li);
      list.appendChild(li);
      if (first === null) first = li;
    }
    rendered = Math.max(rendered, target);
    applyCurrent();
    const total = current.length;
    setHidden(progress, total === 0);
    clear(progress);
    progress.appendChild(document.createTextNode(progressText(rendered, total)));
    setHidden(moreButton, !hasMore(total, pages));
    return first;
  }

  function show(report: DiskReport, items: ItemViewModel[]): void {
    current = items;
    pages = 1;
    rendered = 0;
    byId.clear();
    currentId = null;
    clear(list);
    clear(summary);
    clear(message);
    clear(warnings);
    clear(heading);
    const s = summarize(report);
    heading.appendChild(document.createTextNode(s.label));
    summary.appendChild(
      document.createTextNode(
        `${s.fileCount} files, ${s.directoryCount} directories, ${s.deletedCount} deleted`,
      ),
    );
    if (s.empty === 'unreadable') {
      message.appendChild(document.createTextNode('This image could not be read as a FAT12 floppy disk.'));
    } else if (s.empty === 'no-files') {
      message.appendChild(document.createTextNode('No files were found on this disk.'));
    }
    setHidden(message, s.empty === null);
    const lines = warningLines(report);
    if (lines.length > 0) {
      warnings.appendChild(h('p', { class: 'graveyard-warnings-title' }, `Warnings (${lines.length})`));
      warnings.appendChild(h('ul', {}, ...lines.map((line) => h('li', {}, line))));
    }
    setHidden(warnings, lines.length === 0);
    setHidden(guidance, true);
    setHidden(heading, false);
    setHidden(stats, false);
    renderUpTo();
  }

  function reveal(reducedMotion: boolean): void {
    heading.focus({ preventScroll: true });
    if (typeof heading.scrollIntoView === 'function') {
      heading.scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'start' });
    }
  }

  function showMore(): void {
    if (!hasMore(current.length, pages)) return;
    pages += 1;
    const first = renderUpTo();
    if (first === null) return;
    const control = first.querySelector('button');
    if (control !== null) {
      control.focus();
    } else {
      first.setAttribute('tabindex', '-1');
      first.focus();
    }
  }

  moreButton.addEventListener('click', () => showMore());

  return {
    show,
    reveal,
    showMore,
    setActionsEnabled(value: boolean): void {
      enabled = value;
      for (const button of Array.from(list.querySelectorAll('button.grave-action'))) {
        (button as HTMLButtonElement).disabled = !value;
      }
    },
    itemElement(id: number): HTMLElement | null {
      return byId.get(id) ?? null;
    },
    rowButton,
    setCurrent(id: number | null): void {
      currentId = id;
      applyCurrent();
    },
    headingElement(): HTMLElement {
      return heading;
    },
  };
}
