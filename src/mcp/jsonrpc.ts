// JSON-RPC 2.0 envelope handling: validation, response builders, fixed protocol messages.
// Pure: no process I/O. Every response is built from a fresh literal object.

import {
  DEFAULT_VERSION,
  JSONRPC_INTERNAL_ERROR,
  JSONRPC_INVALID_PARAMS,
  JSONRPC_INVALID_REQUEST,
  JSONRPC_METHOD_NOT_FOUND,
  JSONRPC_PARSE_ERROR,
  SUPPORTED_VERSIONS,
} from './limits';

export type JsonValue = null | boolean | number | string | JsonValue[] | { [k: string]: JsonValue };
export type RpcId = string | number;

// Fixed protocol messages
export const PARSE_ERROR = 'Parse error';
export const INVALID_REQUEST = 'Invalid Request';
export const METHOD_NOT_FOUND = 'Method not found';
export const INVALID_PARAMS = 'Invalid params';
export const INTERNAL_ERROR = 'Internal error';
export const REQUEST_TOO_LARGE = 'Request too large';

export { JSONRPC_INTERNAL_ERROR, JSONRPC_INVALID_PARAMS, JSONRPC_INVALID_REQUEST, JSONRPC_METHOD_NOT_FOUND, JSONRPC_PARSE_ERROR };

/** Own data property read. Never walks the prototype chain. */
export function getOwn(obj: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(obj, key);
  if (descriptor === undefined) return undefined;
  return descriptor.value;
}

/** Non-null, non-array object. */
export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Valid_Id: a string, or a safe integer. */
export function isValidId(v: unknown): v is RpcId {
  return typeof v === 'string' || (typeof v === 'number' && Number.isSafeInteger(v));
}

export type Envelope =
  | { kind: 'request'; id: RpcId; method: string; params: unknown }
  | { kind: 'notification'; method: string; params: unknown }
  | { kind: 'invalid' };

export function classify(value: unknown): Envelope {
  if (!isPlainObject(value)) return { kind: 'invalid' };
  if (getOwn(value, 'jsonrpc') !== '2.0') return { kind: 'invalid' };
  const method = getOwn(value, 'method');
  if (typeof method !== 'string') return { kind: 'invalid' };
  const params = getOwn(value, 'params');
  if (Object.getOwnPropertyDescriptor(value, 'id') === undefined) {
    return { kind: 'notification', method, params };
  }
  const id = getOwn(value, 'id');
  if (!isValidId(id)) return { kind: 'invalid' };
  return { kind: 'request', id, method, params };
}

export function resultLine(id: RpcId, result: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}

export function errorLine(id: RpcId | null, code: number, message: string): string {
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code, message } });
}

export function tooLargeLine(): string {
  return errorLine(null, JSONRPC_INVALID_REQUEST, REQUEST_TOO_LARGE);
}

/** Returns a member of SUPPORTED_VERSIONS equal to the request, else DEFAULT_VERSION. Never the received string. */
export function negotiateVersion(params: unknown): (typeof SUPPORTED_VERSIONS)[number] {
  if (!isPlainObject(params)) return DEFAULT_VERSION;
  const requested = getOwn(params, 'protocolVersion');
  const match = SUPPORTED_VERSIONS.find((v) => v === requested);
  return match ?? DEFAULT_VERSION;
}
