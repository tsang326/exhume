// Generic builder: an authored table becomes dBase III bytes plus the CSV rows
// the converter is expected to give back.

import { writeDbf } from '../../test-support/formats/index';
import type { DbfFieldSpec, DbfRecordSpec } from '../../test-support/formats/index';
import { DemoBuildError } from '../errors';
import { cp437ByteOf } from './cp437';

export interface AuthoredField {
  name: string;
  type: 'C' | 'N' | 'D';
  length: number;
  decimals: number;
}
/** D values are 'YYYYMMDD'. */
export interface AuthoredTable {
  fields: AuthoredField[];
  rows: string[][];
}

const WHO = 'table';
const GUARDED_FIRST = '=+-@';

function fail(message: string): never {
  throw new DemoBuildError(WHO, message);
}

function isDigit(c: number): boolean {
  return c >= 0x30 && c <= 0x39;
}

function validNameChars(name: string): boolean {
  for (let i = 0; i < name.length; i++) {
    const c = name.charCodeAt(i);
    const ok = (c >= 0x41 && c <= 0x5a) || isDigit(c) || c === 0x5f;
    if (!ok) return false;
  }
  return true;
}

function validNumber(v: string): boolean {
  let i = 0;
  if (v.charCodeAt(0) === 0x2d) i = 1;
  let digits = 0;
  while (i < v.length && isDigit(v.charCodeAt(i))) {
    i++;
    digits++;
  }
  if (digits === 0) return false;
  if (i === v.length) return true;
  if (v.charCodeAt(i) !== 0x2e) return false;
  i++;
  let frac = 0;
  while (i < v.length && isDigit(v.charCodeAt(i))) {
    i++;
    frac++;
  }
  return frac > 0 && i === v.length;
}

function cellBytes(field: AuthoredField, value: string, where: string): Uint8Array {
  if (typeof value !== 'string') fail(`${where}: value is not a string`);
  const out = new Uint8Array(field.length);
  out.fill(0x20);
  if (field.type === 'D') {
    if (value.length !== 8) fail(`${where}: date must be YYYYMMDD`);
    for (let i = 0; i < 8; i++) {
      if (!isDigit(value.charCodeAt(i))) fail(`${where}: date must be YYYYMMDD`);
      out[i] = value.charCodeAt(i);
    }
    return out;
  }
  if (field.type === 'N') {
    if (!validNumber(value)) fail(`${where}: not a plain decimal number`);
    if (value.length > field.length) fail(`${where}: value does not fit the field`);
    const start = field.length - value.length;
    for (let i = 0; i < value.length; i++) out[start + i] = value.charCodeAt(i);
    return out;
  }
  // C: left-justified, every character must have a CP437 byte.
  if (value.length > field.length) fail(`${where}: value does not fit the field`);
  if (value.length > 0) {
    if (GUARDED_FIRST.includes(value.charAt(0))) fail(`${where}: text starts with a formula character`);
    if (value.charAt(0) === ' ' || value.charAt(value.length - 1) === ' ') {
      fail(`${where}: text has a leading or trailing space`);
    }
  }
  for (let i = 0; i < value.length; i++) {
    const b = cp437ByteOf(value.charAt(i));
    if (b === undefined) fail(`${where}: character not allowed`);
    out[i] = b;
  }
  return out;
}

export function tableToDbf(t: AuthoredTable): { bytes: Uint8Array; expectedCsv: string[][] } {
  try {
    return build(t);
  } catch (e) {
    if (e instanceof DemoBuildError) throw e;
    throw new DemoBuildError(WHO, e instanceof Error ? e.message : 'table build failed');
  }
}

function build(t: AuthoredTable): { bytes: Uint8Array; expectedCsv: string[][] } {
  if (t === null || typeof t !== 'object' || !Array.isArray(t.fields) || !Array.isArray(t.rows)) {
    fail('expected fields and rows');
  }
  if (t.fields.length === 0) fail('at least one field is needed');
  const fields: DbfFieldSpec[] = t.fields.map((f, i) => {
    if (typeof f.name !== 'string' || f.name.length < 1 || f.name.length > 10 || !validNameChars(f.name)) {
      fail(`fields[${i}]: name must be 1 to 10 characters of A-Z, 0-9, _`);
    }
    if (f.type !== 'C' && f.type !== 'N' && f.type !== 'D') fail(`fields[${i}]: type must be C, N or D`);
    if (!Number.isInteger(f.length) || f.length < 1 || f.length > 254) fail(`fields[${i}]: bad length`);
    if (f.type === 'D' && f.length !== 8) fail(`fields[${i}]: a D field is 8 long`);
    if (!Number.isInteger(f.decimals) || f.decimals < 0 || f.decimals > 15) fail(`fields[${i}]: bad decimals`);
    return { name: f.name, type: f.type, length: f.length, decimals: f.decimals };
  });
  const records: DbfRecordSpec[] = [];
  const expectedCsv: string[][] = [t.fields.map((f) => f.name)];
  t.rows.forEach((row, ri) => {
    if (!Array.isArray(row) || row.length !== t.fields.length) fail(`rows[${ri}]: one value per field`);
    const values = row.map((v, ci) => cellBytes(t.fields[ci] as AuthoredField, v, `rows[${ri}][${ci}]`));
    records.push({ deleted: false, values });
    expectedCsv.push(
      row.map((v, ci) =>
        (t.fields[ci] as AuthoredField).type === 'D' ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : v,
      ),
    );
  });
  return { bytes: writeDbf({ fields, records }), expectedCsv };
}
