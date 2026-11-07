import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createRequestTracker, buildOpenMessage, transferablesOf, kindOfResponse } from './requests';
import type { RequestKind, WorkerResponse } from './protocol';
import { numRuns } from '../../test-support/runs';

type Op = { op: 'begin'; kind: RequestKind } | { op: 'supersede' };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.constantFrom<RequestKind>('open', 'exhume').map((kind): Op => ({ op: 'begin', kind })),
  fc.constant<Op>({ op: 'supersede' }),
);

function responseFor(kind: RequestKind, id: number): WorkerResponse {
  return { type: 'failed', id, request: kind, cause: 'internal', error: 'x' };
}

describe('request tracker', () => {
  it('starts ids at 1 and rejects stale responses', () => {
    const t = createRequestTracker();
    const a = t.begin('open');
    const b = t.begin('open');
    expect(a).toBe(1);
    expect(t.accept(responseFor('open', a))).toBe(false);
    expect(t.accept(responseFor('open', b))).toBe(true);
    expect(t.accept(responseFor('exhume', b))).toBe(false);
    expect(kindOfResponse(responseFor('exhume', 3))).toBe('exhume');
  });

  // Feature: graveyard-ui, Property 9: Request ids only grow and only the latest response is accepted
  it('Property 9: ids only grow and only the latest response is accepted', () => {
    // **Validates: Requirements 3.5, 3.6, 3.8, 3.15**
    fc.assert(
      fc.property(fc.array(opArb, { maxLength: 60 }), (ops) => {
        const t = createRequestTracker();
        const model: Record<RequestKind, number> = { open: -1, exhume: -1 };
        const issued: number[] = [];
        let prev = 0;
        for (const o of ops) {
          if (o.op === 'begin') {
            const id = t.begin(o.kind);
            if (id <= prev) return false;
            prev = id;
            issued.push(id);
            model[o.kind] = id;
          } else {
            t.supersedeAll();
            model.open = -1;
            model.exhume = -1;
          }
        }
        for (const kind of ['open', 'exhume'] as const) {
          if (t.latest(kind) !== model[kind]) return false;
          for (const id of [0, ...issued, prev + 1]) {
            if (t.accept(responseFor(kind, id)) !== (id === model[kind])) return false;
          }
        }
        return true;
      }),
      { numRuns: numRuns(100) },
    );
  });
});

describe('open messages and transfer', () => {
  it('copies before transferring', () => {
    const held = new Uint8Array([1, 2, 3]);
    const { message, transfer } = buildOpenMessage(held, 7);
    expect(message.id).toBe(7);
    expect(message.image).toEqual(held);
    expect(message.image.buffer).not.toBe(held.buffer);
    expect(transfer).toEqual([message.image.buffer]);
  });

  // Feature: graveyard-ui, Property 10: Open messages copy before they transfer
  it('Property 10: open messages copy before they transfer', () => {
    // **Validates: Requirements 3.5, 3.6, 3.8, 3.15**
    const bytes = fc.uint8Array({ maxLength: 512 });
    fc.assert(
      fc.property(bytes, bytes, fc.nat({ max: 1000 }), (held, other, id) => {
        const before = Array.from(held);
        const { message, transfer } = buildOpenMessage(held, id);
        const copyOk =
          message.image.length === held.length &&
          before.every((v, i) => message.image[i] === v) &&
          message.image.buffer !== held.buffer &&
          transfer.length === 1 &&
          transfer[0] === message.image.buffer &&
          held.length === before.length &&
          before.every((v, i) => held[i] === v) &&
          held.buffer.byteLength >= held.length;

        const res: WorkerResponse = {
          type: 'exhumed',
          id,
          graveId: 0,
          raw: held.slice(),
          readWarnings: [],
          result: { kind: 'png', png: other.slice(), warnings: [] },
        };
        const bufs = transferablesOf(res);
        const distinct = new Set(bufs).size === bufs.length;
        const whole = bufs.every(
          (b) => b === res.raw.buffer || (res.result.kind === 'png' && b === res.result.png.buffer),
        );
        const full = bufs.length === 2;
        return copyOk && distinct && whole && full;
      }),
      { numRuns: numRuns(100) },
    );
  });

  it('lists nothing for responses without bytes and skips partial views', () => {
    expect(transferablesOf(responseFor('open', 1))).toEqual([]);
    const big = new Uint8Array(16);
    const res: WorkerResponse = {
      type: 'exhumed',
      id: 1,
      graveId: 0,
      raw: big.subarray(2, 8),
      readWarnings: [],
      result: { kind: 'raw', error: 'e', warnings: [] },
    };
    expect(transferablesOf(res)).toEqual([]);
  });
});
