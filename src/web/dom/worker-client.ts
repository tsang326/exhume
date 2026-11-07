// Worker client: owns the request ids, the timers and the worker's life cycle.
// It never reads a disk itself; it only moves validated messages to and from the worker.

import type { ExhumeRequest, ExhumedResponse, FailureCause, OpenedResponse, RequestKind } from '../logic/protocol';
import { EXHUME_TIMEOUT_MS, OPEN_TIMEOUT_MS } from '../logic/limits';
import { buildOpenMessage, createRequestTracker, kindOfResponse } from '../logic/requests';
import { parseResponse } from '../logic/validate';

export type LostReason = 'timeout' | 'worker-error' | 'cancelled';

export type Settled<T> =
  | { status: 'ok'; value: T }
  | { status: 'failed'; cause: FailureCause; error: string }
  | { status: 'lost'; reason: LostReason; message: string }
  | { status: 'superseded' };

export interface WorkerClient {
  open(held: Uint8Array): Promise<Settled<OpenedResponse>>;
  exhume(graveId: number): Promise<Settled<ExhumedResponse>>;
  /** Terminates the worker, makes every id stale and resolves pending requests as lost / cancelled. */
  cancel(): void;
  /** A new file was chosen: pending requests resolve as superseded, the worker is kept. */
  supersedeAll(): void;
  hasPending(): boolean;
  dispose(): void;
}

export interface WorkerClientOptions {
  /** Called each time the worker is replaced after a loss. */
  onLost?: (reason: LostReason, message: string) => void;
}

/** The one place that builds the real worker (the literal pattern the bundler needs). */
function defaultFactory(): Worker {
  return new Worker(new URL('../worker/disk.worker.ts', import.meta.url), { type: 'module' });
}

const LOST_MESSAGES: Record<LostReason, string> = {
  timeout: 'The disk reader took too long and was stopped. Reopen the disk to continue.',
  'worker-error': 'The disk reader stopped. Reopen the disk to continue.',
  cancelled: 'The request was cancelled. Reopen the disk to continue.',
};

interface Pending {
  kind: RequestKind;
  id: number;
  timer: ReturnType<typeof setTimeout>;
  settle: (s: Settled<never>) => void;
  accept: (value: OpenedResponse | ExhumedResponse) => Settled<never>;
}

export function createWorkerClient(factory: () => Worker = defaultFactory, options: WorkerClientOptions = {}): WorkerClient {
  const tracker = createRequestTracker();
  const pending = new Map<RequestKind, Pending>();
  let worker: Worker | null = null;
  let disposed = false;

  function clearPending(): Pending[] {
    const all = [...pending.values()];
    pending.clear();
    for (const p of all) clearTimeout(p.timer);
    return all;
  }

  function dropWorker(): void {
    const w = worker;
    worker = null;
    if (w !== null) {
      try {
        w.terminate();
      } catch {
        // The worker is gone either way.
      }
    }
  }

  function lose(reason: LostReason): void {
    dropWorker();
    tracker.supersedeAll();
    const all = clearPending();
    const message = LOST_MESSAGES[reason];
    for (const p of all) p.settle({ status: 'lost', reason, message });
    if (options.onLost !== undefined && (all.length > 0 || reason !== 'cancelled')) options.onLost(reason, message);
  }

  function onMessage(from: Worker, event: MessageEvent): void {
    if (from !== worker) return;
    const parsed = parseResponse(event.data);
    if (!parsed.ok) return;
    const res = parsed.value;
    if (!tracker.accept(res)) return;
    const p = pending.get(kindOfResponse(res));
    if (p === undefined || p.id !== res.id) return;
    pending.delete(p.kind);
    clearTimeout(p.timer);
    if (res.type === 'failed') {
      p.settle({ status: 'failed', cause: res.cause, error: res.error });
    } else {
      p.settle(p.accept(res));
    }
  }

  function ensureWorker(): Worker {
    if (worker !== null) return worker;
    const w = factory();
    worker = w;
    w.addEventListener('message', (e) => onMessage(w, e as MessageEvent));
    w.addEventListener('error', () => {
      if (w === worker) lose('worker-error');
    });
    w.addEventListener('messageerror', () => {
      if (w === worker) lose('worker-error');
    });
    return w;
  }

  function send<T extends OpenedResponse | ExhumedResponse>(
    kind: RequestKind,
    timeoutMs: number,
    build: (id: number) => { message: unknown; transfer: ArrayBuffer[] },
  ): Promise<Settled<T>> {
    if (disposed) return Promise.resolve({ status: 'superseded' });
    const earlier = pending.get(kind);
    if (earlier !== undefined) {
      pending.delete(kind);
      clearTimeout(earlier.timer);
      earlier.settle({ status: 'superseded' });
    }
    return new Promise<Settled<T>>((resolve) => {
      const id = tracker.begin(kind);
      const timer = setTimeout(() => lose('timeout'), timeoutMs);
      pending.set(kind, {
        kind,
        id,
        timer,
        settle: resolve as (s: Settled<never>) => void,
        accept: (value) => ({ status: 'ok', value: value as T }) as Settled<never>,
      });
      try {
        const w = ensureWorker();
        const { message, transfer } = build(id);
        w.postMessage(message, transfer);
      } catch {
        lose('worker-error');
      }
    });
  }

  return {
    open(held) {
      return send<OpenedResponse>('open', OPEN_TIMEOUT_MS, (id) => buildOpenMessage(held, id));
    },
    exhume(graveId) {
      return send<ExhumedResponse>('exhume', EXHUME_TIMEOUT_MS, (id) => {
        const message: ExhumeRequest = { type: 'exhume', id, graveId };
        return { message, transfer: [] };
      });
    },
    cancel() {
      lose('cancelled');
    },
    supersedeAll() {
      tracker.supersedeAll();
      for (const p of clearPending()) p.settle({ status: 'superseded' });
    },
    hasPending() {
      return pending.size > 0;
    },
    dispose() {
      disposed = true;
      tracker.supersedeAll();
      for (const p of clearPending()) p.settle({ status: 'superseded' });
      dropWorker();
    },
  };
}
