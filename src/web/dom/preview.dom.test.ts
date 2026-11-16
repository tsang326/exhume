// @vitest-environment happy-dom
import fc from 'fast-check';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { numRuns } from '../../test-support/runs';
import { createBlobUrlManager } from './blob-urls';
import type { BlobUrlApi, BlobUrlManager } from './blob-urls';
import type { Downloader } from './download';
import { createPreviewPanel } from './preview';
import type { PreviewPanel } from './preview';
import type { DownloadSpec, PreviewModel } from '../logic/preview-model';

class FakeBlobApi implements BlobUrlApi {
  created: string[] = [];
  revoked: string[] = [];
  private n = 0;
  create(): string {
    const url = `blob:fake/${++this.n}`;
    this.created.push(url);
    return url;
  }
  revoke(url: string): void {
    this.revoked.push(url);
  }
}

const DL_MD: DownloadSpec = { label: 'Download .md', fileName: 'note.md', mime: 'text/markdown', data: '# hi' };
const DL_TXT: DownloadSpec = { label: 'Download .txt', fileName: 'note.txt', mime: 'text/plain', data: 'abc' };
const DL_RAW: DownloadSpec = {
  label: 'Download raw bytes',
  fileName: 'note.bin',
  mime: 'application/octet-stream',
  data: new Uint8Array([1, 2, 3]),
};

function mdModel(over: Partial<PreviewModel> = {}): PreviewModel {
  return {
    title: 'Note',
    kindLabel: 'Read as Markdown',
    partialNote: null,
    error: null,
    warnings: [],
    body: { kind: 'markdown', text: 'Hello **world**', shortened: false },
    downloads: [DL_MD, DL_RAW],
    ...over,
  };
}

function pngModel(): PreviewModel {
  return {
    title: 'Picture',
    kindLabel: 'Read as PNG',
    partialNote: null,
    error: null,
    warnings: [],
    body: { kind: 'png', png: new Uint8Array([137, 80, 78, 71]), alt: 'picture.png' },
    downloads: [],
  };
}

describe('createPreviewPanel (happy-dom)', () => {
  let api: FakeBlobApi;
  let blobs: BlobUrlManager;
  let started: DownloadSpec[];
  let downloader: Downloader;
  let root: HTMLElement;
  let outside: HTMLButtonElement;
  let panel: PreviewPanel;

  beforeEach(() => {
    document.body.replaceChildren();
    api = new FakeBlobApi();
    blobs = createBlobUrlManager(api);
    started = [];
    downloader = {
      start(spec) {
        started.push(spec);
        return { ok: true };
      },
    };
    outside = document.createElement('button');
    root = document.createElement('section');
    document.body.append(outside, root);
    panel = createPreviewPanel(root, { blobs, downloader });
  });

  afterEach(() => {
    panel.clear();
    document.body.replaceChildren();
  });

  it('starts in the empty state with no buttons', () => {
    expect(panel.isShowing()).toBe(false);
    expect(root.querySelector('h3')?.textContent).toBe('Preview');
    expect(root.querySelector('.preview-empty')?.textContent).toBe('Choose a file to read it here.');
    expect(root.querySelector('button')).toBeNull();
    expect(panel.headingElement().id).toBe('preview-title');
  });

  it('is not a dialog and does not inert anything', () => {
    panel.show(mdModel());
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector('[aria-modal]')).toBeNull();
    expect(document.querySelector('[inert]')).toBeNull();
    expect(panel.isShowing()).toBe(true);
    expect(panel.headingElement().textContent).toBe('Note');
    expect(root.querySelector('.preview-kind')?.textContent).toBe('Read as Markdown');
  });

  it('show and clear never move focus or scroll', () => {
    outside.focus();
    let scrolls = 0;
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = () => {
      scrolls++;
    };
    try {
      panel.show(mdModel());
      expect(document.activeElement).toBe(outside);
      panel.clear();
      expect(document.activeElement).toBe(outside);
      expect(scrolls).toBe(0);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('focusHeading focuses the heading and reveal scrolls with the right behavior', () => {
    panel.show(mdModel());
    panel.focusHeading();
    expect(document.activeElement).toBe(panel.headingElement());
    const seen: Array<ScrollIntoViewOptions | boolean | undefined> = [];
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = (arg?: boolean | ScrollIntoViewOptions) => {
      seen.push(arg);
    };
    try {
      outside.focus();
      panel.reveal(true);
      panel.reveal(false);
    } finally {
      Element.prototype.scrollIntoView = original;
    }
    expect(document.activeElement).toBe(panel.headingElement());
    expect(seen).toEqual([
      { behavior: 'instant', block: 'start' },
      { behavior: 'smooth', block: 'start' },
    ]);
  });

  it('replaces the content when a second preview is shown', () => {
    panel.show(mdModel());
    panel.show(mdModel({ title: 'Second' }));
    expect(root.querySelectorAll('h3').length).toBe(1);
    expect(panel.headingElement().textContent).toBe('Second');
  });

  it('fades the paper in only on the first show, not when swapping files', () => {
    panel.show(mdModel());
    expect(root.querySelector('.paper')?.hasAttribute('data-swap')).toBe(false);
    panel.show(mdModel({ title: 'Second' }));
    expect(root.querySelector('.paper')?.hasAttribute('data-swap')).toBe(true);
    panel.clear();
    panel.show(mdModel({ title: 'Third' }));
    expect(root.querySelector('.paper')?.hasAttribute('data-swap')).toBe(false);
  });

  it('renders markdown on the paper field without leaking markup', () => {
    panel.show(mdModel());
    const region = root.querySelector('.paper .preview-markdown') as HTMLElement;
    expect(region.querySelector('strong')?.textContent).toBe('world');
    expect(region.textContent).toContain('Hello');
  });

  it('shows the shortened note only when shortened', () => {
    panel.show(mdModel());
    expect(root.querySelector('.preview-shortened')).toBeNull();
    panel.show(mdModel({ body: { kind: 'markdown', text: 'x', shortened: true } }));
    expect(root.querySelector('.preview-shortened')?.textContent).toContain('Only the start of the text');
  });

  it('renders a csv table with header cells and the truncated note', () => {
    panel.show(
      mdModel({
        body: { kind: 'csv', table: { rows: [['a', 'b'], ['1', '2']], totalRows: 50, totalCols: 9, truncated: true } },
      }),
    );
    expect(Array.from(root.querySelectorAll('th')).map((t) => t.textContent)).toEqual(['a', 'b']);
    expect(Array.from(root.querySelectorAll('td')).map((t) => t.textContent)).toEqual(['1', '2']);
    expect(root.querySelector('.csv-note')?.textContent).toBe(
      'Preview truncated: showing 2 of 50 rows and 2 of 9 columns.',
    );
  });

  it('renders a hex view and a byte-count note when shortened', () => {
    panel.show(
      mdModel({
        body: {
          kind: 'hex',
          rows: [{ offset: '00000000', hex: '41 42', text: 'AB' }],
          totalBytes: 100,
          shownBytes: 2,
        },
      }),
    );
    expect(root.querySelector('.hex-offset')?.textContent).toBe('00000000');
    expect(root.querySelector('.hex-text')?.textContent).toBe('AB');
    expect(root.querySelector('.preview-shortened')?.textContent).toBe('Showing 2 of 100 bytes.');
  });

  it('renders a png img with an owned blob URL and the safe name as alt', () => {
    panel.show(pngModel());
    const img = root.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toMatch(/^blob:/);
    expect(blobs.isOwned(img.getAttribute('src') as string)).toBe(true);
    expect(img.getAttribute('alt')).toBe('picture.png');
    expect(blobs.liveCount()).toBe(1);
  });

  it('creates Blob URLs only for PNG and revokes them on clear', () => {
    panel.show(mdModel());
    expect(blobs.liveCount()).toBe(0);
    panel.show(pngModel());
    expect(blobs.liveCount()).toBe(1);
    panel.clear();
    expect(api.revoked).toEqual(api.created);
    expect(blobs.liveCount()).toBe(0);
    expect(panel.isShowing()).toBe(false);
  });

  it('revokes the previous Blob URL when another preview is shown', () => {
    panel.show(pngModel());
    const first = api.created[0] as string;
    panel.show(pngModel());
    expect(api.revoked).toEqual([first]);
    expect(blobs.liveCount()).toBe(1);
    expect(blobs.isOwned(first)).toBe(false);
    panel.show(mdModel());
    expect(blobs.liveCount()).toBe(0);
  });

  it('renders a text body as one Text node in a focusable labeled region', () => {
    const evil = '<img src=x onerror=alert(1)><script>boom()</script>\nline two';
    panel.show(mdModel({ body: { kind: 'text', text: evil, shortened: false }, downloads: [DL_TXT, DL_RAW] }));
    const region = root.querySelector('.preview-text') as HTMLElement;
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(region.getAttribute('role')).toBe('region');
    expect(region.getAttribute('aria-label')).toBe('Document text');
    expect(region.childNodes.length).toBe(1);
    expect(region.firstChild?.nodeType).toBe(Node.TEXT_NODE);
    expect(region.children.length).toBe(0);
    expect(region.textContent).toBe(evil);
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('script')).toBeNull();
  });

  it('shows the shortened note for a shortened text body', () => {
    panel.show(mdModel({ body: { kind: 'text', text: 'abc', shortened: true } }));
    expect(root.querySelector('.preview-shortened')?.textContent).toContain('Only the start of the text');
  });

  it('offers both downloads and lists warnings for a text body', () => {
    panel.show(
      mdModel({
        body: { kind: 'text', text: 'abc', shortened: false },
        warnings: ['3 control bytes dropped'],
        downloads: [DL_TXT, DL_RAW],
      }),
    );
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('.preview-download'));
    expect(buttons.map((b) => b.textContent)).toEqual(['Download .txt', 'Download raw bytes']);
    buttons[0]?.click();
    expect(started).toEqual([DL_TXT]);
    expect(Array.from(root.querySelectorAll('.preview-warnings > li')).map((li) => li.textContent)).toEqual([
      '3 control bytes dropped',
    ]);
  });

  it('shows the partial note above the content and a cut line after it', () => {
    panel.show(mdModel({ partialNote: 'Only part of this file survived.' }));
    const note = root.querySelector('.preview-partial') as HTMLElement;
    const paper = root.querySelector('.paper') as HTMLElement;
    const cut = root.querySelector('.cut') as HTMLElement;
    expect(note.textContent).toBe('Only part of this file survived.');
    expect(note.compareDocumentPosition(paper) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(paper.compareDocumentPosition(cut) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('shows no partial note or cut line for a whole file', () => {
    panel.show(mdModel());
    expect(root.querySelector('.preview-partial')).toBeNull();
    expect(root.querySelector('.cut')).toBeNull();
  });

  it('shows error text as an alert', () => {
    panel.show(mdModel({ error: 'This file could not be read.', body: { kind: 'none' } }));
    const err = root.querySelector('.preview-error') as HTMLElement;
    expect(err.textContent).toBe('This file could not be read.');
    expect(err.getAttribute('role')).toBe('alert');
    expect(root.querySelector('.paper')).toBeNull();
  });

  it('renders each warning as its own li', () => {
    panel.show(mdModel({ warnings: ['one', 'two', 'three'] }));
    expect(Array.from(root.querySelectorAll('.preview-warnings > li')).map((li) => li.textContent)).toEqual([
      'one',
      'two',
      'three',
    ]);
  });

  it('starts downloads through the Downloader with the exact spec', () => {
    panel.show(mdModel());
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('.preview-download'));
    expect(buttons.map((b) => b.textContent)).toEqual(['Download .md', 'Download raw bytes']);
    buttons[0]?.click();
    buttons[1]?.click();
    expect(started).toEqual([DL_MD, DL_RAW]);
    expect(started[0]).toBe(DL_MD);
  });

  it('shows the download failure message in the status line', () => {
    const failing: Downloader = { start: () => ({ ok: false, message: 'The download could not be started.' }) };
    const p = createPreviewPanel(root, { blobs, downloader: failing });
    p.show(mdModel());
    (root.querySelector('.preview-download') as HTMLElement).click();
    expect(root.querySelector('.preview-status')?.textContent).toBe('The download could not be started.');
    p.clear();
  });

  it('keeps hostile title, kind label, warnings, note, and error as text', () => {
    const evil = '<img src=x onerror=alert(1)><script>boom()</script>';
    panel.show(
      mdModel({ title: evil, kindLabel: evil, warnings: [evil], partialNote: evil, error: evil, body: { kind: 'none' } }),
    );
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelector('script')).toBeNull();
    expect(panel.headingElement().textContent).toBe(evil);
    expect(root.querySelector('.preview-kind')?.textContent).toBe(evil);
    expect(root.querySelector('.preview-warnings li')?.textContent).toBe(evil);
    expect(root.querySelector('.preview-partial')?.textContent).toBe(evil);
    expect(root.querySelector('.preview-error')?.textContent).toBe(evil);
  });
});

const ALLOWED_TAGS = new Set([
  'h3', 'p', 'ul', 'li', 'div', 'span', 'button', 'img', 'br', 'strong', 'em', 'hr',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
]);

const hostile = fc.oneof(
  fc.string({ minLength: 1, maxLength: 40 }),
  fc.constantFrom(
    '<', '>', '&', '"', "'", '`', '<script>boom()</script>', '<img src=x onerror=alert(1)>',
    '</td></tr></table><b>', '" onclick="1', '&lt;&amp;', '`<script>`',
  ),
  fc
    .array(fc.constantFrom('<', '>', '&', '"', "'", '`', 'a', '/', '='), { minLength: 1, maxLength: 16 })
    .map((a) => a.join('')),
);

/** Tag counts plus the attribute names used per tag, for everything inside root. */
function signature(root: HTMLElement): string {
  const counts = new Map<string, number>();
  const attrs = new Map<string, Set<string>>();
  for (const el of Array.from(root.querySelectorAll('*'))) {
    const tag = el.tagName.toLowerCase();
    counts.set(tag, (counts.get(tag) ?? 0) + 1);
    const set = attrs.get(tag) ?? new Set<string>();
    for (const name of el.getAttributeNames()) set.add(name);
    attrs.set(tag, set);
  }
  const parts = Array.from(counts.keys()).sort().map((t) => `${t}:${counts.get(t)}:${Array.from(attrs.get(t) ?? []).sort().join(',')}`);
  return parts.join('|');
}

function onlyAllowedTags(root: HTMLElement): boolean {
  for (const el of Array.from(root.querySelectorAll('*'))) {
    if (!ALLOWED_TAGS.has(el.tagName.toLowerCase())) return false;
  }
  return true;
}

type Shape =
  | { kind: 'text'; text: string; shortened: boolean }
  | { kind: 'csv'; rows: string[][]; truncated: boolean }
  | { kind: 'hex'; rows: Array<{ offset: string; hex: string; text: string }> }
  | { kind: 'none' };

interface Spec {
  title: string;
  kindLabel: string;
  partialNote: string | null;
  error: string | null;
  warnings: string[];
  shape: Shape;
}

function toModel(spec: Spec, f: (s: string) => string): PreviewModel {
  const g = (s: string | null): string | null => (s === null ? null : f(s));
  const sh = spec.shape;
  let body: PreviewModel['body'];
  if (sh.kind === 'text') body = { kind: 'text', text: f(sh.text), shortened: sh.shortened };
  else if (sh.kind === 'csv') {
    const rows = sh.rows.map((r) => r.map(f));
    body = { kind: 'csv', table: { rows, totalRows: rows.length, totalCols: 3, truncated: sh.truncated } };
  } else if (sh.kind === 'hex') {
    body = {
      kind: 'hex',
      rows: sh.rows.map((r) => ({ offset: f(r.offset), hex: f(r.hex), text: f(r.text) })),
      totalBytes: 1000,
      shownBytes: 10,
    };
  } else body = { kind: 'none' };
  return {
    title: f(spec.title),
    kindLabel: f(spec.kindLabel),
    partialNote: g(spec.partialNote),
    error: g(spec.error),
    warnings: spec.warnings.map(f),
    body,
    downloads: [DL_MD, DL_RAW],
  };
}

const shapeArb: fc.Arbitrary<Shape> = fc.oneof(
  fc.record({ kind: fc.constant('text' as const), text: hostile, shortened: fc.boolean() }),
  fc.record({
    kind: fc.constant('csv' as const),
    rows: fc.array(fc.array(hostile, { minLength: 1, maxLength: 4 }), { minLength: 1, maxLength: 4 }),
    truncated: fc.boolean(),
  }),
  fc.record({
    kind: fc.constant('hex' as const),
    rows: fc.array(fc.record({ offset: hostile, hex: hostile, text: hostile }), { minLength: 1, maxLength: 4 }),
  }),
  fc.constant<Shape>({ kind: 'none' }),
);

const specArb: fc.Arbitrary<Spec> = fc.record({
  title: hostile,
  kindLabel: hostile,
  partialNote: fc.option(hostile, { nil: null }),
  error: fc.option(hostile, { nil: null }),
  warnings: fc.array(hostile, { maxLength: 4 }),
  shape: shapeArb,
});

describe('preview panel properties (happy-dom)', () => {
  let api: FakeBlobApi;
  let blobs: BlobUrlManager;
  let root: HTMLElement;
  let panel: PreviewPanel;

  beforeEach(() => {
    document.body.replaceChildren();
    api = new FakeBlobApi();
    blobs = createBlobUrlManager(api);
    root = document.createElement('section');
    document.body.append(root);
    panel = createPreviewPanel(root, { blobs, downloader: { start: () => ({ ok: true }) } });
  });

  afterEach(() => {
    panel.clear();
    document.body.replaceChildren();
  });

  // Feature: page-redesign, Property 1: Disk text never becomes elements
  // **Validates: Requirements 1.7, 8.14, 14.3**
  it('property: hostile disk text gives the same elements and attribute names as plain x strings', () => {
    fc.assert(
      fc.property(specArb, (spec) => {
        panel.show(toModel(spec, (s) => s));
        const hostileSig = signature(root);
        const tagsOk = onlyAllowedTags(root);
        const noScript = root.querySelector('script') === null;
        panel.show(toModel(spec, (s) => 'x'.repeat(s.length)));
        return tagsOk && noScript && hostileSig === signature(root);
      }),
      { numRuns: numRuns(100) },
    );
  });

  // Feature: page-redesign, Property 1: Disk text never becomes elements
  // **Validates: Requirements 1.7, 8.14, 14.3**
  it('property: hostile markdown stays inside the fixed tag set', () => {
    fc.assert(
      fc.property(fc.array(hostile, { maxLength: 8 }), fc.boolean(), (parts, shortened) => {
        panel.show(mdModel({ body: { kind: 'markdown', text: parts.join('\n'), shortened } }));
        return onlyAllowedTags(root) && root.querySelector('script') === null && root.querySelector('img') === null;
      }),
      { numRuns: numRuns(100) },
    );
  });

  // Feature: page-redesign, Property 6: Live Blob URLs match the shown preview
  // **Validates: Requirements 8.15**
  it('property: liveCount is 1 exactly when a PNG is shown, across shows and clears', () => {
    const step = fc.constantFrom('png', 'markdown', 'text', 'hex', 'none', 'clear');
    fc.assert(
      fc.property(fc.array(step, { minLength: 1, maxLength: 20 }), (steps) => {
        panel.clear();
        if (blobs.liveCount() !== 0) return false;
        for (const s of steps) {
          if (s === 'clear') panel.clear();
          else if (s === 'png') panel.show(pngModel());
          else if (s === 'markdown') panel.show(mdModel());
          else if (s === 'text') panel.show(mdModel({ body: { kind: 'text', text: 't', shortened: false } }));
          else if (s === 'hex') {
            panel.show(mdModel({ body: { kind: 'hex', rows: [{ offset: '0', hex: '41', text: 'A' }], totalBytes: 1, shownBytes: 1 } }));
          } else panel.show(mdModel({ error: 'e', body: { kind: 'none' } }));
          if (blobs.liveCount() !== (s === 'png' ? 1 : 0)) return false;
        }
        panel.clear();
        return blobs.liveCount() === 0 && api.created.length === api.revoked.length;
      }),
      { numRuns: numRuns(100) },
    );
  });
});
