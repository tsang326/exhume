// Per-tool argument validation. Own-property reads only. Never throws.
// Lengths are counted in UTF-16 units, the same unit as maxLength in the schemas.

import type { Outcome } from './errors';
import { getOwn, isPlainObject } from './jsonrpc';
import { MAX_ARG_CHARS } from './limits';

export interface OpenDiskArgs {
  image: string;
}
export interface GraveArgs {
  image: string;
  path: string;
  id?: number;
}
export interface StateArgs {
  state: 'alive' | 'recovered' | 'partial' | 'lost';
}

const STATES = ['alive', 'recovered', 'partial', 'lost'] as const;

const INVALID = { ok: false, code: 'INVALID_ARGUMENTS' } as const;

function keysAllowed(args: Record<string, unknown>, allowed: readonly string[]): boolean {
  for (const key of Object.keys(args)) {
    if (!allowed.includes(key)) return false;
  }
  return true;
}

/** Required string: own string property, length 1..MAX_ARG_CHARS, no U+0000. */
function readString(args: Record<string, unknown>, key: string): string | null {
  const v = getOwn(args, key);
  if (typeof v !== 'string') return null;
  if (v.length < 1 || v.length > MAX_ARG_CHARS) return null;
  if (v.includes('\u0000')) return null;
  return v;
}

export function parseOpenDisk(args: unknown): Outcome<OpenDiskArgs> {
  if (!isPlainObject(args) || !keysAllowed(args, ['image'])) return INVALID;
  const image = readString(args, 'image');
  if (image === null) return INVALID;
  return { ok: true, value: { image } };
}

export function parseGraveArgs(args: unknown): Outcome<GraveArgs> {
  if (!isPlainObject(args) || !keysAllowed(args, ['image', 'path', 'id'])) return INVALID;
  const image = readString(args, 'image');
  const path = readString(args, 'path');
  if (image === null || path === null) return INVALID;
  if (!Object.keys(args).includes('id')) return { ok: true, value: { image, path } };
  const id = getOwn(args, 'id');
  if (typeof id !== 'number' || !Number.isSafeInteger(id) || id < 0) return INVALID;
  return { ok: true, value: { image, path, id } };
}

export function parseStateArgs(args: unknown): Outcome<StateArgs> {
  if (!isPlainObject(args) || !keysAllowed(args, ['state'])) return INVALID;
  const state = getOwn(args, 'state');
  for (const literal of STATES) {
    if (state === literal) return { ok: true, value: { state: literal } };
  }
  return INVALID;
}
