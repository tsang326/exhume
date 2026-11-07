/**
 * 8.3 name decoding, name sanitising and the VFAT long-name state machine.
 * Character-level code only: no regular expressions are applied to disk text (2.7).
 */
import { decodeCp437 } from './cp437';
import { MAX_LFN_ENTRIES, MAX_NAME_UTF16 } from './limits';

const SPACE = 0x20;
const UNITS_PER_RECORD = 13;

/** Replace path-unsafe characters; empty or dots-only components become '_'. */
export function sanitizeComponent(raw: string): string {
  let out = '';
  let onlyDots = true;
  for (let i = 0; i < raw.length; i++) {
    const code = raw.charCodeAt(i);
    if (code < 0x20 || code === 0x2f || code === 0x5c || code === 0x7f) {
      out += '_';
      onlyDots = false;
    } else {
      out += raw[i];
      if (code !== 0x2e) onlyDots = false;
    }
  }
  return out.length === 0 || onlyDots ? '_' : out;
}

function trimmedField(entry: Uint8Array, start: number, length: number): Uint8Array {
  const field = new Uint8Array(length);
  for (let i = 0; i < length; i++) field[i] = entry[start + i] ?? SPACE;
  let end = length;
  while (end > 0 && field[end - 1] === SPACE) end--;
  return field.subarray(0, end);
}

/** Decode the 11-byte 8.3 name of a directory record. Dot entries are returned as '.' or '..' unsanitised. */
export function decodeShortName(entry: Uint8Array): { name: string; isDotEntry: boolean } {
  const base = trimmedField(entry, 0, 8);
  const ext = trimmedField(entry, 8, 3);
  if (ext.length === 0 && ((base.length === 1 && base[0] === 0x2e) || (base.length === 2 && base[0] === 0x2e && base[1] === 0x2e))) {
    return { name: base.length === 1 ? '.' : '..', isDotEntry: true };
  }
  if (base.length > 0 && base[0] === 0x05) {
    const copy = new Uint8Array(base);
    copy[0] = 0xe5;
    return { name: join(copy, ext), isDotEntry: false };
  }
  return { name: join(base, ext), isDotEntry: false };
}

function join(base: Uint8Array, ext: Uint8Array): string {
  const full = decodeCp437(base) + (ext.length > 0 ? '.' + decodeCp437(ext) : '');
  return sanitizeComponent(full);
}

/** Standard VFAT checksum over the 11-byte short name. */
export function lfnChecksum(shortName11: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < 11; i++) {
    sum = (((sum & 1) !== 0 ? 0x80 : 0) + (sum >> 1) + (shortName11[i] ?? 0)) & 0xff;
  }
  return sum;
}

export interface LfnState {
  /** True once at least one long-name record has been fed since the last reset. */
  pending: boolean;
  /** True when a rule was violated; lfnTake then reports 'invalid'. */
  broken: boolean;
  /** Sequence number of the first (highest) record. */
  top: number;
  /** Sequence number the next record must carry; 0 once the sequence ended at 1. */
  expected: number;
  checksum: number;
  /** UTF-16 units, record n occupies (n - 1) * 13 .. n * 13 - 1. */
  units: Uint16Array;
}

export function makeLfnState(): LfnState {
  return {
    pending: false,
    broken: false,
    top: 0,
    expected: 0,
    checksum: 0,
    units: new Uint16Array(MAX_LFN_ENTRIES * UNITS_PER_RECORD),
  };
}

export function lfnReset(s: LfnState): void {
  s.pending = false;
  s.broken = false;
  s.top = 0;
  s.expected = 0;
  s.checksum = 0;
  s.units.fill(0);
}

const UNIT_OFFSETS: readonly number[] = [1, 3, 5, 7, 9, 14, 16, 18, 20, 22, 24, 28, 30];

/** Feed one 0x0F long-name record. Never throws. */
export function lfnFeed(s: LfnState, entry: Uint8Array): void {
  const first = !s.pending;
  s.pending = true;
  if (s.broken) return;
  if (entry.length < 32) {
    s.broken = true;
    return;
  }
  const raw = entry[0] as number;
  const seq = raw & 0x3f;
  const checksum = entry[13] as number;
  if (first) {
    if ((raw & 0x40) === 0 || seq < 1 || seq > MAX_LFN_ENTRIES) {
      s.broken = true;
      return;
    }
    s.top = seq;
    s.checksum = checksum;
  } else if ((raw & 0x40) !== 0 || s.expected === 0 || seq !== s.expected || checksum !== s.checksum) {
    s.broken = true;
    return;
  }
  const base = (seq - 1) * UNITS_PER_RECORD;
  for (let i = 0; i < UNITS_PER_RECORD; i++) {
    const o = UNIT_OFFSETS[i] as number;
    s.units[base + i] = (entry[o] as number) | ((entry[o + 1] as number) << 8);
  }
  s.expected = seq - 1;
}

function unitsToString(units: Uint16Array, count: number): string {
  let out = '';
  for (let i = 0; i < count; i++) {
    const u = units[i] as number;
    if (u >= 0xd800 && u <= 0xdbff) {
      const next = i + 1 < count ? (units[i + 1] as number) : 0;
      if (next >= 0xdc00 && next <= 0xdfff) {
        out += String.fromCharCode(u, next);
        i++;
      } else {
        out += '\uFFFD';
      }
    } else if (u >= 0xdc00 && u <= 0xdfff) {
      out += '\uFFFD';
    } else {
      out += String.fromCharCode(u);
    }
  }
  return out;
}

/** Resolve pending long-name records against the following 8.3 entry, then reset. Never throws. */
export function lfnTake(
  s: LfnState,
  shortName11: Uint8Array,
): { kind: 'none' } | { kind: 'name'; name: string } | { kind: 'invalid' } {
  if (!s.pending) return { kind: 'none' };
  const ok = !s.broken && s.expected === 0 && s.top >= 1 && s.checksum === lfnChecksum(shortName11);
  let count = 0;
  if (ok) {
    const total = s.top * UNITS_PER_RECORD;
    while (count < total && s.units[count] !== 0) count++;
  }
  const result: { kind: 'name'; name: string } | { kind: 'invalid' } =
    ok && count >= 1 && count <= MAX_NAME_UTF16
      ? { kind: 'name', name: sanitizeComponent(unitsToString(s.units, count)) }
      : { kind: 'invalid' };
  lfnReset(s);
  return result;
}
