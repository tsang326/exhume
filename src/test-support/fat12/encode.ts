// Independent encoders for the test-only FAT12 image writer.
// No imports from src/core, vitest, fast-check or Node. On-disk layout values
// are literal constants on purpose, so the reader and the writer share nothing.

import { FitError } from './errors';
import type { DosDateTime } from './types';

/** First name byte of a deleted directory entry. */
export const DELETED_MARK = 0xe5;
/** Attribute byte of a long-name record. */
export const LFN_ATTRIBUTE = 0x0f;
/** Bit in the first byte of the last (first on disk) long-name record. */
export const LFN_LAST_FLAG = 0x40;
/** UTF-16 code units held by one long-name record. */
export const LFN_UNITS_PER_RECORD = 13;
/** Longest long name the writer accepts, in UTF-16 code units. */
export const LFN_MAX_UNITS = 255;

/** Byte offsets of the 13 UTF-16 units inside a long-name record (2 bytes each). */
const LFN_UNIT_OFFSETS = [1, 3, 5, 7, 9, 14, 16, 18, 20, 22, 24, 28, 30] as const;

// ---------------------------------------------------------------------------
// FAT12 entries
// ---------------------------------------------------------------------------

/**
 * Write 12-bit `value` as FAT entry `n` into `fat` (one FAT copy), leaving the
 * neighbouring entry that shares a byte untouched. Throws RangeError when the
 * entry does not fit in `fat` or the value is not 0..0xFFF.
 */
export function writeFatEntry(fat: Uint8Array, n: number, value: number): void {
  if (!Number.isInteger(n) || n < 0) throw new RangeError(`bad FAT entry index ${n}`);
  if (!Number.isInteger(value) || value < 0 || value > 0xfff) {
    throw new RangeError(`bad FAT entry value ${value}`);
  }
  const o = Math.floor((n * 3) / 2);
  if (o + 1 >= fat.length) throw new RangeError(`FAT entry ${n} outside FAT`);
  if (n % 2 === 0) {
    fat[o] = value & 0xff;
    fat[o + 1] = ((fat[o + 1] ?? 0) & 0xf0) | (value >> 8);
  } else {
    fat[o] = ((fat[o] ?? 0) & 0x0f) | ((value & 0x0f) << 4);
    fat[o + 1] = value >> 4;
  }
}

// ---------------------------------------------------------------------------
// DOS date and time
// ---------------------------------------------------------------------------

/** Date word: bits 15-9 year-1980, 8-5 month, 4-0 day. Throws RangeError out of range. */
export function encodeDosDate(d: DosDateTime): number {
  if (!Number.isInteger(d.year) || d.year < 1980 || d.year > 2107) {
    throw new RangeError(`DOS year out of range: ${d.year}`);
  }
  if (!Number.isInteger(d.month) || d.month < 1 || d.month > 12) {
    throw new RangeError(`DOS month out of range: ${d.month}`);
  }
  if (!Number.isInteger(d.day) || d.day < 1 || d.day > 31) {
    throw new RangeError(`DOS day out of range: ${d.day}`);
  }
  return ((d.year - 1980) << 9) | (d.month << 5) | d.day;
}

/** Time word: bits 15-11 hour, 10-5 minute, 4-0 second/2. Odd seconds are rounded down. */
export function encodeDosTime(d: DosDateTime): number {
  if (!Number.isInteger(d.hour) || d.hour < 0 || d.hour > 23) {
    throw new RangeError(`DOS hour out of range: ${d.hour}`);
  }
  if (!Number.isInteger(d.minute) || d.minute < 0 || d.minute > 59) {
    throw new RangeError(`DOS minute out of range: ${d.minute}`);
  }
  if (!Number.isInteger(d.second) || d.second < 0 || d.second > 59) {
    throw new RangeError(`DOS second out of range: ${d.second}`);
  }
  return (d.hour << 11) | (d.minute << 5) | (d.second >> 1);
}

// ---------------------------------------------------------------------------
// 8.3 names
// ---------------------------------------------------------------------------

const SHORT_NAME_PUNCTUATION = "!#$%&'()-@^_`{}~";

function isShortNameChar(ch: string): boolean {
  return (
    (ch >= 'A' && ch <= 'Z') || (ch >= '0' && ch <= '9') || SHORT_NAME_PUNCTUATION.includes(ch)
  );
}

function splitShortName(name: string): { base: string; ext: string } | undefined {
  const dot = name.indexOf('.');
  if (dot === -1) return { base: name, ext: '' };
  if (name.indexOf('.', dot + 1) !== -1) return undefined; // more than one dot
  return { base: name.slice(0, dot), ext: name.slice(dot + 1) };
}

/** True for 'NAME', 'NAME.EXT': base 1..8, extension 0..3 (no empty ext after a dot), upper-case ASCII. */
export function isValidShortName(name: string): boolean {
  const parts = splitShortName(name);
  if (parts === undefined) return false;
  const { base, ext } = parts;
  if (base.length < 1 || base.length > 8 || ext.length > 3) return false;
  if (name.includes('.') && ext.length === 0) return false;
  for (const ch of base) if (!isShortNameChar(ch)) return false;
  for (const ch of ext) if (!isShortNameChar(ch)) return false;
  return true;
}

/**
 * Encode 'NAME.EXT' as the 11 space-padded bytes of a directory entry.
 * Throws FitError('file-name-format') for an invalid name.
 */
export function encodeShortName(name: string): Uint8Array {
  const parts = isValidShortName(name) ? splitShortName(name) : undefined;
  if (parts === undefined) {
    throw new FitError('file-name-format', 11, name.length, 'invalid 8.3 name');
  }
  const out = new Uint8Array(11).fill(0x20);
  for (let i = 0; i < parts.base.length; i++) out[i] = parts.base.charCodeAt(i);
  for (let i = 0; i < parts.ext.length; i++) out[8 + i] = parts.ext.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------------------
// VFAT long names
// ---------------------------------------------------------------------------

/** VFAT checksum of the 11-byte short name: rotate right by one, then add each byte. */
export function lfnChecksum(shortName11: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < 11; i++) {
    sum = (((sum & 1) << 7) + (sum >> 1) + (shortName11[i] ?? 0)) & 0xff;
  }
  return sum;
}

/**
 * Build the 32-byte long-name records for `longName`, in on-disk order
 * (highest sequence number first, flagged 0x40). `checksum` is normally
 * lfnChecksum() of the 8.3 name that follows the records.
 * Throws FitError('file-name-format') for an empty name or one over 255 UTF-16 units.
 */
export function buildLfnRecords(longName: string, checksum: number): Uint8Array[] {
  const units: number[] = [];
  for (let i = 0; i < longName.length; i++) units.push(longName.charCodeAt(i));
  if (units.length < 1 || units.length > LFN_MAX_UNITS) {
    throw new FitError('file-name-format', LFN_MAX_UNITS, units.length, 'long name length');
  }
  // 0x0000 terminator when it fits, then 0xFFFF padding.
  if (units.length % LFN_UNITS_PER_RECORD !== 0) units.push(0x0000);
  const count = Math.ceil(units.length / LFN_UNITS_PER_RECORD);
  while (units.length < count * LFN_UNITS_PER_RECORD) units.push(0xffff);

  const records: Uint8Array[] = [];
  for (let seq = count; seq >= 1; seq--) {
    const rec = new Uint8Array(32);
    rec[0] = seq === count ? seq | LFN_LAST_FLAG : seq;
    rec[11] = LFN_ATTRIBUTE;
    rec[12] = 0; // type
    rec[13] = checksum & 0xff;
    // rec[26..27] first cluster stays 0
    for (let k = 0; k < LFN_UNITS_PER_RECORD; k++) {
      const unit = units[(seq - 1) * LFN_UNITS_PER_RECORD + k] ?? 0xffff;
      const off = LFN_UNIT_OFFSETS[k] as number;
      rec[off] = unit & 0xff;
      rec[off + 1] = unit >> 8;
    }
    records.push(rec);
  }
  return records;
}
