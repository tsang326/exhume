import { describe, expect, it } from 'vitest';
import { convertDBase, runDBase } from './dbase';
import { MAX_CONVERT_INPUT_BYTES, MAX_CSV_OUTPUT_BYTES, MAX_DBF_FIELDS, MAX_WARNINGS } from './limits';
import type { CsvResult } from './types';
import { parseCsv, writeDbf } from '../../test-support/formats';
import type { DbfFieldSpec } from '../../test-support/formats';
import { checkResultInvariants } from '../../test-support/formats/invariants';
import { timed } from '../../test-support/timed';

function ascii(s: string, length: number, left = false): Uint8Array {
  const padded = left ? s.padStart(length, ' ') : s.padEnd(length, ' ');
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = padded.charCodeAt(i);
  return out;
}

function ok(r: CsvResult): { output: string; codes: string[] } {
  if (!r.ok) throw new Error('expected success: ' + r.error);
  return { output: r.output, codes: r.warnings.map((w) => w.code) };
}

function valid(r: CsvResult): void {
  expect(checkResultInvariants(r)).toEqual([]);
}

const ALL_TYPES: DbfFieldSpec[] = [
  { name: 'NAME', type: 'C', length: 5, decimals: 0 },
  { name: 'AMT', type: 'N', length: 8, decimals: 2 },
  { name: 'DAY', type: 'D', length: 8, decimals: 0 },
  { name: 'OK', type: 'L', length: 1, decimals: 0 },
  { name: 'NOTE', type: 'M', length: 10, decimals: 0 },
];

function allTypesRow(name: string, amt: string, day: string, flag: string, deleted = false) {
  return {
    deleted,
    values: [ascii(name, 5), ascii(amt, 8, true), ascii(day, 8), ascii(flag, 1), ascii('', 10)],
  };
}

const oneField: DbfFieldSpec[] = [{ name: 'C', type: 'C', length: 1, decimals: 0 }];
const xRow = { deleted: false, values: [ascii('x', 1)] };

describe('convertDBase examples', () => {
  it('writes every field type once with exact CSV text and one memo warning', () => {
    const bytes = writeDbf({
      fields: ALL_TYPES,
      records: [
        allTypesRow('abc', '-12.50', '20240229', 'T'),
        allTypesRow('def', '3', '        ', 'F'),
        allTypesRow('ghi', '0', '', '?'),
      ],
    });
    const r = convertDBase(bytes);
    valid(r);
    const { output, codes } = ok(r);
    expect(output).toBe(
      'NAME,AMT,DAY,OK,NOTE\r\n' +
        'abc,-12.50,2024-02-29,TRUE,\r\n' +
        'def,3,,FALSE,\r\n' +
        'ghi,0,,,\r\n',
    );
    expect(codes).toEqual(['memo-not-available']);
    expect(parseCsv(output)[1]).toEqual(['abc', '-12.50', '2024-02-29', 'TRUE', '']);
  });

  it('skips a deleted record and reports the count', () => {
    const bytes = writeDbf({
      fields: oneField,
      records: [xRow, { deleted: true, values: [ascii('y', 1)] }, { deleted: true, values: [ascii('z', 1)] }, xRow],
    });
    const r = convertDBase(bytes);
    valid(r);
    expect(ok(r).output).toBe('C\r\nx\r\nx\r\n');
    expect(r.warnings).toEqual([{ code: 'deleted-records-skipped', message: '2 deleted records skipped' }]);
  });

  it('reads an unknown deletion flag as active with one record-flag-unknown', () => {
    const bytes = writeDbf({ fields: oneField, records: [xRow, xRow] });
    const headerLength = 32 + 32 + 1;
    bytes[headerLength] = 0x41;
    bytes[headerLength + 2] = 0x42;
    const r = convertDBase(bytes);
    valid(r);
    expect(ok(r).output).toBe('C\r\nx\r\nx\r\n');
    expect(ok(r).codes).toEqual(['record-flag-unknown']);
  });

  it('caps warnings at 100 plus one warnings-capped for 128 unknown-type fields', () => {
    const fields: DbfFieldSpec[] = [];
    for (let i = 0; i < MAX_DBF_FIELDS; i++) {
      fields.push({ name: 'F' + i, type: 'X', length: 1, decimals: 0 });
    }
    const r = convertDBase(writeDbf({ fields, records: [] }));
    valid(r);
    const { codes } = ok(r);
    expect(codes).toHaveLength(MAX_WARNINGS + 1);
    expect(codes.slice(0, MAX_WARNINGS).every((c) => c === 'field-type-unknown')).toBe(true);
    expect(codes[MAX_WARNINGS]).toBe('warnings-capped');
  });

  it.each([0, 10, 31])('rejects a %i byte input with condition 2', (n) => {
    const r = convertDBase(new Uint8Array(n));
    valid(r);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('dBase header invalid: condition 2');
  });

  it('rejects an unsupported version', () => {
    const bytes = writeDbf({ fields: oneField, records: [xRow] });
    bytes[0] = 0x04;
    const r = convertDBase(bytes);
    valid(r);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('unsupported dBase version 4');
  });
});

describe('dBase output cap', () => {
  // The real cap is NOT reachable from a legal input. Input is cut to 4 MiB
  // (MAX_CONVERT_INPUT_BYTES) and each input byte yields at most 3 UTF-8 bytes
  // (CP437 box characters; a '"' is 1 byte, doubled to 2), so output is below
  // 12 MiB, under MAX_CSV_OUTPUT_BYTES (16 MiB). The cap is driven through the
  // runDBase seam with a small cap instead.
  it('stays under the real cap for a maximum-expansion 4 MiB table', () => {
    const length = 254;
    const recordCount = Math.floor((MAX_CONVERT_INPUT_BYTES - 66) / (length + 1));
    const value = new Uint8Array(length).fill(0xb0);
    const fields: DbfFieldSpec[] = [{ name: 'C', type: 'C', length, decimals: 0 }];
    const bytes = writeDbf({
      fields,
      records: Array.from({ length: recordCount }, () => ({ deleted: false, values: [value] })),
    });
    expect(bytes.length).toBeLessThanOrEqual(MAX_CONVERT_INPUT_BYTES);
    const r = timed(() => convertDBase(bytes));
    valid(r);
    const { output, codes } = ok(r);
    expect(codes).not.toContain('output-capped');
    const size = new TextEncoder().encode(output).length;
    expect(size).toBe(3 + recordCount * (length * 3 + 2));
    expect(size).toBeLessThan(MAX_CSV_OUTPUT_BYTES);
  });

  it('stops after the last complete row that fits a small cap', () => {
    const bytes = writeDbf({ fields: oneField, records: [xRow, xRow, xRow, xRow, xRow] });
    const r = runDBase(bytes, 9);
    valid(r);
    expect(ok(r).output).toBe('C\r\nx\r\nx\r\n');
    expect(ok(r).codes).toEqual(['output-capped']);
  });

  it('writes nothing when the header row alone exceeds the cap', () => {
    const bytes = writeDbf({ fields: oneField, records: [xRow] });
    const r = runDBase(bytes, 2);
    valid(r);
    expect(ok(r).output).toBe('');
    expect(ok(r).codes).toEqual(['output-capped']);
  });
});
