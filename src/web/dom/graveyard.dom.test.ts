// @vitest-environment happy-dom
import fc from 'fast-check';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiskReport, Grave, GraveKind, GraveState } from '../../core/fat12/index';
import { numRuns } from '../../test-support/runs';
import { visibleCount } from '../logic/paging';
import { stateWord, toItemViewModels } from '../logic/viewmodel';
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
  'aria-current',
  'aria-label',
  'role',
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
    expect(li[0]?.querySelector('.grave-state')?.textContent).toBe('Alive');
    expect(li[0]?.querySelector('.grave-reason')).toBeNull();
    expect(li[1]?.classList.contains('grave--open-grave')).toBe(true);
    expect(li[1]?.querySelector('.grave-state')?.textContent).toBe('Recovered');
    expect(li[1]?.querySelector('.grave-reason')?.textContent).toBe('found by chain walk');
    expect(li[2]?.querySelector('.grave-state')?.textContent).toBe('Partly back');
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
    expect(root.querySelector('#graveyard-heading')?.textContent).toBe('<img src=x onerror=1>');
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
    const EXPECTED_TAGS = new Set(['div', 'h3', 'p', 'ul', 'li', 'span', 'button']);
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
          if (stateText.length === 0 || stateText !== vm.stateLabel) return false;
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

function freshRoot(): void {
  document.body.textContent = '';
  root = document.createElement('div');
  document.body.appendChild(root);
}

describe('page-redesign graveyard properties', () => {
  const stateArb = fc.constantFrom<GraveState>('alive', 'recovered', 'partial', 'lost');
  const kindArb = fc.constantFrom<GraveKind>('file', 'file', 'file', 'directory');

  // Feature: page-redesign, Property 7: The open row tracks the preview
  // **Validates: Requirements 8.7**
  it('property: aria-current count and id follow show, clear and new-disk sequences', () => {
    type Action =
      | { kind: 'show'; pick: number }
      | { kind: 'clear' }
      | { kind: 'disk'; states: Array<[GraveState, GraveKind]> };
    const disk = fc.array(fc.tuple(stateArb, kindArb), { minLength: 0, maxLength: 20 });
    const action: fc.Arbitrary<Action> = fc.oneof(
      fc.record({ kind: fc.constant('show' as const), pick: fc.nat(1000) }),
      fc.record({ kind: fc.constant('clear' as const) }),
      fc.record({ kind: fc.constant('disk' as const), states: disk }),
    );
    fc.assert(
      fc.property(disk, fc.array(action, { maxLength: 25 }), (first, actions) => {
        freshRoot();
        const view = createGraveyardView(root, () => undefined);
        let exhumable: number[] = [];
        let expected: number | null = null;
        const load = (spec: Array<[GraveState, GraveKind]>): void => {
          const files = spec.map(([s, k], i) =>
            grave(i, { state: s, kind: k, ...(k === 'directory' ? { path: `/D${i}`, size: 0 } : {}) }),
          );
          const rep = report(files);
          const vms = toItemViewModels(rep);
          exhumable = vms.filter((v) => v.action === 'exhume').map((v) => v.id);
          view.show(rep, vms);
          expected = null;
        };
        const ok = (): boolean => {
          const marked = Array.from(root.querySelectorAll('[aria-current]'));
          if (expected === null) return marked.length === 0;
          const li = marked[0]?.closest('li.grave');
          return (
            marked.length === 1 &&
            marked[0]?.getAttribute('aria-current') === 'true' &&
            li?.getAttribute('data-grave-id') === String(expected)
          );
        };
        load(first);
        if (!ok()) return false;
        for (const a of actions) {
          if (a.kind === 'disk') load(a.states);
          else if (a.kind === 'clear') {
            view.setCurrent(null);
            expected = null;
          } else if (exhumable.length > 0) {
            expected = exhumable[a.pick % exhumable.length] as number;
            view.setCurrent(expected);
          }
          if (!ok()) return false;
        }
        return true;
      }),
      { numRuns: numRuns(100) },
    );
  });

  // Feature: page-redesign, Property 8: Every row carries its state, size and date as text
  // **Validates: Requirements 8.3, 8.4, 13.8**
  it('property: each row text holds state word, size, date, reason and the exact underscore hint', () => {
    const name = fc.oneof(
      fc.stringMatching(/^[A-Z0-9.]{1,10}$/),
      fc.stringMatching(/^[A-Z0-9.]{1,9}$/).map((s) => `_${s}`),
    );
    const entry = fc.record({
      state: stateArb,
      kind: kindArb,
      name,
      size: fc.integer({ min: 0, max: 3_000_000 }),
      reason: fc.stringMatching(/^[a-z ]{1,30}$/),
    });
    fc.assert(
      fc.property(fc.array(entry, { minLength: 1, maxLength: 20 }), (entries) => {
        freshRoot();
        const files = entries.map((e, i) =>
          grave(i, {
            state: e.state,
            kind: e.kind,
            path: `/${e.name}`,
            size: e.size,
            ...(e.state === 'alive' ? {} : { reason: e.reason }),
          }),
        );
        const rep = report(files);
        const vms = toItemViewModels(rep);
        createGraveyardView(root, () => undefined).show(rep, vms);
        const lis = Array.from(root.querySelectorAll('li.grave'));
        if (lis.length !== files.length) return false;
        return lis.every((li, i) => {
          const g = files[i] as Grave;
          const vm = vms[i] as ItemViewModel;
          const text = li.textContent ?? '';
          const hint = li.querySelector('.grave-hint');
          const wantHint = g.state !== 'alive' && vm.name.startsWith('_');
          return (
            text.includes(stateWord(g.state)) &&
            vm.sizeText.length > 0 &&
            vm.dateText.length > 0 &&
            text.includes(vm.sizeText) &&
            text.includes(vm.dateText) &&
            (g.state === 'alive' || text.includes(g.reason ?? '')) &&
            (hint !== null) === wantHint
          );
        });
      }),
      { numRuns: numRuns(100) },
    );
  });

  // Feature: page-redesign, Property 1: Disk text never becomes elements (graveyard part)
  // **Validates: Requirements 1.6, 1.7, 14.3**
  it('property: hostile strings give the same tags and attribute names as plain x strings', () => {
    const hostile = fc.oneof(
      fc.string({ minLength: 0, maxLength: 30 }),
      fc.constantFrom(
        '<script>alert(1)</script>',
        '<img src=x onerror=1>',
        '</li></ul><b>',
        '" onclick="1',
        '`${x}`',
        '&lt;&amp;',
        '<svg onload=1>',
      ),
    );
    // Keep names free of '/', a leading '_' or dots-only so only the text differs, not the structure.
    const seg = hostile.map((s) => `a${s.replace(/\//g, '<')}`);
    const entry = fc.record({ state: stateArb, kind: kindArb, name: seg, reason: hostile });
    const shape = (el: HTMLElement): string => {
      const tags = new Map<string, number>();
      const attrs = new Map<string, number>();
      for (const e of Array.from(el.querySelectorAll('*'))) {
        const t = e.tagName.toLowerCase();
        tags.set(t, (tags.get(t) ?? 0) + 1);
        for (const a of Array.from(e.attributes)) attrs.set(`${t}@${a.name}`, (attrs.get(`${t}@${a.name}`) ?? 0) + 1);
      }
      const sorted = (m: Map<string, number>): Array<[string, number]> =>
        Array.from(m).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
      return JSON.stringify([sorted(tags), sorted(attrs)]);
    };
    const render = (
      label: string,
      rows: Array<{ state: GraveState; kind: GraveKind; name: string; reason: string }>,
      warn: string,
    ): HTMLElement => {
      freshRoot();
      const files = rows.map((e, i) =>
        grave(i, {
          state: e.state,
          kind: e.kind,
          path: `/${e.name}`,
          ...(e.state === 'alive' ? {} : { reason: e.reason.length > 0 ? e.reason : 'x' }),
        }),
      );
      const rep = report(files, {
        volume: { label, geometrySource: 'bpb', geometry: null },
        warnings: [{ code: 'chain-short', message: warn, path: `/${rows[0]?.name ?? 'x'}` }],
      });
      createGraveyardView(root, () => undefined).show(rep, toItemViewModels(rep));
      return root;
    };
    fc.assert(
      fc.property(
        fc.array(entry, { minLength: 1, maxLength: 8 }),
        fc.stringMatching(/^[A-Z]{1,8}$/).chain((base) => hostile.map((h2) => `${base}${h2}`)),
        hostile,
        (rows, label, warn) => {
          const hostileShape = shape(render(label, rows, warn.length > 0 ? warn : 'w'));
          const plainRows = rows.map((r) => ({ ...r, name: 'x'.repeat(r.name.length), reason: 'x'.repeat(r.reason.length) }));
          const plainShape = shape(render('x'.repeat(label.length), plainRows, 'x'.repeat(Math.max(1, warn.length))));
          return hostileShape === plainShape;
        },
      ),
      { numRuns: numRuns(100) },
    );
  });
});

function expectOnlyAllowedMarkup(container: HTMLElement, expectedItems: number): void {
  expect(container.querySelectorAll('li.grave').length).toBe(expectedItems);
  const tags = new Set(Array.from(container.querySelectorAll('*')).map((e) => e.tagName.toLowerCase()));
  for (const t of tags) expect(['div', 'h3', 'p', 'ul', 'li', 'span', 'button']).toContain(t);
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

  it('shows warnings as an always visible group banner', () => {
    setup([grave(0)], {
      warnings: [
        { code: 'chain-short', message: 'Chain is short', path: '/A.TXT' },
        { code: 'fat-copies-differ', message: 'FAT copies differ' },
      ],
    });
    const banner = root.querySelector('.graveyard-warnings') as HTMLElement;
    expect(banner.hasAttribute('hidden')).toBe(false);
    expect(banner.getAttribute('role')).toBe('group');
    expect(banner.getAttribute('aria-label')).toBe('Warnings');
    expect(banner.querySelector('p')?.textContent).toBe('Warnings (2)');
    const lines = Array.from(banner.querySelectorAll('li')).map((l) => l.textContent);
    expect(lines).toEqual(['Chain is short (/A.TXT)', 'FAT copies differ']);
    expect(root.querySelector('details')).toBeNull();
  });

  it('hides the warnings area when there are none', () => {
    setup([grave(0)]);
    expect(root.querySelector('.graveyard-warnings')?.hasAttribute('hidden')).toBe(true);
    expect(root.querySelector('.graveyard-warnings li')).toBeNull();
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

  it('heading is an h3 with the volume label; summary counts files, directories and deleted', () => {
    const rep = report([grave(0), grave(1, { state: 'recovered' }), grave(2, { kind: 'directory', path: '/D', size: 0 })], {
      volume: { label: 'WRITER DEMO', geometrySource: 'bpb', geometry: null },
    });
    const view = createGraveyardView(root, () => undefined);
    view.show(rep, toItemViewModels(rep));
    expect(heading().tagName).toBe('H3');
    expect(heading().textContent).toBe('WRITER DEMO');
    expect(root.querySelector('#graveyard-summary')?.textContent).toBe('2 files, 1 directories, 1 deleted');
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

describe('current row marker', () => {
  const current = () => Array.from(root.querySelectorAll('[aria-current]'));

  it('setCurrent marks only the matching row button; null clears', () => {
    const view = setup([grave(0), grave(1), grave(2, { state: 'lost', reason: 'gone' })]);
    expect(current().length).toBe(0);
    view.setCurrent(1);
    expect(current()).toEqual([view.rowButton(1)]);
    expect(view.rowButton(1)?.getAttribute('aria-current')).toBe('true');
    view.setCurrent(0);
    expect(current()).toEqual([view.rowButton(0)]);
    view.setCurrent(2);
    expect(current().length).toBe(0);
    expect(view.rowButton(2)).toBeNull();
    view.setCurrent(null);
    expect(current().length).toBe(0);
  });

  it('show() clears the marker and a later page keeps it', () => {
    const view = setup(Array.from({ length: 250 }, (_, i) => grave(i)));
    view.setCurrent(210);
    expect(current().length).toBe(0);
    view.showMore();
    expect(current()).toEqual([view.rowButton(210)]);
    const rep = report([grave(0), grave(1)]);
    view.show(rep, toItemViewModels(rep));
    expect(current().length).toBe(0);
    expect(view.rowButton(999)).toBeNull();
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
