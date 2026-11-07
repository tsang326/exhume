import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { MAX_FILE_OUTPUT_BYTES, MAX_IMAGE_BYTES } from '../../core/fat12/index';
import { writeFat12Image } from '../../test-support/fat12';
import type { FileTree } from '../../test-support/fat12';
import { dirNoiseArb, fatNoiseArb, mutatedImageArb, targetedDefectArb } from '../../test-support/hostile';
import { numRuns } from '../../test-support/runs';
import { timed } from '../../test-support/timed';
import type { WorkerResponse } from '../logic/protocol';
import { parseResponse } from '../logic/validate';
import { createSession, handleRequest } from './disk-handler';
import type { WorkerSession } from './disk-handler';

const OPEN_BUDGET_MS = 5000;

// --- helpers ----------------------------------------------------------------

/** Times only the handler call; never throws on its own (the handler is total). */
function openTimed(session: WorkerSession, id: number, image: unknown): WorkerResponse {
  return timed(() => handleRequest(session, { type: 'open', id, image }), OPEN_BUDGET_MS);
}

function checkWellFormed(res: WorkerResponse): void {
  expect(parseResponse(res).ok).toBe(true);
  // Plain data only: it must survive a structured clone, like a postMessage.
  expect(() => structuredClone(res)).not.toThrow();
}

/** Exhumes every grave of the open disk; each must answer once, well formed, within the byte cap. */
function exhumeAll(session: WorkerSession, firstId: number): void {
  const files = session.handle?.report.files ?? [];
  let id = firstId;
  for (const grave of files) {
    const res = handleRequest(session, { type: 'exhume', id, graveId: grave.id });
    expect(parseResponse(res).ok).toBe(true);
    expect(res.id).toBe(id);
    if (res.type === 'exhumed') {
      expect(res.graveId).toBe(grave.id);
      expect(res.raw.length).toBeLessThanOrEqual(MAX_FILE_OUTPUT_BYTES);
    } else {
      expect(res.type).toBe('failed');
    }
    id++;
  }
}

// A valid disk whose names, label and contents hold markup and control characters.
const MARKUP = '<script>alert(1)</script><img src=x onerror=alert(1)>"\'&';
const CONTROL = '\u0000\u0007\u001b[31m\r\n\u007f\u202e';
const enc = (s: string): Uint8Array => Uint8Array.from(Array.from(s, (c) => c.charCodeAt(0) & 0xff));

const hostileTree: FileTree = {
  volumeLabel: '<b>&"\u0007\u001b',
  children: [
    { kind: 'file', name: 'NOTE.WS', longName: `${MARKUP}.ws`, content: enc(`${MARKUP}${CONTROL}`) },
    { kind: 'file', name: 'DATA.CSV', longName: `<i>${CONTROL}.csv`, content: enc(`a,b\n${MARKUP},"${CONTROL}"\n`) },
    { kind: 'file', name: 'DATA.DBF', content: enc(`${MARKUP}${CONTROL}`) },
    { kind: 'file', name: 'PIC.PCX', content: enc(`${MARKUP}${CONTROL}`) },
    { kind: 'file', name: 'MISC.BIN', content: enc(CONTROL) },
    { kind: 'directory', name: 'SUB', longName: `<dir>${CONTROL}`, children: [{ kind: 'file', name: 'IN.BIN', content: enc(MARKUP) }] },
  ],
};
const hostileDisk = writeFat12Image(hostileTree, '1440K');

// --- examples ---------------------------------------------------------------

describe('hostile files through the worker handler', () => {
  it('answers an empty file and a 1 byte file with a well-formed opened response', () => {
    for (const image of [new Uint8Array(0), Uint8Array.from([0x55])]) {
      const session = createSession();
      const res = openTimed(session, 1, image);
      checkWellFormed(res);
      expect(res.type).toBe('opened');
      if (res.type === 'opened') {
        expect(res.id).toBe(1);
        expect(res.report.volume.geometrySource).toBe('none');
        expect(res.report.files).toEqual([]);
      }
    }
  });

  it('opens an image of exactly MAX_IMAGE_BYTES and one byte over without crashing', () => {
    // Two single bounded cases, not a loop over sizes.
    const exact = new Uint8Array(MAX_IMAGE_BYTES);
    exact.set(hostileDisk, 0);
    const resExact = openTimed(createSession(), 1, exact);
    checkWellFormed(resExact);
    expect(resExact.type).toBe('opened');

    const over = new Uint8Array(MAX_IMAGE_BYTES + 1);
    const sessionOver = createSession();
    const resOver = openTimed(sessionOver, 2, over);
    checkWellFormed(resOver);
    expect(resOver.type).toBe('opened');
    if (resOver.type === 'opened') expect(resOver.report.files).toEqual([]);
  });

  it('rejects wrong-type images as invalid-request without touching the session', () => {
    const wrong: unknown[] = [
      'not bytes',
      42,
      null,
      undefined,
      [1, 2, 3],
      {},
      new ArrayBuffer(16),
      new Uint16Array(8),
      new DataView(new ArrayBuffer(8)),
    ];
    const session = createSession();
    for (const image of wrong) {
      const res = openTimed(session, 7, image);
      checkWellFormed(res);
      expect(res).toMatchObject({ type: 'failed', id: 0, request: 'open', cause: 'invalid-request' });
      expect(session.handle).toBeNull();
    }
  });

  it('keeps markup and control characters as plain strings and exhumes every grave', () => {
    const session = createSession();
    const res = openTimed(session, 1, hostileDisk.slice());
    checkWellFormed(res);
    expect(res.type).toBe('opened');
    if (res.type !== 'opened') return;
    expect(res.report.files.length).toBeGreaterThan(0);
    expect(typeof res.report.volume.label).toBe('string');
    for (const f of res.report.files) expect(typeof f.path).toBe('string');
    exhumeAll(session, 2);
  });

  it('answers every truncation point of a hostile disk with one well-formed response', () => {
    // Bounded: a fixed handful of cut points, each opened once.
    const cuts = [0, 1, 511, 512, 513, 1024, 4096, 9728, 20000, hostileDisk.length - 1];
    for (const len of cuts) {
      const session = createSession();
      const res = openTimed(session, 1, hostileDisk.slice(0, len));
      checkWellFormed(res);
      expect(res.type).toBe('opened');
      exhumeAll(session, 2);
    }
  });
});

// --- properties -------------------------------------------------------------

describe('hostile worker properties', () => {
  it('random bytes open without a crash and report no geometry', () => {
    // Feature: graveyard-ui, Property 11 (hostile): random bytes always answer once
    // **Validates: Requirements 3.9, 3.10, 3.11, 14.2, 14.4**
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 1024 }), (bytes) => {
        const session = createSession();
        const res = openTimed(session, 1, bytes.slice());
        if (!parseResponse(res).ok) return false;
        if (res.type === 'failed') return true;
        // Under 1 KiB nothing matches a floppy geometry, so the source is 'none'.
        return res.type === 'opened' && res.id === 1 && res.report.volume.geometrySource === 'none';
      }),
      { numRuns: numRuns(50) },
    );
  });

  it('hostile generated disks open and exhume within bounds', () => {
    // Feature: graveyard-ui, Property 12 (hostile): every exhume answers once within the byte cap
    // **Validates: Requirements 3.9, 3.10, 14.3, 14.4, 14.6**
    const images = fc.oneof(mutatedImageArb, fatNoiseArb, dirNoiseArb, targetedDefectArb);
    fc.assert(
      fc.property(images, (h) => {
        const session = createSession();
        const res = openTimed(session, 1, h.image.slice());
        if (!parseResponse(res).ok || res.type !== 'opened' || res.id !== 1) return false;
        const files = session.handle?.report.files ?? [];
        let id = 2;
        for (const grave of files.slice(0, 64)) {
          const r = handleRequest(session, { type: 'exhume', id, graveId: grave.id });
          if (!parseResponse(r).ok || r.id !== id) return false;
          if (r.type === 'exhumed' && r.raw.length > MAX_FILE_OUTPUT_BYTES) return false;
          if (r.type === 'exhumed' && r.graveId !== grave.id) return false;
          id++;
        }
        return true;
      }),
      { numRuns: numRuns(25) },
    );
  });

  it('truncated copies of a markup-laden disk always answer once', () => {
    // Feature: graveyard-ui, Property 11 (hostile): truncated disks always answer once
    // **Validates: Requirements 3.9, 3.11, 14.2, 14.4**
    fc.assert(
      fc.property(fc.integer({ min: 0, max: hostileDisk.length }), (len) => {
        const session = createSession();
        const res = openTimed(session, 1, hostileDisk.slice(0, len));
        return parseResponse(res).ok && res.type === 'opened' && res.id === 1;
      }),
      { numRuns: numRuns(25) },
    );
  });
});
