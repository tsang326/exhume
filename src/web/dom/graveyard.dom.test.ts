// @vitest-environment happy-dom
import fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiskReport, Grave, GraveKind, GraveState } from '../../core/fat12/index';
import { numRuns } from '../../test-support/runs';
import { visibleCount } from '../logic/paging';
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
  'aria-describedby',
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

describe('guidance until a disk is shown', () => {
  // Feature: ui-polish, Property 1: Guidance until a disk is shown
  it('property: fresh view shows guidance only; show hides it and a second show keeps that', () => {
    const states = fc.constantFrom<GraveState>('alive', 'recovered', 'partial', 'lost');
    const filesArb = fc.array(states, { maxLength: 250 }).map((ss) => ss.map((s, i) => grave(i, { state: s })));
    const geometrySource = fc.constantFrom<'bpb' | 'none'>('bpb', 'none');
    fc.assert(
      fc.property(filesArb, geometrySource, filesArb, (files, source, files2) => {
        document.body.textContent = '';
        root = document.createElement('div');
        document.body.appendChild(root);
        const view = createGraveyardView(root, () => undefined);
        const hidden = (sel: string) => (root.querySelector(sel) as HTMLElement).hasAttribute('hidden');

        const fresh =
          !hidden('.graveyard-guidance') &&
          hidden('#graveyard-heading') &&
          hidden('.graveyard-stats') &&
          hidden('.graveyard-more');

        const rep = report(files, { volume: { label: 'DISK', geometrySource: source, geometry: null } });
        view.show(rep, toItemViewModels(rep));
        const afterFirst = hidden('.graveyard-guidance') && !hidden('#graveyard-heading');

        const rep2 = report(files2);
        view.show(rep2, toItemViewModels(rep2));
        const afterSecond = hidden('.graveyard-guidance') && !hidden('#graveyard-heading');

        return fresh && afterFirst && afterSecond;
      }),
      { numRuns: numRuns(25) },
    );
  });
});

describe('state text and safe text rendering', () => {
  // Feature: ui-polish, Property 2: Every item shows its state as text with a state class, and disk text stays text
  // **Validates: Requirements 7.2, 7.3, 7.8**
  it('property: each item shows its state word, state class and vm name; only expected elements', () => {
    const EXPECTED_TAGS = new Set(['div', 'h2', 'p', 'ul', 'li', 'span', 'button', 'details', 'summary']);
    const nasty = fc.oneof(
      fc.string({ minLength: 1, maxLength: 40 }),
      fc.constantFrom('<', '>', '&', '"', "'", '<b>x</b>', '&amp;', '<img src=x onerror=1>', '" onclick="1'),
      fc
        .array(fc.constantFrom('<', '>', '&', '"', "'", 'a', '_', '.'), { minLength: 1, maxLength: 12 })
        .map((a) => a.join('')),
    );
    const states = fc.constantFrom<GraveState>('alive', 'recovered', 'partial', 'lost');
    const entry = fc.record({ state: states, path: nasty, reason: nasty });
    fc.assert(
      fc.property(fc.array(entry, { minLength: 1, maxLength: 12 }), (entries) => {
        document.body.textContent = '';
        root = document.createElement('div');
        document.body.appendChild(root);
        const files = entries.map((e, i) =>
          grave(i, {
            state: e.state,
            path: `/${e.path}`,
            ...(e.state === 'alive' ? {} : { reason: e.reason.slice(0, 200) }),
          }),
        );
        const rep = report(files);
        const vms = toItemViewModels(rep);
        const view = createGraveyardView(root, () => undefined);
        view.show(rep, vms);

        const lis = Array.from(root.querySelectorAll('li.grave'));
        if (lis.length !== vms.length) return false;
        for (let i = 0; i < lis.length; i++) {
          const li = lis[i] as HTMLElement;
          const vm = vms[i] as ItemViewModel;
          const stateText = li.querySelector('.grave-state')?.textContent ?? '';
          if (stateText.length === 0 || stateText !== vm.stateLabel || stateText !== vm.state) return false;
          if (!li.classList.contains(`grave--${vm.state}`)) return false;
          if (li.querySelector('.grave-name')?.textContent !== vm.name) return false;
          if (vm.reason !== null && li.querySelector('.grave-reason')?.textContent !== vm.reason) return false;
        }
        for (const el of Array.from(root.querySelectorAll('*'))) {
          if (!EXPECTED_TAGS.has(el.tagName.toLowerCase())) return false;
        }
        return true;
      }),
      { numRuns: numRuns(100) },
    );
  });
});

describe('underscore hint rendering', () => {
  // Feature: ui-polish, Property 3: Underscore hint if and only if a deleted entry's name starts with `_`
  // **Validates: Requirements 7.5, 7.6, 7.7**
  it('property: an item has .grave-hint exactly when its nameHint is non-null', () => {
    const states = fc.constantFrom<GraveState>('alive', 'recovered', 'partial', 'lost');
    const lastSeg = fc.oneof(
      fc.stringMatching(/^[A-Z0-9_.]{1,12}$/),
      fc.stringMatching(/^[A-Z0-9.]{1,11}$/).map((s) => `_${s}`),
    );
    const entry = fc.record({ state: states, dir: fc.boolean(), name: lastSeg });
    fc.assert(
      fc.property(fc.array(entry, { minLength: 1, maxLength: 15 }), (entries) => {
        document.body.textContent = '';
        root = document.createElement('div');
        document.body.appendChild(root);
        const files = entries.map((e, i) =>
          grave(i, { state: e.state, path: e.dir ? `/DIR/${e.name}` : `/${e.name}` }),
        );
        const rep = report(files);
        const vms = toItemViewModels(rep);
        const view = createGraveyardView(root, () => undefined);
        view.show(rep, vms);

        const lis = Array.from(root.querySelectorAll('li.grave'));
        if (lis.length !== vms.length) return false;
        for (let i = 0; i < lis.length; i++) {
          const vm = vms[i] as ItemViewModel;
          const hint = (lis[i] as HTMLElement).querySelector('.grave-hint');
          if ((hint !== null) !== (vm.nameHint !== null)) return false;
          if (hint !== null && hint.textContent !== vm.nameHint) return false;
        }
        return true;
      }),
      { numRuns: numRuns(100) },
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
    expect(progress().textContent).toBe('Showing 200 of 450 items');
    expect(more().hasAttribute('hidden')).toBe(false);
    view.showMore();
    expect(items().length).toBe(400);
    expect(progress().textContent).toBe('Showing 400 of 450 items');
    more().click();
    expect(items().length).toBe(450);
    expect(progress().textContent).toBe('Showing 450 of 450 items');
    expect(more().hasAttribute('hidden')).toBe(true);
  });

  it('hides Show more when everything fits on one page', () => {
    setup([grave(0), grave(1)]);
    expect(progress().textContent).toBe('Showing 2 of 2 items');
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
    expect(progress().textContent).toBe('Showing 4096 of 4096 items');
    view.showMore();
    expect(items().length).toBe(4096);
  });

  it('resets to the first page on a new show()', () => {
    const view = setup(Array.from({ length: 450 }, (_, i) => grave(i)));
    view.showMore();
    const rep = report(Array.from({ length: 300 }, (_, i) => grave(i)));
    view.show(rep, toItemViewModels(rep));
    expect(items().length).toBe(200);
    expect(progress().textContent).toBe('Showing 200 of 300 items');
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

describe('heading, guidance and reveal', () => {
  function fresh() {
    return createGraveyardView(root, onActivate as unknown as (i: ItemViewModel, o: HTMLElement) => void);
  }
  const heading = () => root.querySelector('#graveyard-heading') as HTMLElement;

  it('hides the heading while the guidance shows', () => {
    fresh();
    const guidance = root.querySelector('.graveyard-guidance') as HTMLElement;
    expect(guidance.hidden).toBe(false);
    expect(guidance.textContent).toBe('Open a disk to see its files.');
    expect(heading().hasAttribute('hidden')).toBe(true);
  });

  it('aria-labelledby on the list targets an existing element', () => {
    setup([grave(0)]);
    const id = root.querySelector('ul.graveyard-list')?.getAttribute('aria-labelledby') as string;
    expect(id).toBe('graveyard-heading');
    expect(root.querySelector(`#${id}`)).toBe(heading());
  });

  it('heading is programmatically focusable and described by the summary', () => {
    setup([grave(0)]);
    expect(heading().getAttribute('tabindex')).toBe('-1');
    expect(heading().getAttribute('aria-describedby')).toBe('graveyard-summary');
    expect(root.querySelector('#graveyard-summary')?.classList.contains('graveyard-summary')).toBe(true);
  });

  it('stats block holds the summary then the progress', () => {
    setup([grave(0)]);
    const stats = root.querySelector('.graveyard-stats') as HTMLElement;
    expect(stats.hasAttribute('hidden')).toBe(false);
    expect(Array.from(stats.children).map((c) => c.className)).toEqual(['graveyard-summary', 'graveyard-progress']);
  });

  it.each([
    [false, 'smooth'],
    [true, 'instant'],
  ])('reveal(reducedMotion=%s) focuses the heading and scrolls with %s', (reduced, behavior) => {
    const view = setup([grave(0)]);
    const spy = vi.fn();
    heading().scrollIntoView = spy as unknown as HTMLElement['scrollIntoView'];
    view.reveal(reduced);
    expect(document.activeElement).toBe(heading());
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith({ behavior, block: 'start' });
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

describe('progress line', () => {
  // Feature: ui-polish, Property 4: Progress line reports real counts after every render
  it('Property 4: progress text reports real counts after every render', () => {
    // **Validates: Requirements 8.2, 8.3, 8.4**
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 700 }), fc.integer({ min: 0, max: 6 }), (total, activations) => {
        document.body.textContent = '';
        root = document.createElement('div');
        document.body.appendChild(root);
        const view = setup(Array.from({ length: total }, (_, i) => grave(i)));

        const okAt = (pages: number): boolean => {
          const shown = visibleCount(total, pages);
          if (total === 0) return progress().hasAttribute('hidden');
          const text = progress().textContent;
          const expected = `Showing ${shown} of ${total} items`;
          const allShown = shown === total ? text === `Showing ${total} of ${total} items` : true;
          return !progress().hasAttribute('hidden') && text === expected && allShown && items().length === shown;
        };

        let pages = 1;
        if (!okAt(pages)) return false;
        for (let k = 0; k < activations; k++) {
          const before = progress().textContent;
          const grew = visibleCount(total, pages + 1) > visibleCount(total, pages);
          view.showMore();
          pages++;
          if (!okAt(pages)) return false;
          if (grew && progress().textContent === before) return false;
        }
        return true;
      }),
      { numRuns: numRuns(100) },
    );
  });
});
