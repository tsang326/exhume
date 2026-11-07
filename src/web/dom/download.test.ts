// @vitest-environment node
// Example checks of the downloader with a stubbed document, a stubbed URL and fake timers.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBlobUrlManager } from './blob-urls';
import { DOWNLOAD_FAILED_MESSAGE, createDownloader } from './download';
import { DOWNLOAD_REVOKE_MS } from '../logic/limits';
import type { DownloadSpec } from '../logic/preview-model';

interface FakeAnchor {
  attrs: Record<string, string>;
  setAttribute(k: string, v: string): void;
  click(): void;
  remove(): void;
}

let events: string[];
let anchors: FakeAnchor[];
let created: string[];
let revoked: string[];
let blobTypes: string[];

const spec: DownloadSpec = { label: 'Save', fileName: 'out.md', mime: 'text/markdown', data: '# hi' };

beforeEach(() => {
  vi.useFakeTimers();
  events = [];
  anchors = [];
  created = [];
  revoked = [];
  blobTypes = [];
  vi.stubGlobal('document', {
    createElement: (): FakeAnchor => {
      const a: FakeAnchor = {
        attrs: {},
        setAttribute: (k, v) => void (a.attrs[k] = v),
        click: () => void events.push('click'),
        remove: () => void events.push('remove'),
      };
      anchors.push(a);
      return a;
    },
    body: { appendChild: () => void events.push('append') },
  });
  vi.stubGlobal('URL', {
    createObjectURL: (b: Blob): string => {
      blobTypes.push(b.type);
      const u = `blob:test/${created.length}`;
      created.push(u);
      return u;
    },
    revokeObjectURL: (u: string): void => void revoked.push(u),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function make(): ReturnType<typeof createDownloader> {
  const manager = createBlobUrlManager();
  return createDownloader(manager, (fn, ms) => void setTimeout(fn, ms));
}

describe('Downloader', () => {
  it('builds a typed Blob, clicks a temporary link, removes it and revokes later', () => {
    const result = make().start(spec);
    expect(result).toEqual({ ok: true });
    expect(blobTypes).toEqual(['text/markdown']);
    expect(anchors[0]?.attrs).toEqual({ href: 'blob:test/0', download: 'out.md' });
    expect(events).toEqual(['append', 'click', 'remove']);
    expect(revoked).toEqual([]);
    vi.advanceTimersByTime(DOWNLOAD_REVOKE_MS);
    expect(revoked).toEqual(['blob:test/0']);
  });

  it('revokes only its own URL and leaves other live URLs alone', () => {
    const manager = createBlobUrlManager();
    const other = manager.create(new Blob(['x']));
    const downloader = createDownloader(manager, (fn, ms) => void setTimeout(fn, ms));
    downloader.start(spec);
    vi.advanceTimersByTime(DOWNLOAD_REVOKE_MS);
    expect(revoked).toEqual(['blob:test/1']);
    expect(manager.isOwned(other)).toBe(true);
    expect(manager.liveCount()).toBe(1);
  });

  it('revokes within 1,000 ms', () => {
    expect(DOWNLOAD_REVOKE_MS).toBeLessThanOrEqual(1_000);
    make().start(spec);
    vi.advanceTimersByTime(1_000);
    expect(revoked).toEqual(['blob:test/0']);
  });

  it('builds a text/plain Blob for a text/plain spec', () => {
    const r = make().start({ ...spec, mime: 'text/plain', fileName: 'note.txt', data: 'hello' });
    expect(r).toEqual({ ok: true });
    expect(blobTypes).toEqual(['text/plain']);
    expect(anchors[0]?.attrs).toEqual({ href: 'blob:test/0', download: 'note.txt' });
  });

  it('accepts binary data', () => {
    const r = make().start({ ...spec, mime: 'image/png', fileName: 'a.png', data: new Uint8Array([1, 2]) });
    expect(r).toEqual({ ok: true });
    expect(blobTypes).toEqual(['image/png']);
  });

  it('returns the failure and starts nothing when URL creation throws', () => {
    vi.stubGlobal('URL', {
      createObjectURL: (): string => {
        throw new Error('no');
      },
      revokeObjectURL: (u: string): void => void revoked.push(u),
    });
    const result = make().start(spec);
    expect(result).toEqual({ ok: false, message: DOWNLOAD_FAILED_MESSAGE });
    expect(anchors).toEqual([]);
    expect(events).toEqual([]);
    vi.advanceTimersByTime(5_000);
    expect(revoked).toEqual([]);
  });

  it('returns the failure and starts nothing when Blob creation throws', () => {
    vi.stubGlobal(
      'Blob',
      class {
        constructor() {
          throw new Error('no blob');
        }
      },
    );
    const result = make().start(spec);
    expect(result).toEqual({ ok: false, message: DOWNLOAD_FAILED_MESSAGE });
    expect(created).toEqual([]);
    expect(events).toEqual([]);
  });

  it('rejects an unsafe file name and a disallowed type without clicking', () => {
    expect(make().start({ ...spec, fileName: 'a/b' }).ok).toBe(false);
    expect(make().start({ ...spec, mime: 'text/html' as DownloadSpec['mime'] }).ok).toBe(false);
    expect(events).toEqual([]);
  });
});
