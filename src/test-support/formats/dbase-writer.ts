import { FixtureError } from './errors';

export type KnownDbfType = 'C' | 'N' | 'F' | 'D' | 'L' | 'M';
/** Any single ASCII letter is accepted, so tests can write unknown field types. */
export type DbfType = KnownDbfType | (string & Record<never, never>);
export interface DbfFieldSpec {
  name: string; // 1..10 printable ASCII characters
  type: DbfType;
  length: number; // 1..254
  decimals: number; // 0..15
}
export interface DbfRecordSpec {
  deleted: boolean;
  values: Uint8Array[]; // raw field bytes, already padded to the field length
}
export interface DbfTable {
  fields: DbfFieldSpec[];
  records: DbfRecordSpec[]; // 0..65535
}

export const DBF_WRITER_MAX_RECORDS = 65535;
export const DBF_WRITER_MAX_FIELD_LENGTH = 254;
const MAX_FIELDS = 2047; // 32 + 32 * n + 1 must fit the 16-bit header length
const MAX_TOTAL_BYTES = 1 << 30;

function validate(table: DbfTable): number {
  if (table === null || typeof table !== 'object') throw new FixtureError('table', 'expected an object');
  const { fields, records } = table;
  if (!Array.isArray(fields) || fields.length > MAX_FIELDS) {
    throw new FixtureError('fields', `array of at most ${MAX_FIELDS}`);
  }
  if (!Array.isArray(records) || records.length > DBF_WRITER_MAX_RECORDS) {
    throw new FixtureError('records', `array of at most ${DBF_WRITER_MAX_RECORDS}`);
  }
  let recordLength = 1;
  fields.forEach((f, i) => {
    const where = `fields[${i}]`;
    if (f === null || typeof f !== 'object') throw new FixtureError(where, 'expected an object');
    if (typeof f.name !== 'string' || f.name.length < 1 || f.name.length > 10) {
      throw new FixtureError(`${where}.name`, '1..10 characters');
    }
    for (let k = 0; k < f.name.length; k++) {
      const c = f.name.charCodeAt(k);
      if (c < 0x21 || c > 0x7e) throw new FixtureError(`${where}.name`, 'printable ASCII only');
    }
    if (typeof f.type !== 'string' || f.type.length !== 1) {
      throw new FixtureError(`${where}.type`, 'a single ASCII letter');
    }
    const t = f.type.charCodeAt(0);
    if (!((t >= 0x41 && t <= 0x5a) || (t >= 0x61 && t <= 0x7a))) {
      throw new FixtureError(`${where}.type`, 'a single ASCII letter');
    }
    if (!Number.isInteger(f.length) || f.length < 1 || f.length > DBF_WRITER_MAX_FIELD_LENGTH) {
      throw new FixtureError(`${where}.length`, `integer 1..${DBF_WRITER_MAX_FIELD_LENGTH}`);
    }
    if (!Number.isInteger(f.decimals) || f.decimals < 0 || f.decimals > 15) {
      throw new FixtureError(`${where}.decimals`, 'integer 0..15');
    }
    recordLength += f.length;
  });
  if (recordLength > 0xffff) throw new FixtureError('fields', 'record length above 65535');
  records.forEach((r, ri) => {
    const where = `records[${ri}]`;
    if (r === null || typeof r !== 'object' || typeof r.deleted !== 'boolean') {
      throw new FixtureError(`${where}.deleted`, 'expected a boolean');
    }
    if (!Array.isArray(r.values) || r.values.length !== fields.length) {
      throw new FixtureError(`${where}.values`, 'one value per field');
    }
    r.values.forEach((v, vi) => {
      if (!(v instanceof Uint8Array) || v.length !== (fields[vi] as DbfFieldSpec).length) {
        throw new FixtureError(`${where}.values[${vi}]`, 'bytes of exactly the field length');
      }
    });
  });
  const total = 32 + 32 * fields.length + 1 + records.length * recordLength + 1;
  if (total > MAX_TOTAL_BYTES) throw new FixtureError('records', 'file would be too large');
  return recordLength;
}

/** Writes a dBase III file: header, descriptors, 0x0D, fixed-width records, 0x1A. */
export function writeDbf(table: DbfTable): Uint8Array {
  const recordLength = validate(table);
  const { fields, records } = table;
  const headerLength = 32 + 32 * fields.length + 1;
  const out = new Uint8Array(headerLength + records.length * recordLength + 1);
  const view = new DataView(out.buffer);
  out[0] = 0x03;
  out[1] = 0x7c; // fixed date 2024-01-01: no clock
  out[2] = 1;
  out[3] = 1;
  view.setUint32(4, records.length, true);
  view.setUint16(8, headerLength, true);
  view.setUint16(10, recordLength, true);
  fields.forEach((f, i) => {
    const base = 32 + 32 * i;
    for (let k = 0; k < f.name.length; k++) out[base + k] = f.name.charCodeAt(k);
    out[base + 11] = f.type.charCodeAt(0);
    out[base + 16] = f.length;
    out[base + 17] = f.decimals;
  });
  out[headerLength - 1] = 0x0d;
  let pos = headerLength;
  for (const r of records) {
    out[pos++] = r.deleted ? 0x2a : 0x20;
    for (const v of r.values) {
      out.set(v, pos);
      pos += v.length;
    }
  }
  out[pos] = 0x1a;
  return out;
}
