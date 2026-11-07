import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkerClient } from './worker-client';

type Listener = (e: unknown) => void;

class FakeWorker {
  posted: { message: any; transfer: unknown[] }[] = [];
  terminated = false;
  private listeners = new Map<string, Listener[]>();

  addEventListener(type: string, fn: Listener): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }
  postMessage(message: unknown, transfer: unknown[] = []): void {
    this.posted.push({ message, transfer });
  }
  terminate(): void {
    this.terminated = true;
  }
  emit(type: string, data?: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) fn({ data });
  }
  lastId(): number {
    return this.posted[this.posted.length - 1]!.message.id;
  }
}

const openedMsg = (id: number) => ({
  type: 'opened',
  id,
  report: { volume: { label: '', geometrySource: 'none', geometry: null }, files: [], warnings: [] },
});
const exhumedMsg = (id: number) => ({
  type: 'exhumed',
  id,
  graveId: 0,
  raw: new Uint8Array([1, 2]),
  readWarnings: [],
  result: { kind: 'raw', error: 'unknown format', warnings: [] },
});

describe('worker client', () => {
  let workers: FakeWorker[];
  const make = () => {
    const lost: string[] = [];
    const client = createWorkerClient(
      () => {
        const w = new FakeWorker();
        workers.push(w);
        return w as unknown as Worker;
      },
      { onLost: (reason) => lost.push(reason) },
    );
    return { client, lost };
  };

  beforeEach(() => {
    workers = [];
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves a valid current response as ok', async () => {
    const { client } = make();
    const p = client.open(new Uint8Array([9]));
    workers[0]!.emit('message', openedMsg(workers[0]!.lastId()));
    const r = await p;
    expect(r.status).toBe('ok');
    expect(client.hasPending()).toBe(false);
  });

  it('maps a failed answer to failed', async () => {
    const { client } = make();
    const p = client.exhume(3);
    const w = workers[0]!;
    expect(w.posted[0]!.message).toEqual({ type: 'exhume', id: w.lastId(), graveId: 3 });
    w.emit('message', { type: 'failed', id: w.lastId(), request: 'exhume', cause: 'no-disk', error: 'no disk' });
    expect(await p).toEqual({ status: 'failed', cause: 'no-disk', error: 'no disk' });
  });

  it('ignores invalid and stale messages', async () => {
    const { client } = make();
    const p = client.exhume(0);
    const w = workers[0]!;
    const id = w.lastId();
    w.emit('message', 'garbage');
    w.emit('message', { type: 'exhumed', id: 'x' });
    w.emit('message', exhumedMsg(id + 5));
    w.emit('message', openedMsg(id));
    expect(client.hasPending()).toBe(true);
    w.emit('message', exhumedMsg(id));
    expect((await p).status).toBe('ok');
    // A repeat of the same answer changes nothing.
    w.emit('message', exhumedMsg(id));
    expect(client.hasPending()).toBe(false);
  });

  it('transfers a copy of the open bytes and keeps the held bytes', async () => {
    const { client } = make();
    const held = new Uint8Array([1, 2, 3]);
    void client.open(held);
    const sent = workers[0]!.posted[0]!;
    expect(sent.message.image).not.toBe(held);
    expect(sent.message.image.buffer).not.toBe(held.buffer);
    expect(sent.transfer).toEqual([sent.message.image.buffer]);
    expect(Array.from(held)).toEqual([1, 2, 3]);
    expect(held.buffer.byteLength).toBe(3);
  });

  it('ends as lost on worker error and uses a new worker with growing ids', async () => {
    const { client, lost } = make();
    const p1 = client.open(new Uint8Array([1]));
    const first = workers[0]!;
    const id1 = first.lastId();
    first.emit('error');
    expect(await p1).toMatchObject({ status: 'lost', reason: 'worker-error' });
    expect(first.terminated).toBe(true);
    expect(lost).toEqual(['worker-error']);

    // The old worker can no longer influence the client.
    const p2 = client.open(new Uint8Array([1]));
    expect(workers).toHaveLength(2);
    first.emit('message', openedMsg(id1));
    expect(client.hasPending()).toBe(true);
    expect(workers[1]!.lastId()).toBeGreaterThan(id1);
    workers[1]!.emit('message', openedMsg(workers[1]!.lastId()));
    expect((await p2).status).toBe('ok');
  });

  it('ends as lost on messageerror', async () => {
    const { client } = make();
    const p = client.exhume(1);
    workers[0]!.emit('messageerror');
    expect(await p).toMatchObject({ status: 'lost', reason: 'worker-error' });
    void client.exhume(1);
    expect(workers).toHaveLength(2);
  });

  it('times out an open after 15 s', async () => {
    const { client } = make();
    const p = client.open(new Uint8Array([1]));
    vi.advanceTimersByTime(14_999);
    expect(client.hasPending()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(await p).toMatchObject({ status: 'lost', reason: 'timeout' });
    expect(workers[0]!.terminated).toBe(true);
    void client.open(new Uint8Array([1]));
    expect(workers).toHaveLength(2);
  });

  it('times out an exhume after 30 s', async () => {
    const { client } = make();
    const p = client.exhume(0);
    vi.advanceTimersByTime(29_999);
    expect(client.hasPending()).toBe(true);
    vi.advanceTimersByTime(1);
    expect(await p).toMatchObject({ status: 'lost', reason: 'timeout' });
    expect(workers[0]!.terminated).toBe(true);
  });

  it('ends as lost on cancel and the next request uses a new worker', async () => {
    const { client } = make();
    const p = client.exhume(0);
    client.cancel();
    expect(await p).toMatchObject({ status: 'lost', reason: 'cancelled' });
    expect(workers[0]!.terminated).toBe(true);
    void client.exhume(0);
    expect(workers).toHaveLength(2);
  });

  it('supersedeAll resolves pending as superseded and keeps the worker', async () => {
    const { client } = make();
    const p = client.open(new Uint8Array([1]));
    const w = workers[0]!;
    const id = w.lastId();
    client.supersedeAll();
    expect(await p).toEqual({ status: 'superseded' });
    expect(w.terminated).toBe(false);
    w.emit('message', openedMsg(id));
    expect(client.hasPending()).toBe(false);
    void client.open(new Uint8Array([1]));
    expect(workers).toHaveLength(1);
    expect(w.lastId()).toBeGreaterThan(id);
  });

  it('supersedes an older request of the same kind', async () => {
    const { client } = make();
    const p1 = client.exhume(0);
    const p2 = client.exhume(1);
    expect(await p1).toEqual({ status: 'superseded' });
    workers[0]!.emit('message', exhumedMsg(workers[0]!.lastId()));
    expect((await p2).status).toBe('ok');
  });

  it('dispose terminates the worker and settles pending requests', async () => {
    const { client } = make();
    const p = client.open(new Uint8Array([1]));
    client.dispose();
    expect(await p).toEqual({ status: 'superseded' });
    expect(workers[0]!.terminated).toBe(true);
  });
});
