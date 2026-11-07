import type { OpenRequest, RequestKind, WorkerResponse } from './protocol';

export interface RequestTracker {
  /** New id greater than every earlier id; marks it latest for `kind`. */
  begin(kind: RequestKind): number;
  /** True only if `res.id` is the latest id issued for its kind. */
  accept(res: WorkerResponse): boolean;
  /** Latest id for `kind`, or -1 when none is pending. */
  latest(kind: RequestKind): number;
  /** Makes every earlier response stale. The counter keeps growing. */
  supersedeAll(): void;
}

export function kindOfResponse(res: WorkerResponse): RequestKind {
  switch (res.type) {
    case 'opened':
      return 'open';
    case 'exhumed':
      return 'exhume';
    case 'failed':
      return res.request;
  }
}

export function isCurrent(latest: Readonly<Record<RequestKind, number>>, res: WorkerResponse): boolean {
  return res.id === latest[kindOfResponse(res)];
}

export function createRequestTracker(): RequestTracker {
  let counter = 0;
  const latest: Record<RequestKind, number> = { open: -1, exhume: -1 };
  return {
    begin(kind) {
      counter += 1;
      latest[kind] = counter;
      return counter;
    },
    accept(res) {
      return isCurrent(latest, res);
    },
    latest(kind) {
      return latest[kind];
    },
    supersedeAll() {
      latest.open = -1;
      latest.exhume = -1;
    },
  };
}

/** Copies `held` so the main-thread bytes survive the transfer, and lists the copy's buffer. */
export function buildOpenMessage(held: Uint8Array, id: number): { message: OpenRequest; transfer: ArrayBuffer[] } {
  const image = held.slice();
  return { message: { type: 'open', id, image }, transfer: [image.buffer as ArrayBuffer] };
}

/** Distinct, whole-buffer ArrayBuffers behind every Uint8Array in a response. */
export function transferablesOf(res: WorkerResponse): ArrayBuffer[] {
  const arrays: Uint8Array[] = [];
  if (res.type === 'exhumed') {
    arrays.push(res.raw);
    if (res.result.kind === 'png') arrays.push(res.result.png);
  }
  const out: ArrayBuffer[] = [];
  for (const a of arrays) {
    const buf = a.buffer as ArrayBuffer;
    if (a.byteOffset === 0 && a.byteLength === buf.byteLength && !out.includes(buf)) out.push(buf);
  }
  return out;
}
