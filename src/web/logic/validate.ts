import {
  GeometrySource,
  GraveKind,
  GraveState,
  MAX_TOTAL_ENTRIES,
  WarningCode,
} from '../../core/fat12/index';
import type { Grave, GeometryInfo, Volume, Warning, DiskReport } from '../../core/fat12/index';
import { ConversionWarningCode } from '../../core/formats/index';
import type { ConversionWarning } from '../../core/formats/index';
import type {
  ExhumeResult,
  FailureCause,
  RequestKind,
  WorkerRequest,
  WorkerResponse,
} from './protocol';

export type Parsed<T> = { ok: true; value: T } | { ok: false; reason: string };

/** Upper bound on warnings accepted in one message. */
export const MAX_MESSAGE_WARNINGS = 10_000;

const MAX_U32 = 4_294_967_295;

const GRAVE_STATES: readonly string[] = Object.values(GraveState);
const GRAVE_KINDS: readonly string[] = Object.values(GraveKind);
const GEOMETRY_SOURCES: readonly string[] = Object.values(GeometrySource);
const WARNING_CODES: readonly string[] = Object.values(WarningCode);
const CONVERSION_CODES: readonly string[] = Object.values(ConversionWarningCode);
const REQUEST_KINDS: readonly string[] = ['open', 'exhume'];
const FAILURE_CAUSES: readonly string[] = [
  'no-disk',
  'not-found',
  'read',
  'invalid-request',
  'internal',
];

/** A non-negative safe integer. */
export function isRequestId(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

class Reject extends Error {}

function fail(reason: string): never {
  throw new Reject(reason);
}

type Obj = Record<string, unknown>;

function asObj(v: unknown, what: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(`${what}: not an object`);
  return v as Obj;
}

function asArray(v: unknown, what: string, max: number): unknown[] {
  if (!Array.isArray(v)) fail(`${what}: not an array`);
  if (v.length > max) fail(`${what}: too many items`);
  return v as unknown[];
}

function asStr(v: unknown, what: string): string {
  if (typeof v !== 'string') fail(`${what}: not a string`);
  return v;
}

function asBool(v: unknown, what: string): boolean {
  if (typeof v !== 'boolean') fail(`${what}: not a boolean`);
  return v;
}

function asInt(v: unknown, what: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min || v > max) {
    fail(`${what}: not an integer in range`);
  }
  return v;
}

function asEnum<T extends string>(v: unknown, allowed: readonly string[], what: string): T {
  if (typeof v !== 'string' || !allowed.includes(v)) fail(`${what}: unexpected value`);
  return v as T;
}

function asBytes(v: unknown, what: string): Uint8Array {
  if (!(v instanceof Uint8Array)) fail(`${what}: not a Uint8Array`);
  return v;
}

function asId(v: unknown, what: string): number {
  if (!isRequestId(v)) fail(`${what}: not a request id`);
  return v;
}

function readWarning(v: unknown): Warning {
  const o = asObj(v, 'warning');
  const w: Warning = {
    code: asEnum<Warning['code']>(o.code, WARNING_CODES, 'warning.code'),
    message: asStr(o.message, 'warning.message'),
  };
  const path = o.path;
  if (path !== undefined) w.path = asStr(path, 'warning.path');
  return w;
}

function readConversionWarning(v: unknown): ConversionWarning {
  const o = asObj(v, 'conversion warning');
  return {
    code: asEnum<ConversionWarning['code']>(o.code, CONVERSION_CODES, 'conversion warning.code'),
    message: asStr(o.message, 'conversion warning.message'),
  };
}

function readWarnings(v: unknown): Warning[] {
  return asArray(v, 'warnings', MAX_MESSAGE_WARNINGS).map(readWarning);
}

function readConversionWarnings(v: unknown): ConversionWarning[] {
  return asArray(v, 'warnings', MAX_MESSAGE_WARNINGS).map(readConversionWarning);
}

function readGrave(v: unknown): Grave {
  const o = asObj(v, 'grave');
  const attrs = asObj(o.attributes, 'grave.attributes');
  const g: Grave = {
    id: asInt(o.id, 'grave.id', 0, Number.MAX_SAFE_INTEGER),
    path: asStr(o.path, 'grave.path'),
    size: asInt(o.size, 'grave.size', 0, MAX_U32),
    date: o.date === null ? null : asStr(o.date, 'grave.date'),
    state: asEnum<Grave['state']>(o.state, GRAVE_STATES, 'grave.state'),
    kind: asEnum<Grave['kind']>(o.kind, GRAVE_KINDS, 'grave.kind'),
    attributes: {
      readOnly: asBool(attrs.readOnly, 'attributes.readOnly'),
      hidden: asBool(attrs.hidden, 'attributes.hidden'),
      system: asBool(attrs.system, 'attributes.system'),
      archive: asBool(attrs.archive, 'attributes.archive'),
    },
    startCluster: asInt(o.startCluster, 'grave.startCluster', 0, Number.MAX_SAFE_INTEGER),
  };
  if (o.reason !== undefined) g.reason = asStr(o.reason, 'grave.reason');
  return g;
}

function readGeometry(v: unknown): GeometryInfo {
  const o = asObj(v, 'geometry');
  const n = (key: keyof GeometryInfo): number =>
    asInt(o[key], `geometry.${key}`, 0, Number.MAX_SAFE_INTEGER);
  return {
    bytesPerSector: n('bytesPerSector'),
    sectorsPerCluster: n('sectorsPerCluster'),
    reservedSectors: n('reservedSectors'),
    fatCount: n('fatCount'),
    rootEntryCount: n('rootEntryCount'),
    totalSectors: n('totalSectors'),
    sectorsPerFat: n('sectorsPerFat'),
    mediaDescriptor: n('mediaDescriptor'),
    dataClusters: n('dataClusters'),
  };
}

function readVolume(v: unknown): Volume {
  const o = asObj(v, 'volume');
  return {
    label: asStr(o.label, 'volume.label'),
    geometrySource: asEnum<Volume['geometrySource']>(
      o.geometrySource,
      GEOMETRY_SOURCES,
      'volume.geometrySource',
    ),
    geometry: o.geometry === null ? null : readGeometry(o.geometry),
  };
}

function readReport(v: unknown): DiskReport {
  const o = asObj(v, 'report');
  return {
    volume: readVolume(o.volume),
    files: asArray(o.files, 'report.files', MAX_TOTAL_ENTRIES).map(readGrave),
    warnings: readWarnings(o.warnings),
  };
}

function readResult(v: unknown): ExhumeResult {
  const o = asObj(v, 'result');
  const kind = o.kind;
  switch (kind) {
    case 'markdown':
    case 'csv':
      return {
        kind,
        text: asStr(o.text, 'result.text'),
        warnings: readConversionWarnings(o.warnings),
      };
    case 'png':
      return {
        kind,
        png: asBytes(o.png, 'result.png'),
        warnings: readConversionWarnings(o.warnings),
      };
    case 'raw':
      return {
        kind,
        error: asStr(o.error, 'result.error'),
        warnings: readConversionWarnings(o.warnings),
      };
    default:
      return fail('result.kind: unexpected value');
  }
}

function readResponse(raw: unknown): WorkerResponse {
  const o = asObj(raw, 'response');
  switch (o.type) {
    case 'opened':
      return { type: 'opened', id: asId(o.id, 'id'), report: readReport(o.report) };
    case 'exhumed':
      return {
        type: 'exhumed',
        id: asId(o.id, 'id'),
        graveId: asInt(o.graveId, 'graveId', 0, Number.MAX_SAFE_INTEGER),
        raw: asBytes(o.raw, 'raw'),
        readWarnings: readWarnings(o.readWarnings),
        result: readResult(o.result),
      };
    case 'failed':
      return {
        type: 'failed',
        id: asId(o.id, 'id'),
        request: asEnum<RequestKind>(o.request, REQUEST_KINDS, 'request'),
        cause: asEnum<FailureCause>(o.cause, FAILURE_CAUSES, 'cause'),
        error: asStr(o.error, 'error'),
      };
    default:
      return fail('type: unexpected value');
  }
}

function readRequest(raw: unknown): WorkerRequest {
  const o = asObj(raw, 'request');
  switch (o.type) {
    case 'open':
      return { type: 'open', id: asId(o.id, 'id'), image: asBytes(o.image, 'image') };
    case 'exhume':
      return {
        type: 'exhume',
        id: asId(o.id, 'id'),
        graveId: asInt(o.graveId, 'graveId', 0, Number.MAX_SAFE_INTEGER),
      };
    default:
      return fail('type: unexpected value');
  }
}

function guarded<T>(read: (raw: unknown) => T, raw: unknown): Parsed<T> {
  try {
    return { ok: true, value: read(raw) };
  } catch (e) {
    // A throwing getter, a revoked proxy or a bad shape all end here; none escapes.
    return { ok: false, reason: e instanceof Reject ? e.message : 'unreadable value' };
  }
}

/** Total: returns a rejection for any input, never throws (Req 3.7, 3.18). */
export function parseResponse(raw: unknown): Parsed<WorkerResponse> {
  return guarded(readResponse, raw);
}

/** Total: returns a rejection for any input, never throws. */
export function parseRequest(raw: unknown): Parsed<WorkerRequest> {
  return guarded(readRequest, raw);
}
