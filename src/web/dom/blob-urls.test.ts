import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { numRuns } from '../../test-support/runs';
import { createBlobUrlManager, type BlobUrlApi } from './blob-urls';

function fakeApi(): { api: BlobUrlApi; created: string[]; revoked: string[] } {
  const created: string[] = [];
  const revoked: string[] = [];
  return {
    created,
    revoked,
    api: {
      create: () => {
        const url = `blob:fake/${created.length}`;
        created.push(url);
        return url;
      },
      revoke: (url) => void revoked.push(url),
    },
  };
}

describe('BlobUrlManager', () => {
  // Feature: graveyard-ui, Property 29: Every Blob URL is revoked and only owned URLs are linkable
  // **Validates: Requirements 1.4, 9.11**
  it('Property 29: owned exactly the created URLs; revokeAll revokes each once', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 30 }), fc.array(fc.string(), { maxLength: 5 }), (n, strangers) => {
        const f = fakeApi();
        const m = createBlobUrlManager(f.api);
        const urls: string[] = [];
        for (let i = 0; i < n; i++) urls.push(m.create(new Blob([])));
        const okOwned = urls.every((u) => m.isOwned(u));
        const okStrangers = strangers.every((s) => urls.includes(s) || !m.isOwned(s));
        const okCount = m.liveCount() === n;
        m.revokeAll();
        m.revokeAll();
        const okRevoked =
          f.revoked.length === n && new Set(f.revoked).size === n && urls.every((u) => f.revoked.includes(u));
        return okOwned && okStrangers && okCount && okRevoked && m.liveCount() === 0 && urls.every((u) => !m.isOwned(u));
      }),
      { numRuns: numRuns(100) },
    );
  });

  it('revoke releases one owned URL once and ignores unknown URLs', () => {
    const f = fakeApi();
    const m = createBlobUrlManager(f.api);
    const a = m.create(new Blob([]));
    const b = m.create(new Blob([]));
    m.revoke(a);
    m.revoke(a);
    m.revoke('blob:unknown');
    expect(f.revoked).toEqual([a]);
    expect(m.isOwned(a)).toBe(false);
    expect(m.isOwned(b)).toBe(true);
    expect(m.liveCount()).toBe(1);
    m.revokeAll();
    expect(f.revoked).toEqual([a, b]);
  });

  it('isOwned works when detached from the manager', () => {
    const m = createBlobUrlManager(fakeApi().api);
    const url = m.create(new Blob([]));
    const { isOwned } = m;
    expect(isOwned(url)).toBe(true);
    expect(isOwned('blob:other')).toBe(false);
  });
});
