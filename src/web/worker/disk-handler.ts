import { openDisk, MAX_FILE_OUTPUT_BYTES } from '../../core/fat12/index';
import type { DiskHandle } from '../../core/fat12/index';
import { convertAuto } from '../../core/formats/index';
import type { ExhumeResult, FailedResponse, FailureCause, RequestKind, WorkerResponse } from '../logic/protocol';
import { lastSegment } from '../logic/text';
import { parseRequest } from '../logic/validate';

export interface WorkerSession {
  handle: DiskHandle | null;
}

export function createSession(): WorkerSession {
  return { handle: null };
}

const MESSAGES: Record<FailureCause, string> = {
  'no-disk': 'No disk is open.',
  'not-found': 'That file is not in the open disk.',
  read: 'The file could not be read.',
  'invalid-request': 'The request was not understood.',
  internal: 'Something went wrong while reading the disk.',
};

function fail(id: number, request: RequestKind, cause: FailureCause, error?: string): FailedResponse {
  return { type: 'failed', id, request, cause, error: error ?? MESSAGES[cause] };
}

/** Best-effort kind of a malformed request, without trusting it. */
function guessKind(raw: unknown): RequestKind {
  try {
    if (typeof raw === 'object' && raw !== null && (raw as { type?: unknown }).type === 'exhume') return 'exhume';
  } catch {
    // fall through
  }
  return 'open';
}

/** A Uint8Array that owns its whole buffer. */
function owned(bytes: Uint8Array): Uint8Array {
  return bytes.byteOffset === 0 && bytes.buffer.byteLength === bytes.length ? bytes : bytes.slice();
}

/** Total. Never throws, never needs a Worker. Mutates only `session.handle`, and only on a successful open. */
export function handleRequest(session: WorkerSession, raw: unknown): WorkerResponse {
  let kind: RequestKind = 'open';
  let id = 0;
  try {
    const parsed = parseRequest(raw);
    if (!parsed.ok) return fail(0, guessKind(raw), 'invalid-request');
    const req = parsed.value;
    kind = req.type;
    id = req.id;

    if (req.type === 'open') {
      const handle = openDisk(req.image);
      session.handle = handle;
      return { type: 'opened', id, report: handle.report };
    }

    const handle = session.handle;
    if (handle === null) return fail(id, 'exhume', 'no-disk');
    const files = handle.report.files;
    const graveId = req.graveId;
    if (!Number.isInteger(graveId) || graveId < 0 || graveId >= files.length) {
      return fail(id, 'exhume', 'not-found');
    }
    const grave = files[graveId];
    if (grave === undefined) return fail(id, 'exhume', 'not-found');

    const read = handle.readBytes(grave);
    if (!read.ok) return fail(id, 'exhume', 'read', read.error);

    const bytes =
      read.bytes.length > MAX_FILE_OUTPUT_BYTES ? read.bytes.subarray(0, MAX_FILE_OUTPUT_BYTES) : read.bytes;
    const rawBytes = owned(bytes);

    const converted = convertAuto(rawBytes, lastSegment(grave.path));
    let result: ExhumeResult;
    if (!converted.ok) {
      result = { kind: 'raw', error: converted.error, warnings: converted.warnings };
    } else if (converted.mime === 'text/markdown') {
      result = { kind: 'markdown', text: converted.output, warnings: converted.warnings };
    } else if (converted.mime === 'text/csv') {
      result = { kind: 'csv', text: converted.output, warnings: converted.warnings };
    } else if (converted.mime === 'text/plain') {
      result = { kind: 'text', text: converted.output, warnings: converted.warnings };
    } else {
      result = { kind: 'png', png: owned(converted.output), warnings: converted.warnings };
    }
    return { type: 'exhumed', id, graveId, raw: rawBytes, readWarnings: read.warnings, result };
  } catch {
    return fail(id, kind, 'internal');
  }
}
