// @vitest-environment happy-dom
import fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiskReport, Grave, GraveKind, GraveState } from '../../core/fat12/index';
import { toItemViewModels } from '../logic/viewmodel';
import type { ItemViewModel } from '../logic/viewmodel';
import { createGraveyardView } from './graveyard';

const ALLOWED_ATTRS = new Set([
  'class',
  'id',
  'type',
  'hidden',
  'tabindex',
  'disabled',
  'open',
  'title',
  'aria-hidden',
  'aria-labelledby',
]);

function grave(id: number, over: Partial<Grave> = {}): Grave {
  const state: GraveState = over.state ?? 'alive';
  return {
    id,
    path: `/FILE${id}.TXT`,
    size: 100,
    date: '1999-12-31T23:59:58',
    state,
    kind: 'file' as GraveKind,
    ...(state === 'alive' ? {} : { reason: 'chain was cut' }),
    attributes: { readOnly: false, hidden: false, system: false, archive: true },
    startCluster: 2,
    ...over,
  };
}

function report(files: Grave[], over: Partial<DiskReport> = {}): DiskReport {
  return {
    volume: { label: 'DISK', geometrySource: 'bpb', geometry: null },
    files,
    warnings: [],
    ...over,
  };
}

let root: HTMLElement;
let onActivate: ReturnType<typeof vi.fn>;

function setup(files: Grave[], over: Partial<DiskReport> = {}) {
  const rep = report(files, over);
  const view = createGraveyardView(root, onActivate as unknown as (i: ItemViewModel, o: HTMLElement) => void);
  view.show(rep, toItemViewModels(rep));
  return view;
}

const items = () => Array.from(root.querySelectorAll('li.grave'));
const progress = () => root.querySelector('.graveyard-progress') as HTMLElement;
const more = () => root.querySelector('.graveyard-more') as HTMLButtonElement;
const message = () => root.querySelector('.graveyard-message') as HTMLElement;

beforeEach(() => {
  document.body.textContent = '';
  root = document.createElement('div');
  document.body.appendChild(root);
  onActivate = vi.fn();
});

describe('graveyard rendering', () => {
  it('renders tombstone for alive and open grave for others, with state and reason text', () => {
    setup([
      grave(0, { state: 'alive' }),
      grave(1, { state: 'recovered', reason: 'found by chain walk' }),
      grave(2, { state: 'partial', reason: 'tail missing' }),
    ]);
    const li = items();
    expect(li[0]?.classList.contains('grave--tombstone')).toBe(true);
    expect(li[0]?.querySelector('.grave-state')?.textContent).toBe('alive');
    expect(li[0]?.querySelector('.grave-reason')).toBeNull();
    expect(li[1]?.classList.contains('grave--open-grave')).toBe(true);
    expect(li[1]?.querySelector('.grave-state')?.textContent).toBe('recovered');
    expect(li[1]?.querySelector('.grave-reason')?.textContent).toBe('found by chain walk');
    expect(li[2]?.querySelector('.grave-state')?.textContent).toBe('partial');
    expect(li[2]?.querySelector('.grave-reason')?.textContent).toBe('tail missing');
  });

  it('directories are marked and not focusable; lost entries have no button', () => {
    setup([
      grave(0, { kind: 'directory', path: '/DOCS', size: 0 }),
      grave(1, { state: 'lost', reason: 'no data left' }),
      grave(2),
    ]);
    const li = items();
    expect(li[0]?.querySelector('button')).toBeNull();
    expect(li[0]?.querySelector('[tabindex]')).toBeNull();
    expect(li[0]?.querySelector('.grave-marker')?.textContent).toBe('directory');
    expect(li[1]?.querySelector('button')).toBeNull();
    expect(li[1]?.querySelector('[tabindex]')).toBeNull();
    expect(li[1]?.querySelector('.grave-marker')?.textContent).toBe('not previewable');
    expect(li[2]?.querySelector('button')).not.toBeNull();
  });

  it('shows the path only for nested entries', () => {
    setup([grave(0), grave(1, { path: '/A/B/NOTE.TXT' })]);
    const li = items();
    expect(li[0]?.querySelector('.grave-path')).toBeNull();
    expect(li[1]?.querySelector('.grave-path')?.textContent).toBe('/A/B/NOTE.TXT');
    expect(li[1]?.querySelector('.grave-name')?.textContent).toBe('NOTE.TXT');
  });

  it('keeps hostile names, paths, labels and reasons as text only', () => {
    const hostile = [
      '<img src=x onerror=1>',
      '</li><script>alert(1)</script>',
      '"><svg onload=1>',
    ];
    const files = hostile.map((m, i) =>
      grave(i, { path: `/${m}/${m}`, state: 'partial', reason: m }),
    );
    setup(files, {
      volume: { label: hostile[0] as string, geometrySource: 'bpb', geometry: null },
      warnings: [{ code: 'chain-short', message: 'short chain', path: hostile[1] as string }],
    });
    expectOnlyAllowedMarkup(root, 3);
    expect(root.querySelector('img, script, svg')).toBeNull();
    expect(root.textContent).toContain('<img src=x onerror=1>');
    expect(root.querySelector('.graveyard-summary')?.textContent).toContain('<img src=x onerror=1>');
  });

  it('property: arbitrary text never adds elements or attributes', () => {
    const text = fc.oneof(
      fc.string({ minLength: 1, maxLength: 80 }),
      fc.constantFrom('<b>x</b>', '<img src=x onerror=1>', '</li><script>', '" onclick="1', '&lt;&amp;'),
    );
    fc.assert(
      fc.property(fc.array(fc.tuple(text, text), { minLength: 1, maxLength: 6 }), (pairs) => {
        document.body.textContent = '';
        root = document.createElement('div');
        document.body.appendChild(root);
        const files = pairs.map(([p, r], i) => grave(i, { path: `/${p}`, state: 'lost', reason: r.slice(0, 200) || 'x' }));
        setup(files);
        expectOnlyAllowedMarkup(root, files.length);
      }),
      { numRuns: 25 },
    );
  });
});

function expectOnlyAllowedMarkup(container: HTMLElement, expectedItems: number): void {
  expect(container.querySelectorAll('li.grave').length).toBe(expectedItems);
  const tags = new Set(Array.from(container.querySelectorAll('*')).map((e) => e.tagName.toLowerCase()));
  for (const t of tags) expect(['div', 'h2', 'p', 'ul', 'li', 'span', 'button', 'details', 'summary']).toContain(t);
  for (const el of Array.from(container.querySelectorAll('*'))) {
    for (const attr of Array.from(el.attributes)) {
      const ok = ALLOWED_ATTRS.has(attr.name) || /^data-[a-z0-9-]+$/.test(attr.name);
      expect(ok, `attribute ${attr.name} on ${el.tagName}`).toBe(true);
      expect(attr.name.startsWith('on')).toBe(false);
    }
  }
}

describe('paging', () => {
  it('renders 200 per page, shows "X of Y", and hides Show more at the end', () => {
    const view = setup(Array.from({ length: 450 }, (_, i) => grave(i)));
    expect(items().length).toBe(200);
    expect(progress().textContent).toBe('200 of 450');
    expect(more().hasAttribute('hidden')).toBe(false);
    view.showMore();
    expect(items().length).toBe(400);
    expect(progress().textContent).toBe('400 of 450');
    more().click();
    expect(items().length).toBe(450);
    expect(progress().textContent).toBe('450 of 450');
    expect(more().hasAttribute('hidden')).toBe(true);
  });

  it('hides Show more when everything fits on one page', () => {
    setup([grave(0), grave(1)]);
    expect(progress().textContent).toBe('2 of 2');
    expect(more().hasAttribute('hidden')).toBe(true);
  });

  it('keeps earlier nodes and moves focus to the first new item on Show more', () => {
    const view = setup(Array.from({ length: 250 }, (_, i) => grave(i)));
    const before = items()[0];
    view.showMore();
    expect(items()[0]).toBe(before);
    const first = items()[200] as HTMLElement;
    expect(document.activeElement).toBe(first.querySelector('button'));
  });

  it('focuses the new li itself when the first new item has no button', () => {
    const files = Array.from({ length: 250 }, (_, i) => grave(i, i === 200 ? { state: 'lost', reason: 'gone' } : {}));
    const view = setup(files);
    view.showMore();
    const first = items()[200] as HTMLElement;
    expect(first.querySelector('button')).toBeNull();
    expect(document.activeElement).toBe(first);
  });

  it('reaches 4096 entries in 21 pages and never renders more than 4096', () => {
    const view = setup(Array.from({ length: 4096 }, (_, i) => grave(i, { path: `/F${i}` })));
    let pages = 1;
    while (!more().hasAttribute('hidden')) {
      view.showMore();
      pages++;
      if (pages > 30) break;
    }
    expect(pages).toBe(21);
    expect(items().length).toBe(4096);
    expect(progress().textContent).toBe('4096 of 4096');
    view.showMore();
    expect(items().length).toBe(4096);
  });

  it('resets to the first page on a new show()', () => {
    const view = setup(Array.from({ length: 450 }, (_, i) => grave(i)));
    view.showMore();
    const rep = report(Array.from({ length: 300 }, (_, i) => grave(i)));
    view.show(rep, toItemViewModels(rep));
    expect(items().length).toBe(200);
    expect(progress().textContent).toBe('200 of 300');
    expect(more().hasAttribute('hidden')).toBe(false);
    expect(view.itemElement(250)).toBeNull();
    expect(view.itemElement(5)).toBe(items()[5]);
  });
});

describe('messages and warnings', () => {
  it('shows the empty-disk message', () => {
    setup([]);
    expect(message().hasAttribute('hidden')).toBe(false);
    expect(message().textContent).toBe('No files were found on this disk.');
    expect(progress().hasAttribute('hidden')).toBe(true);
  });

  it('shows the unreadable-disk message', () => {
    setup([], { volume: { label: '', geometrySource: 'none', geometry: null } });
    expect(message().hasAttribute('hidden')).toBe(false);
    expect(message().textContent).toBe('This image could not be read as a FAT12 floppy disk.');
  });

  it('hides the message when files exist', () => {
    setup([grave(0)]);
    expect(message().hasAttribute('hidden')).toBe(true);
    expect(message().textContent).toBe('');
  });

  it('puts warnings in a collapsed details element', () => {
    setup([grave(0)], {
      warnings: [
        { code: 'chain-short', message: 'Chain is short', path: '/A.TXT' },
        { code: 'fat-copies-differ', message: 'FAT copies differ' },
      ],
    });
    const details = root.querySelector('.graveyard-warnings details') as HTMLDetailsElement;
    expect(details).not.toBeNull();
    expect(details.hasAttribute('open')).toBe(false);
    expect(details.querySelector('summary')?.textContent).toBe('Warnings (2)');
    const lines = Array.from(details.querySelectorAll('li')).map((l) => l.textContent);
    expect(lines).toEqual(['Chain is short (/A.TXT)', 'FAT copies differ']);
    expect(root.querySelector('.graveyard-warnings')?.hasAttribute('hidden')).toBe(false);
  });

  it('hides the warnings area when there are none', () => {
    setup([grave(0)]);
    expect(root.querySelector('.graveyard-warnings')?.hasAttribute('hidden')).toBe(true);
    expect(root.querySelector('details')).toBeNull();
  });
});

describe('actions', () => {
  it('setActionsEnabled toggles disabled on item buttons, including later pages', () => {
    const view = setup(Array.from({ length: 250 }, (_, i) => grave(i)));
    const buttons = () => Array.from(root.querySelectorAll('button.grave-action')) as HTMLButtonElement[];
    expect(buttons().every((b) => !b.disabled)).toBe(true);
    view.setActionsEnabled(false);
    expect(buttons().every((b) => b.disabled)).toBe(true);
    view.showMore();
    expect(buttons().length).toBe(250);
    expect(buttons().every((b) => b.disabled)).toBe(true);
    expect(more().disabled).toBe(false);
    view.setActionsEnabled(true);
    expect(buttons().every((b) => !b.disabled)).toBe(true);
  });

  it('calls onActivate with the item and the clicked button for exhumable items only', () => {
    setup([grave(0, { kind: 'directory', path: '/D', size: 0 }), grave(1, { state: 'lost', reason: 'gone' }), grave(2)]);
    const li = items();
    (li[0] as HTMLElement).click();
    (li[1] as HTMLElement).click();
    expect(onActivate).not.toHaveBeenCalled();
    const button = li[2]?.querySelector('button') as HTMLButtonElement;
    button.click();
    expect(onActivate).toHaveBeenCalledTimes(1);
    const [item, opener] = onActivate.mock.calls[0] as [ItemViewModel, HTMLElement];
    expect(item.id).toBe(2);
    expect(opener).toBe(button);
  });

  it('exposes item elements and the heading', () => {
    const view = setup([grave(0)]);
    expect(view.itemElement(0)).toBe(items()[0]);
    expect(view.itemElement(9)).toBeNull();
    expect(view.headingElement().id).toBe('graveyard-heading');
  });
});
