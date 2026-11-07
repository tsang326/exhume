import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEMO_REGISTRY, loadDemoBytes, type DemoDisk } from './demos';
import { MAX_IMAGE_BYTES } from './logic/limits';

type NetImpl = NonNullable<Parameters<typeof loadDemoBytes>[1]>;

const demo: DemoDisk = {
  id: 'one',
  title: 'Sample',
  description: 'A sample disk.',
  url: '/disks/sample.img',
};

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(chunks[i++]);
      else controller.close();
    },
  });
}

function fakeNet(response: Response): { impl: NetImpl; calls: Array<[unknown, RequestInit | undefined]> } {
  const calls: Array<[unknown, RequestInit | undefined]> = [];
  const impl = (async (input: unknown, init?: RequestInit) => {
    calls.push([input, init]);
    return response;
  }) as unknown as NetImpl;
  return { impl, calls };
}

describe('demos', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('ships with the three demo entries', () => {
    expect(DEMO_REGISTRY.map((d) => [d.id, d.url])).toEqual([
      ['writers-disk', '/disks/writers-disk.img'],
      ['office-disk', '/disks/office-disk.img'],
      ['damaged-disk', '/disks/damaged-disk.img'],
    ]);
  });

  it('passes the validated URL and credentials omit, and returns the bytes', async () => {
    const res = new Response(streamOf([new Uint8Array([1, 2]), new Uint8Array([3])]), { status: 200 });
    const { impl, calls } = fakeNet(res);
    const out = await loadDemoBytes(demo, impl);
    expect(out).toEqual({ ok: true, bytes: new Uint8Array([1, 2, 3]) });
    expect(calls.length).toBe(1);
    expect(calls[0][0]).toBe('/disks/sample.img');
    expect(calls[0][1]?.credentials).toBe('omit');
    expect(calls[0][1]?.redirect).toBe('error');
    expect(calls[0][1]?.cache).toBe('no-store');
  });

  it('gives timeout when the 10 second abort fires', async () => {
    const impl = ((_input: unknown, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
      })) as unknown as NetImpl;
    const pending = loadDemoBytes(demo, impl);
    await vi.advanceTimersByTimeAsync(9_999);
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const out = await pending;
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('timeout');
  });

  it('gives http for a non-2xx status', async () => {
    const { impl } = fakeNet(new Response('nope', { status: 404 }));
    const out = await loadDemoBytes(demo, impl);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('http');
  });

  it('gives too-large from the header without reading the body', async () => {
    let pulled = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled++;
        controller.enqueue(new Uint8Array(1));
      },
    }, { highWaterMark: 0 });
    const res = new Response(body, {
      status: 200,
      headers: { 'content-length': String(MAX_IMAGE_BYTES + 1) },
    });
    const { impl } = fakeNet(res);
    const out = await loadDemoBytes(demo, impl);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('too-large');
    expect(pulled).toBe(0);
  });

  it('falls back to arrayBuffer when the body is null', async () => {
    const buf = new Uint8Array([9, 8, 7]).buffer;
    const fake = {
      status: 200,
      headers: new Headers(),
      body: null,
      arrayBuffer: async () => buf,
    } as unknown as Response;
    const { impl } = fakeNet(fake);
    const out = await loadDemoBytes(demo, impl);
    expect(out).toEqual({ ok: true, bytes: new Uint8Array([9, 8, 7]) });
  });

  it('gives empty for zero bytes', async () => {
    const { impl } = fakeNet(new Response(streamOf([]), { status: 200 }));
    const out = await loadDemoBytes(demo, impl);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('empty');
  });

  it('sends no request for an invalid entry', async () => {
    const { impl, calls } = fakeNet(new Response('x', { status: 200 }));
    const out = await loadDemoBytes({ ...demo, url: '//evil.example/x' }, impl);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toBe('invalid');
    expect(calls.length).toBe(0);
  });
});
