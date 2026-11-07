import type { DiskReport, Warning } from '../../core/fat12/index';
import type { ConversionWarning } from '../../core/formats/index';

/**
 * Worker_Protocol: plain discriminated unions. Only objects, arrays, strings, numbers,
 * booleans, `null` and `Uint8Array` appear, so every message is structured-clone safe.
 */

export type RequestKind = 'open' | 'exhume';

export interface OpenRequest {
  type: 'open';
  id: number;
  image: Uint8Array;
}
export interface ExhumeRequest {
  type: 'exhume';
  id: number;
  graveId: number;
}
export type WorkerRequest = OpenRequest | ExhumeRequest;

/** What the worker found in a file. The mime and extension come from `kind`, never from the message. */
export type ExhumeResult =
  | { kind: 'markdown'; text: string; warnings: ConversionWarning[] }
  | { kind: 'csv'; text: string; warnings: ConversionWarning[] }
  | { kind: 'text'; text: string; warnings: ConversionWarning[] }
  | { kind: 'png'; png: Uint8Array; warnings: ConversionWarning[] }
  | { kind: 'raw'; error: string; warnings: ConversionWarning[] }; // unknown format or conversion failure

export interface OpenedResponse {
  type: 'opened';
  id: number;
  report: DiskReport;
}
export interface ExhumedResponse {
  type: 'exhumed';
  id: number;
  graveId: number;
  /** Full file bytes, at most MAX_FILE_OUTPUT_BYTES. */
  raw: Uint8Array;
  /** From DiskHandle.readBytes. */
  readWarnings: Warning[];
  result: ExhumeResult;
}
export type FailureCause = 'no-disk' | 'not-found' | 'read' | 'invalid-request' | 'internal';
export interface FailedResponse {
  type: 'failed';
  id: number;
  request: RequestKind;
  cause: FailureCause;
  error: string;
}
export type WorkerResponse = OpenedResponse | ExhumedResponse | FailedResponse;

export const OUTPUT_BY_KIND = {
  markdown: { mime: 'text/markdown', extension: '.md' },
  csv: { mime: 'text/csv', extension: '.csv' },
  text: { mime: 'text/plain', extension: '.txt' },
  png: { mime: 'image/png', extension: '.png' },
} as const;
