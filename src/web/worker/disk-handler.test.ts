import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { openDisk, MAX_FILE_OUTPUT_BYTES, MAX_IMAGE_BYTES } from '../../core/fat12/index';
import type { DiskHandle } from '../../core/fat12/index';
import { encodePcx, writeDbf, writeWordStar } from '../../test-support/formats';
import { writeFat12Image } from '../../test-support/fat12';
import type { FileTree } from '../../test-support/fat12';
import { numRuns } from '../../test-support/runs';
import type { WorkerResponse } from '../logic/protocol';
import { parseResponse } from '../logic/validate';
import { createSession, handleRequest } from './disk-handler';
import type { WorkerSession } from './disk-handler';

// --- fixtures ---------------------------------------------------------------

const wordstar = writeWordStar([{ spans: [{ text: 'Hello', styles: ['bold'] }, { text: ' world' }] }]);
const dbase = writeDbf({
  fields: [{ name: 'NAME', type: 'C', length: 5, decimals: 0 }],
  records: [{ deleted: false, values: [Uint8Array.from([0x41, 0x42, 0x20, 0x20, 0x20])] }],
});
const pcx = encodePcx({
  mode: 'mono',
  width: 8,
  height: 2,
  indices: Uint8Array.from([0, 1, 0, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 0]),
});
const unknown = Uint8Array.from([0x00, 0x01, 0x02, 0x03, 0xfe, 0xff, 0x10, 0x20]);

const tree: FileTree = {
  volumeLabel: 'TESTDISK',
  children: [
    { kind: 'file', name: 'DOC.WS', content: wordstar },
    { kind: 'file', name: 'DATA.DBF', content: dbase },
    { kind: 'file', name: 'PIC.PCX', content: pcx },
    { kind: 'file', name: 'MISC.BIN', content: unknown },
    { kind: 'file', name: 'EMPTY.TXT', content: new Uint8Array(0) },
    { kind: 'file', name: 'NOTE.TXT', content: Uint8Array.from([0x48, 0x69, 0x0d, 0x0a, 0x79, 0x6f, 0x75]) },
    { kind: 'file', name: 'GONE.WS', content: wordstar, deleted: true },
    { kind: 'directory', name: 'SUB', children: [{ kind: 'file', name: 'INNER.BIN', content: unknown }] },
  ],
};

const disk = writeFat12Image(tree, '1440K');
const overCap = new Uint8Array(MAX_IMAGE_BYTES + 1);
const diskReport = openDisk(disk).report;

type Expected = 'markdown' | 'csv' | 'png' | 'raw' | 'text';
const expectedKinds: Record<string, Expected> = {
  '/DOC.WS': 'markdown',
  '/DATA.DBF': 'csv',
  '/PIC.PCX': 'png',
  '/NOTE.TXT': 'text',
  '/MISC.BIN': 'raw',
  '/SUB/INNER.BIN': 'raw',
};

function ask(session: WorkerSession, raw: unknown): WorkerResponse {
  return handleRequest(session, raw);
}

function wellFormed(res: WorkerResponse): boolean {
  return parseResponse(res).ok;
}

// --- examples ---------------------------------------------------------------

describe('handleRequest examples', () => {
  it('answers exhume with no-disk before any open', () => {
    const res = ask(createSession(), { type: 'exhume', id: 1, graveId: 0 });
    expect(res).toMatchObject({ type: 'failed', id: 1, request: 'exhume', cause: 'no-disk' });
  });

  it('opens a disk and maps each file kind', () => {
    const session = createSession();
    const opened = ask(session, { type: 'open', id: 1, image: disk.slice() });
    expect(opened.type).toBe('opened');
    expect(session.handle).not.toBeNull();
    let seen = 0;
    for (const grave of diskReport.files) {
      const want = expectedKinds[grave.path];
      if (want === undefined) continue;
      const res = ask(session, { type: 'exhume', id: 2 + grave.id, graveId: grave.id });
      expect(res.type).toBe('exhumed');
      if (res.type === 'exhumed') {
        expect(res.result.kind).toBe(want);
        expect(res.graveId).toBe(grave.id);
      }
      seen++;
    }
    expect(seen).toBe(Object.keys(expectedKinds).length);
  });

  it('answers a malformed request with id 0 and invalid-request', () => {
    const session = createSession();
    const res = ask(session, { type: 'nope' });
    expect(res).toMatchObject({ type: 'failed', id: 0, cause: 'invalid-request' });
    expect(session.handle).toBeNull();
  });

  it('treats an over-cap image as a successful open with an empty report', () => {
    const session = createSession();
    const res = ask(session, { type: 'open', id: 3, image: overCap });
    expect(res.type).toBe('opened');
    if (res.type === 'opened') expect(res.report.files).toEqual([]);
  });
});

// --- Property 11 ------------------------------------------------------------

type Op =
  | { k: 'disk' }
  | { k: 'random'; bytes: Uint8Array }
  | { k: 'empty' }
  | { k: 'truncated'; len: number }
  | { k: 'over' }
  | { k: 'exhume'; graveId: number }
  | { k: 'garbage'; value: unknown };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  fc.constant<Op>({ k: 'disk' }),
  fc.uint8Array({ maxLength: 2048 }).map((bytes): Op => ({ k: 'random', bytes })),
  fc.constant<Op>({ k: 'empty' }),
  fc.integer({ min: 0, max: disk.length - 1 }).map((len): Op => ({ k: 'truncated', len })),
  fc.constant<Op>({ k: 'over' }),
  fc.integer({ min: -3, max: 40 }).map((graveId): Op => ({ k: 'exhume', graveId })),
  fc.anything().map((value): Op => ({ k: 'garbage', value })),
);

function imageFor(op: Op): Uint8Array | null {
  switch (op.k) {
    case 'disk':
      return disk.slice();
    case 'random':
      return op.bytes.slice();
    case 'empty':
      return new Uint8Array(0);
    case 'truncated':
      return disk.slice(0, op.len);
    case 'over':
      return overCap;
    default:
      return null;
  }
}

/** Runs a sequence against a fresh session and checks the model; true when all hold. */
function sequenceHolds(ops: Op[]): boolean {
  const session = createSession();
  let count: number | null = null; // grave count of the model's current disk
  let nextId = 1;
  for (const op of ops) {
    const before: DiskHandle | null = session.handle;
    if (op.k === 'garbage') {
      const res = handleRequest(session, op.value);
      if (!wellFormed(res) || res.type !== 'failed' || res.cause !== 'invalid-request') return false;
      if (res.id !== 0 || session.handle !== before) return false;
      continue;
    }
    const id = nextId++;
    if (op.k === 'exhume') {
      const res = handleRequest(session, { type: 'exhume', id, graveId: op.graveId });
      if (!wellFormed(res) || session.handle !== before) return false;
      if (op.graveId < 0) {
        // Rejected by request validation: reserved id 0.
        if (res.type !== 'failed' || res.cause !== 'invalid-request' || res.id !== 0) return false;
        continue;
      }
      if (res.id !== id) return false;
      if (count === null) {
        if (res.type !== 'failed' || res.cause !== 'no-disk') return false;
      } else if (op.graveId < 0 || op.graveId >= count) {
        if (res.type !== 'failed' || res.cause !== 'not-found') return false;
      } else if (res.type === 'failed') {
        if (res.cause !== 'read') return false;
      } else if (res.type !== 'exhumed' || res.graveId !== op.graveId) {
        return false;
      }
      continue;
    }
    const image = imageFor(op);
    if (image === null) return false;
    const reference = openDisk(image.slice()).report;
    const res = handleRequest(session, { type: 'open', id, image });
    if (!wellFormed(res) || res.type !== 'opened' || res.id !== id) return false;
    if (session.handle === null || session.handle === before) return false;
    if (JSON.stringify(res.report) !== JSON.stringify(reference)) return false;
    count = reference.files.length;
  }
  return true;
}

describe('worker handler properties', () => {
  it('Property 11: The worker keeps one handle and always answers once', () => {
    // Feature: graveyard-ui, Property 11: The worker keeps one handle and always answers once
    // **Validates: Requirements 3.9, 3.10, 3.11, 14.4**
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 1, maxLength: 6 }), (ops) => sequenceHolds(ops)),
      { numRuns: numRuns(100) },
    );
  });

  it('Property 12: Exhume is bounded and safe for every id', () => {
    // Feature: graveyard-ui, Property 12: Exhume is bounded and safe for every id
    // **Validates: Requirements 3.9, 3.10, 14.3, 14.6**
    const session = createSession();
    const opened = handleRequest(session, { type: 'open', id: 1, image: disk.slice() });
    expect(opened.type).toBe('opened');
    const handle = session.handle as DiskHandle;
    const files = handle.report.files;
    let nextId = 2;

    fc.assert(
      fc.property(fc.integer({ min: -5, max: files.length + 10 }), (graveId) => {
        const id = nextId++;
        const res = handleRequest(session, { type: 'exhume', id, graveId });
        if (!wellFormed(res) || session.handle !== handle) return false;
        if (graveId < 0) return res.type === 'failed' && res.cause === 'invalid-request' && res.id === 0;
        if (res.id !== id) return false;
        if (graveId >= files.length) {
          return res.type === 'failed' && res.cause === 'not-found';
        }
        const grave = files[graveId];
        if (grave === undefined) return false;
        const direct = handle.readBytes(grave);
        if (!direct.ok) return res.type === 'failed' && res.cause === 'read' && res.error === direct.error;
        if (res.type !== 'exhumed' || res.graveId !== graveId) return false;
        if (res.raw.length > MAX_FILE_OUTPUT_BYTES || res.raw.length !== direct.bytes.length) return false;
        for (let i = 0; i < res.raw.length; i++) if (res.raw[i] !== direct.bytes[i]) return false;
        if (res.raw.byteOffset !== 0 || res.raw.buffer.byteLength !== res.raw.length) return false;
        const want = expectedKinds[grave.path];
        if (want !== undefined && res.result.kind !== want) return false;
        if (grave.size === 0 && res.result.kind !== 'raw' && res.result.kind !== 'text') return false;
        if (res.result.kind === 'png') {
          const png = res.result.png;
          if (png.byteOffset !== 0 || png.buffer.byteLength !== png.length) return false;
        }
        return true;
      }),
      { numRuns: numRuns(100) },
    );
  });
});
