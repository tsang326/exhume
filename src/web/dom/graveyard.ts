// Graveyard renderer. All nodes come from h(); all text goes in as Text nodes.
import type { DiskReport } from '../../core/fat12/index';
import { hasMore, progressText, visibleCount } from '../logic/paging';
import { summarize, warningLines } from '../logic/viewmodel';
import type { ItemViewModel } from '../logic/viewmodel';
import { clear, h } from './h';

export interface GraveyardView {
  show(report: DiskReport, items: ItemViewModel[]): void;
  showMore(): void;
  setActionsEnabled(enabled: boolean): void;
  itemElement(id: number): HTMLElement | null;
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
  const heading = h('h2', { id: 'graveyard-heading', tabindex: '-1' }, 'Graveyard');
  const summary = h('p', { class: 'graveyard-summary' });
  const message = h('p', { class: 'graveyard-message', hidden: '' });
  const warnings = h('div', { class: 'graveyard-warnings', hidden: '' });
  const list = h('ul', { class: 'graveyard-list', 'aria-labelledby': 'graveyard-heading' });
  const progress = h('p', { class: 'graveyard-progress', hidden: '' });
  const moreButton = h('button', { class: 'graveyard-more', type: 'button', hidden: '' }, 'Show more') as HTMLButtonElement;
  root.appendChild(heading);
  root.appendChild(summary);
  root.appendChild(message);
  root.appendChild(warnings);
  root.appendChild(list);
  root.appendChild(progress);
  root.appendChild(moreButton);

  let current: ItemViewModel[] = [];
  let pages = 0;
  let rendered = 0;
  let enabled = true;
  const byId = new Map<number, HTMLElement>();

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
    clear(list);
    clear(summary);
    clear(message);
    clear(warnings);
    const s = summarize(report);
    summary.appendChild(
      document.createTextNode(`${s.label}: ${s.fileCount} files, ${s.directoryCount} directories`),
    );
    if (s.empty === 'unreadable') {
      message.appendChild(document.createTextNode('This image could not be read as a FAT12 floppy disk.'));
    } else if (s.empty === 'no-files') {
      message.appendChild(document.createTextNode('No files were found on this disk.'));
    }
    setHidden(message, s.empty === null);
    const lines = warningLines(report);
    if (lines.length > 0) {
      warnings.appendChild(
        h(
          'details',
          {},
          h('summary', {}, `Warnings (${lines.length})`),
          h('ul', {}, ...lines.map((line) => h('li', {}, line))),
        ),
      );
    }
    setHidden(warnings, lines.length === 0);
    renderUpTo();
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
    headingElement(): HTMLElement {
      return heading;
    },
  };
}
