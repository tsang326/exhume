// dBase III header parser. Checks run in the order of Requirement 6.3 and the lowest
// failed condition is reported. Nothing is sized from an unvalidated header field.

import { decodeCp437 } from '../fat12';
import {
  DBF_DESCRIPTOR_BYTES,
  DBF_FIXED_HEADER_BYTES,
  DBF_MAX_FIELD_LENGTH,
  DBF_MAX_HEADER_BYTES,
  DBF_MIN_HEADER_BYTES,
  DBF_NAME_BYTES,
  MAX_DBF_FIELDS,
} from './limits';
import type { LimitName } from './limits';
import { TEMPLATES, fill, limitExceededMessage } from './templates';
import { ConversionWarningCode } from './types';
import type { WarningCollector } from './warnings';

export type DbfFieldType = 'C' | 'N' | 'F' | 'D' | 'L' | 'M';

export interface DbfField {
  /** CP437 name, control bytes replaced by '_'. */
  name: string;
  /** Unknown letters are stored as 'C'. */
  type: DbfFieldType;
  /** 1..255 */
  length: number;
  decimals: number;
  /** Byte offset inside a record, after the deletion flag (starts at 1). */
  offset: number;
  unknownType: boolean;
}

export interface DbfHeader {
  version: number;
  /** u32 little-endian at offset 4. */
  recordCount: number;
  headerLength: number;
  recordLength: number;
  fields: DbfField[];
  /** Sum of all field lengths; recordLength > 1 + fieldLengthSum is a mismatch. */
  fieldLengthSum: number;
}

export type DbfHeaderResult =
  | { ok: true; header: DbfHeader }
  | { ok: false; error: string; limit?: LimitName };

const KNOWN_TYPES = 'CDFLMN';

function invalid(condition: number, limit?: LimitName): DbfHeaderResult {
  const error = fill(TEMPLATES.errDbfInvalid, condition);
  return limit === undefined ? { ok: false, error } : { ok: false, error, limit };
}

function limitFail(
  condition: number,
  limit: LimitName,
  collector: WarningCollector,
): DbfHeaderResult {
  collector.add(ConversionWarningCode.LimitExceeded, limitExceededMessage(limit));
  return invalid(condition, limit);
}

function readName(input: Uint8Array, start: number): string {
  const bytes = new Uint8Array(DBF_NAME_BYTES);
  let n = 0;
  for (let i = 0; i < DBF_NAME_BYTES; i++) {
    const b = input[start + i] as number;
    if (b === 0x00) break;
    bytes[n++] = b < 0x20 || b === 0x7f ? 0x5f : b;
  }
  return decodeCp437(bytes.subarray(0, n));
}

export function parseDbfHeader(input: Uint8Array, collector: WarningCollector): DbfHeaderResult {
  // Requirement 6.4: under 32 bytes, read nothing further.
  if (input.length < DBF_FIXED_HEADER_BYTES) return invalid(2);

  const version = input[0] as number;
  if (version !== 0x03 && version !== 0x83 && version !== 0x8b) {
    return { ok: false, error: fill(TEMPLATES.errDbfVersion, version) };
  }

  const headerLength = (input[8] as number) | ((input[9] as number) << 8);
  const recordLength = (input[10] as number) | ((input[11] as number) << 8);

  // Condition 2
  if (headerLength > DBF_MAX_HEADER_BYTES) return limitFail(2, 'MAX_DBF_FIELDS', collector);
  if (headerLength < DBF_MIN_HEADER_BYTES || headerLength > input.length) return invalid(2);

  // Condition 3: whole descriptors, then a 0x0D terminator below headerLength.
  let count = 0;
  let offset = DBF_FIXED_HEADER_BYTES;
  let terminated = false;
  let overflow = false;
  for (let i = 0; i <= MAX_DBF_FIELDS; i++) {
    if (offset >= headerLength) break;
    if (input[offset] === 0x0d) {
      terminated = true;
      break;
    }
    if (offset + DBF_DESCRIPTOR_BYTES > headerLength) break;
    if (count >= MAX_DBF_FIELDS) {
      overflow = true;
      break;
    }
    count++;
    offset += DBF_DESCRIPTOR_BYTES;
  }
  if (overflow) return limitFail(3, 'MAX_DBF_FIELDS', collector);
  if (!terminated || count < 1) return invalid(3);

  // Condition 4
  let sum = 0;
  for (let k = 0; k < count; k++) {
    const len = input[DBF_FIXED_HEADER_BYTES + k * DBF_DESCRIPTOR_BYTES + 16] as number;
    if (len < 1 || len > DBF_MAX_FIELD_LENGTH) return invalid(4);
    sum += len;
  }

  // Condition 5
  if (recordLength < 1 + sum) return invalid(5);

  // Accepted: building the fields is bounded by count <= MAX_DBF_FIELDS.
  const fields: DbfField[] = [];
  let recOffset = 1;
  for (let k = 0; k < count; k++) {
    const d = DBF_FIXED_HEADER_BYTES + k * DBF_DESCRIPTOR_BYTES;
    const letter = String.fromCharCode(input[d + 11] as number);
    const known = KNOWN_TYPES.indexOf(letter) >= 0 && (input[d + 11] as number) < 0x80;
    const length = input[d + 16] as number;
    if (!known) {
      collector.addOnce(
        ConversionWarningCode.FieldTypeUnknown,
        fill(TEMPLATES.fieldTypeUnknown, k + 1),
        k + 1,
      );
    }
    fields.push({
      name: readName(input, d),
      type: known ? (letter as DbfFieldType) : 'C',
      length,
      decimals: input[d + 17] as number,
      offset: recOffset,
      unknownType: !known,
    });
    recOffset += length;
  }

  const recordCount =
    ((input[4] as number) |
      ((input[5] as number) << 8) |
      ((input[6] as number) << 16) |
      ((input[7] as number) << 24)) >>>
    0;

  return {
    ok: true,
    header: { version, recordCount, headerLength, recordLength, fields, fieldLengthSum: sum },
  };
}
