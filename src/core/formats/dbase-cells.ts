// dBase III per-type cell formatters (Requirements 7.5 to 7.14). Each formatter reads a
// field's bytes through a subarray view and allocates nothing beyond the field length.
// No regular expressions: numbers and dates are checked by character-level code.

import { decodeCp437 } from '../fat12';
import type { DbfField } from './dbase-header';
import { TEMPLATES, fill } from './templates';
import { ConversionWarningCode } from './types';
import type { WarningCollector } from './warnings';

export interface FormattedCell {
  text: string;
  /** True only for text ('C') cells: the CSV writer applies the formula guard. */
  guard: boolean;
  /** True when the value was malformed and the cell was written empty. */
  invalid: boolean;
}

const SPACE = 0x20;

function isDigit(b: number): boolean {
  return b >= 0x30 && b <= 0x39;
}

function cell(text: string, invalid: boolean): FormattedCell {
  return { text, guard: false, invalid };
}

function isLeapYear(year: number): boolean {
  if (year % 400 === 0) return true;
  if (year % 100 === 0) return false;
  return year % 4 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  if (month === 4 || month === 6 || month === 9 || month === 11) return 30;
  return 31;
}

function formatText(bytes: Uint8Array): FormattedCell {
  let end = bytes.length;
  while (end > 0 && (bytes[end - 1] === SPACE || bytes[end - 1] === 0x00)) end--;
  const decoded = decodeCp437(bytes.subarray(0, end));
  let out = '';
  for (let i = 0; i < decoded.length; i++) {
    const c = decoded.charCodeAt(i);
    out += c < 0x20 || c === 0x7f ? ' ' : decoded.charAt(i);
  }
  return { text: out, guard: true, invalid: false };
}

function formatNumber(bytes: Uint8Array): FormattedCell {
  let lo = 0;
  let hi = bytes.length;
  while (lo < hi && bytes[lo] === SPACE) lo++;
  while (hi > lo && bytes[hi - 1] === SPACE) hi--;
  // States: 0 start, 1 after '-', 2 integer digits, 3 after '.', 4 fraction digits.
  let state = 0;
  for (let i = lo; i < hi; i++) {
    const b = bytes[i] as number;
    if (state === 0 && b === 0x2d) state = 1;
    else if ((state === 0 || state === 1 || state === 2) && isDigit(b)) state = 2;
    else if (state === 2 && b === 0x2e) state = 3;
    else if ((state === 3 || state === 4) && isDigit(b)) state = 4;
    else return cell('', true);
  }
  if (state !== 2 && state !== 4) return cell('', true);
  let text = '';
  for (let i = lo; i < hi; i++) text += String.fromCharCode(bytes[i] as number);
  return cell(text, false);
}

function formatDate(bytes: Uint8Array): FormattedCell {
  let allSpaces = true;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] !== SPACE) {
      allSpaces = false;
      break;
    }
  }
  if (allSpaces) return cell('', false);
  if (bytes.length !== 8) return cell('', true);
  for (let i = 0; i < 8; i++) if (!isDigit(bytes[i] as number)) return cell('', true);
  const d = (i: number): number => (bytes[i] as number) - 0x30;
  const year = d(0) * 1000 + d(1) * 100 + d(2) * 10 + d(3);
  const month = d(4) * 10 + d(5);
  const day = d(6) * 10 + d(7);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return cell('', true);
  }
  const s = String.fromCharCode(...bytes.subarray(0, 8));
  return cell(s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8), false);
}

function formatLogical(bytes: Uint8Array): FormattedCell {
  const b = bytes.length > 0 ? (bytes[0] as number) : -1;
  if (b === 0x54 || b === 0x74 || b === 0x59 || b === 0x79) return cell('TRUE', false);
  if (b === 0x46 || b === 0x66 || b === 0x4e || b === 0x6e) return cell('FALSE', false);
  if (b === 0x3f || b === SPACE) return cell('', false);
  return cell('', true);
}

/** Pure per-type formatter; no warnings. */
export function formatCellBytes(type: DbfField['type'], bytes: Uint8Array): FormattedCell {
  switch (type) {
    case 'M':
      return cell('', false);
    case 'N':
    case 'F':
      return formatNumber(bytes);
    case 'D':
      return formatDate(bytes);
    case 'L':
      return formatLogical(bytes);
    default:
      return formatText(bytes);
  }
}

/**
 * Formats one field value and records its warnings. `fieldNumber` is 1-based.
 * `bytes` is the field's own bytes (a subarray view of the record).
 */
export function formatCell(
  field: DbfField,
  bytes: Uint8Array,
  fieldNumber: number,
  collector: WarningCollector,
): FormattedCell {
  const result = formatCellBytes(field.type, bytes);
  if (result.invalid) {
    collector.addOnce(
      ConversionWarningCode.FieldValueInvalid,
      fill(TEMPLATES.fieldValueInvalid, fieldNumber),
      fieldNumber,
    );
  }
  if (field.type === 'M') {
    collector.addOnce(ConversionWarningCode.MemoNotAvailable, TEMPLATES.memoNotAvailable);
  }
  return result;
}
