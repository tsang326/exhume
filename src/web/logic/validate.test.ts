import { isDeepStrictEqual } from 'node:util';
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { numRuns } from '../../test-support/runs';
import {
  GeometrySource,
  GraveKind,
  GraveState,
  MAX_TOTAL_ENTRIES,
  WarningCode,
} from '../../core/fat12/index';
import { ConversionWarningCode } from '../../core/formats/index';
import type { WorkerRequest, WorkerResponse } from './protocol';
import { isRequestId, parseRequest, parseResponse } from './validate';

// ---------- generators ----------

const idArb = fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER });
const u32Arb = fc.integer({ min: 0, max: 4_294_967_295 });
const bytesArb = fc.uint8Array({ maxLength: 64 });

const warningArb = fc.record(
  {
    code: fc.constantFrom(...Object.values(WarningCode)),
    message: fc.string(),
    path: fc.string(),
  },
  { requiredKeys: ['code', 'message'] },
);

const convWarningArb = fc.record({
  code: fc.constantFrom(...Object.values(ConversionWarningCode)),
  message: fc.string(),
});

const graveArb = fc.record(
  {
    id: fc.nat({ max: MAX_TOTAL_ENTRIES }),
    path: fc.string(),
    size: u32Arb,
    date: fc.option(fc.string(), { nil: null }),
    state: fc.constantFrom(...Object.values(GraveState)),
    kind: fc.constantFrom(...Object.values(GraveKind)),
    reason: fc.string(),
    attributes: fc.record({
      readOnly: fc.boolean(),
      hidden: fc.boolean(),
      system: fc.boolean(),
      archive: fc.boolean(),
    }),
    startCluster: fc.nat({ max: 65_535 }),
  },
  { requiredKeys: ['id', 'path', 'size', 'date', 'state', 'kind', 'attributes', 'startCluster'] },
);

const geometryArb = fc.record({
  bytesPerSector: fc.nat({ max: 4096 }),
  sectorsPerCluster: fc.nat({ max: 128 }),
  reservedSectors: fc.nat({ max: 64 }),
  fatCount: fc.nat({ max: 4 }),
  rootEntryCount: fc.nat({ max: 1024 }),
  totalSectors: fc.nat({ max: 100_000 }),
  sectorsPerFat: fc.nat({ max: 256 }),
  mediaDescriptor: fc.nat({ max: 255 }),
  dataClusters: fc.nat({ max: 4096 }),
});

const reportArb = fc.record({
  volume: fc.record({
    label: fc.string(),
    geometrySource: fc.constantFrom(...Object.values(GeometrySource)),
    geometry: fc.option(geometryArb, { nil: null }),
  }),
  files: fc.array(graveArb, { maxLength: 6 }),
  warnings: fc.array(warningArb, { maxLength: 4 }),
});

const resultArb = fc.oneof(
  fc.record({
    kind: fc.constantFrom('markdown' as const, 'csv' as const),
    text: fc.string(),
    warnings: fc.array(convWarningArb, { maxLength: 3 }),
  }),
  fc.record({
    kind: fc.constant('png' as const),
    png: bytesArb,
    warnings: fc.array(convWarningArb, { maxLength: 3 }),
  }),
  fc.record({
    kind: fc.constant('raw' as const),
    error: fc.string(),
    warnings: fc.array(convWarningArb, { maxLength: 3 }),
  }),
);

const requestArb: fc.Arbitrary<WorkerRequest> = fc.oneof(
  fc.record({ type: fc.constant('open' as const), id: idArb, image: bytesArb }),
  fc.record({ type: fc.constant('exhume' as const), id: idArb, graveId: idArb }),
);

const responseArb: fc.Arbitrary<WorkerResponse> = fc.oneof(
  fc.record({ type: fc.constant('opened' as const), id: idArb, report: reportArb }),
  fc.record({
    type: fc.constant('exhumed' as const),
    id: idArb,
    graveId: idArb,
    raw: bytesArb,
    readWarnings: fc.array(warningArb, { maxLength: 4 }),
    result: resultArb,
  }),
  fc.record({
    type: fc.constant('failed' as const),
    id: idArb,
    request: fc.constantFrom('open' as const, 'exhume' as const),
    cause: fc.constantFrom(
      'no-disk' as const,
      'not-found' as const,
      'read' as const,
      'invalid-request' as const,
      'internal' as const,
    ),
    error: fc.string(),
  }),
);

/** Awkward values for any field position. */
const junkArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.constantFrom(
    undefined,
    null,
    NaN,
    Infinity,
    -Infinity,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    '',
    'x',
    true,
    [],
    {},
    () => 1,
  ),
  fc.anything(),
);

const badIdArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.constantFrom(
    undefined,
    null,
    NaN,
    Infinity,
    -Infinity,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    '1',
    {},
  ),
  fc.double({ noInteger: true, noNaN: true }),
  fc.integer({ min: -1_000_000, max: -1 }),
);

// ---------- helpers (no expect inside property callbacks) ----------

type Mutable = Record<string, unknown>;

function isUnionMember(v: unknown): boolean {
  if (typeof v !== 'object' || v === null) return false;
  const m = v as Mutable;
  return (
    ['open', 'exhume', 'opened', 'exhumed', 'failed'].includes(m.type as string) &&
    isRequestId(m.id)
  );
}

/** Parses both ways; true when neither throws and any ok=true value is a union member. */
function totalOn(raw: unknown): boolean {
  try {
    const r = parseResponse(raw);
    const q = parseRequest(raw);
    const okR = r.ok ? isUnionMember(r.value) : typeof r.reason === 'string';
    const okQ = q.ok ? isUnionMember(q.value) : typeof q.reason === 'string';
    return okR && okQ;
  } catch {
    return false;
  }
}

function withField(base: unknown, key: string, value: unknown): unknown {
  return { ...(base as Mutable), [key]: value };
}

function withThrowingGetter(base: unknown, key: string): unknown {
  const copy: Mutable = { ...(base as Mutable) };
  Object.defineProperty(copy, key, {
    enumerable: true,
    get() {
      throw new Error('boom');
    },
  });
  return copy;
}

function parseBoth(msg: WorkerRequest | WorkerResponse): boolean {
  try {
    // fc.record may build null-prototype objects; normalise to plain objects first.
    const plain: WorkerRequest | WorkerResponse = structuredClone(msg);
    const clone: unknown = structuredClone(plain);
    if (!isDeepStrictEqual(clone, plain)) return false;
    const parsed =
      plain.type === 'open' || plain.type === 'exhume'
        ? parseRequest(clone)
        : parseResponse(clone);
    return parsed.ok && isDeepStrictEqual(parsed.value, plain);
  } catch {
    return false;
  }
}

function rejected(parsed: { ok: boolean }): boolean {
  return parsed.ok === false;
}

// ---------- tests ----------

describe('validate: examples', () => {
  it('accepts reserved id 0 for failed / invalid-request', () => {
    const msg: WorkerResponse = {
      type: 'failed',
      id: 0,
      request: 'open',
      cause: 'invalid-request',
      error: 'bad request',
    };
    expect(parseResponse(msg)).toEqual({ ok: true, value: msg });
  });

  it('rejects primitives, arrays and unknown types', () => {
    for (const v of [undefined, null, 1, 'x', [], {}, { type: 'nope', id: 1 }]) {
      expect(parseResponse(v).ok).toBe(false);
      expect(parseRequest(v).ok).toBe(false);
    }
  });

  it('rejects bad ids', () => {
    const base = { type: 'exhume', graveId: 0 };
    for (const id of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', undefined]) {
      expect(parseRequest({ ...base, id }).ok).toBe(false);
    }
    expect(parseRequest({ ...base, id: 0 }).ok).toBe(true);
    expect(parseRequest({ ...base, id: Number.MAX_SAFE_INTEGER }).ok).toBe(true);
  });

  it('rejects a report with more graves than MAX_TOTAL_ENTRIES', () => {
    const grave = {
      id: 0,
      path: '/A',
      size: 0,
      date: null,
      state: 'alive',
      kind: 'file',
      attributes: { readOnly: false, hidden: false, system: false, archive: false },
      startCluster: 0,
    };
    const report = (n: number) => ({
      volume: { label: '', geometrySource: 'none', geometry: null },
      files: Array.from({ length: n }, () => grave),
      warnings: [],
    });
    expect(parseResponse({ type: 'opened', id: 1, report: report(MAX_TOTAL_ENTRIES) }).ok).toBe(
      true,
    );
    expect(
      parseResponse({ type: 'opened', id: 1, report: report(MAX_TOTAL_ENTRIES + 1) }).ok,
    ).toBe(false);
  });

  it('rejects a bad grave field (size above 4,294,967,295, unknown state)', () => {
    const grave = {
      id: 0,
      path: '/A',
      size: 4_294_967_296,
      date: null,
      state: 'alive',
      kind: 'file',
      attributes: { readOnly: false, hidden: false, system: false, archive: false },
      startCluster: 0,
    };
    const msg = (g: unknown) => ({
      type: 'opened',
      id: 1,
      report: {
        volume: { label: '', geometrySource: 'bpb', geometry: null },
        files: [g],
        warnings: [],
      },
    });
    expect(parseResponse(msg(grave)).ok).toBe(false);
    expect(parseResponse(msg({ ...grave, size: 1, state: 'zombie' })).ok).toBe(false);
    expect(parseResponse(msg({ ...grave, size: 1 })).ok).toBe(true);
  });

  it('does not throw on a throwing getter', () => {
    const o = {};
    Object.defineProperty(o, 'type', {
      get() {
        throw new Error('boom');
      },
    });
    expect(parseResponse(o).ok).toBe(false);
    expect(parseRequest(o).ok).toBe(false);
  });
});

describe('validate: properties', () => {
  // Feature: graveyard-ui, Property 7: Response validation is total
  // **Validates: Requirements 3.7, 3.18**
  it('Property 7: Response validation is total', () => {
    // Arbitrary values.
    fc.assert(fc.property(fc.anything(), (v) => totalOn(v)), { numRuns: numRuns(200) });
    fc.assert(fc.property(junkArb, (v) => totalOn(v)), { numRuns: numRuns(100) });

    // Valid messages with one field replaced by junk: never throws.
    fc.assert(
      fc.property(responseArb, fc.constantFrom('type', 'id', 'report', 'raw', 'result', 'graveId', 'error', 'request', 'cause', 'readWarnings'), junkArb, (msg, key, junk) =>
        totalOn(withField(msg, key, junk)),
      ),
      { numRuns: numRuns(200) },
    );
    fc.assert(
      fc.property(requestArb, fc.constantFrom('type', 'id', 'image', 'graveId'), junkArb, (msg, key, junk) =>
        totalOn(withField(msg, key, junk)),
      ),
      { numRuns: numRuns(100) },
    );

    // Bad ids are always rejected, for every message type.
    fc.assert(
      fc.property(responseArb, badIdArb, (msg, id) =>
        rejected(parseResponse(withField(msg, 'id', id))),
      ),
      { numRuns: numRuns(100) },
    );
    fc.assert(
      fc.property(requestArb, badIdArb, (msg, id) =>
        rejected(parseRequest(withField(msg, 'id', id))),
      ),
      { numRuns: numRuns(100) },
    );

    // Throwing getters: never throws, and the message is rejected.
    fc.assert(
      fc.property(responseArb, (msg) => {
        const keys = Object.keys(msg);
        return keys.every((k) => {
          const raw = withThrowingGetter(msg, k);
          return totalOn(raw) && rejected(parseResponse(raw));
        });
      }),
      { numRuns: numRuns(100) },
    );
    fc.assert(
      fc.property(requestArb, (msg) => {
        const keys = Object.keys(msg);
        return keys.every((k) => {
          const raw = withThrowingGetter(msg, k);
          return totalOn(raw) && rejected(parseRequest(raw));
        });
      }),
      { numRuns: numRuns(100) },
    );
  });

  // Feature: graveyard-ui, Property 8: Valid messages survive validation and structured cloning
  // **Validates: Requirements 3.3, 3.4, 3.7, 3.18**
  it('Property 8: Valid messages survive validation and structured cloning', () => {
    fc.assert(fc.property(requestArb, (msg) => parseBoth(msg)), { numRuns: numRuns(200) });
    fc.assert(fc.property(responseArb, (msg) => parseBoth(msg)), { numRuns: numRuns(200) });
  });
});
