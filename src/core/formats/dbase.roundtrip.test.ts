import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { dbfCleanTableArb, dbfTableArb } from '../../test-support/formats/arbitraries';
import { parseCsv } from '../../test-support/formats/csv-parser';
import type { DbfTable } from '../../test-support/formats/dbase-writer';
import { writeDbf } from '../../test-support/formats/dbase-writer';
import { checkResultInvariants } from '../../test-support/formats/invariants';
import { expectedCell, expectedFieldName, expectedFormulaGuard } from '../../test-support/formats/oracles';
import { numRuns } from '../../test-support/runs';
import { convertDBase } from './dbase';
import { CONVERT_TIME_BUDGET_MS, MAX_DBF_RECORDS } from './limits';
import { TEMPLATES, fill } from './templates';
import { timed } from '../../test-support/timed';
import type { ConversionWarning } from './types';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function nameBytes(name: string): Uint8Array {
  const b = new Uint8Array(11);
  for (let i = 0; i < name.length; i++) b[i] = name.charCodeAt(i);
  return b;
}

function expectedHeader(table: DbfTable): string[] {
  return table.fields.map((f) => expectedFormulaGuard(expectedFieldName(nameBytes(f.name))));
}

/** Rows for the records whose index passes `isActive`, in file order. */
function expectedRows(table: DbfTable, isActive: (index: number) => boolean): string[][] {
  const rows: string[][] = [];
  table.records.forEach((r, ri) => {
    if (!isActive(ri)) return;
    rows.push(
      table.fields.map((f, i) => {
        const text = expectedCell(f.type, r.values[i] as Uint8Array).text;
        return f.type === 'C' ? expectedFormulaGuard(text) : text;
      }),
    );
  });
  return rows;
}

/** Counts CRLF pairs that are outside double quotes. */
function crlfOutsideQuotes(s: string): number {
  let inQuotes = false;
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i);
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === '\r' && s.charAt(i + 1) === '\n') n++;
  }
  return n;
}

function codes(warnings: ConversionWarning[]): string[] {
  return warnings.map((w) => w.code);
}

function countOf(warnings: ConversionWarning[], code: string): number {
  return warnings.filter((w) => w.code === code).length;
}

/** Checks rows/header/CRLF/warnings; returns a failure description or '' when fine. */
function structuralProblem(
  table: DbfTable,
  file: Uint8Array,
  isActive: (index: number) => boolean,
  deletedCount: number,
  allowedExtra: string[],
): string {
  const result = convertDBase(file);
  const violations = checkResultInvariants(result);
  if (violations.length > 0) return 'invariants: ' + violations.join('; ');
  if (!result.ok) return 'conversion failed: ' + result.error;
  const rows = parseCsv(result.output);
  const want = [expectedHeader(table), ...expectedRows(table, isActive)];
  if (JSON.stringify(rows) !== JSON.stringify(want)) return 'rows differ';
  if (crlfOutsideQuotes(result.output) !== rows.length) return 'CRLF count differs from row count';
  const deletedWarnings = result.warnings.filter((w) => w.code === 'deleted-records-skipped');
  if (deletedCount === 0) {
    if (deletedWarnings.length !== 0) return 'unexpected deleted-records-skipped';
  } else if (deletedWarnings.length !== 1 || deletedWarnings[0]?.message !== `${deletedCount} deleted records skipped`) {
    return 'deleted-records-skipped missing or wrong count';
  }
  const hasMemo = table.fields.some((f) => f.type === 'M');
  const memoWarnings = countOf(result.warnings, 'memo-not-available');
  if (memoWarnings !== (hasMemo ? 1 : 0)) return 'memo-not-available mismatch';
  const allowed = new Set(['deleted-records-skipped', 'memo-not-available', ...allowedExtra]);
  for (const c of codes(result.warnings)) if (!allowed.has(c)) return 'unexpected warning ' + c;
  return '';
}

const unknownFlagArb = fc.integer({ min: 0, max: 255 }).filter((b) => b !== 0x20 && b !== 0x2a);

// ---------------------------------------------------------------------------
// Property 17: dBase to CSV round trip
// Validates: Requirements 6.1, 6.2, 6.7, 6.8, 6.10, 7.1, 7.2, 7.3, 7.4, 7.16, 8.1, 8.8, 8.9, 13.2
// ---------------------------------------------------------------------------

describe('Property 17: dBase to CSV round trip', () => {
  it('clean tables: header, active rows in order, CRLF count, only expected warnings', () => {
    fc.assert(
      fc.property(dbfCleanTableArb, (table) => {
        const deleted = table.records.filter((r) => r.deleted).length;
        const problem = structuralProblem(table, writeDbf(table), (i) => !(table.records[i] as { deleted: boolean }).deleted, deleted, []);
        return problem === '';
      }),
      { numRuns: numRuns(100) },
    );
  });

  it('any table: header, active rows, deleted count and CRLF count', () => {
    fc.assert(
      fc.property(dbfTableArb, (table) => {
        const deleted = table.records.filter((r) => r.deleted).length;
        const result = convertDBase(writeDbf(table));
        if (checkResultInvariants(result).length > 0 || !result.ok) return false;
        const rows = parseCsv(result.output);
        const want = [expectedHeader(table), ...expectedRows(table, (i) => !(table.records[i] as { deleted: boolean }).deleted)];
        if (JSON.stringify(rows) !== JSON.stringify(want)) return false;
        if (crlfOutsideQuotes(result.output) !== rows.length) return false;
        const del = result.warnings.filter((w) => w.code === 'deleted-records-skipped');
        return deleted === 0 ? del.length === 0 : del.length === 1 && del[0]?.message === `${deleted} deleted records skipped`;
      }),
      { numRuns: numRuns(100) },
    );
  });

  it('unknown record flags warn exactly once and the record is read as active', () => {
    const arb = dbfCleanTableArb
      .filter((t) => t.records.length > 0)
      .chain((table) =>
        fc.record({
          table: fc.constant(table),
          flags: fc.array(fc.option(unknownFlagArb, { nil: undefined }), {
            minLength: table.records.length,
            maxLength: table.records.length,
          }),
        }),
      )
      .filter(({ flags }) => flags.some((f) => f !== undefined));
    fc.assert(
      fc.property(arb, ({ table, flags }) => {
        const file = writeDbf(table);
        const headerLength = file[8] + file[9] * 256;
        const recordLength = file[10] + file[11] * 256;
        flags.forEach((f, i) => {
          if (f !== undefined) file[headerLength + i * recordLength] = f;
        });
        const isActive = (i: number): boolean => flags[i] !== undefined || !(table.records[i] as { deleted: boolean }).deleted;
        const deleted = table.records.filter((r, i) => r.deleted && flags[i] === undefined).length;
        const result = convertDBase(file);
        if (!result.ok) return false;
        if (countOf(result.warnings, 'record-flag-unknown') !== 1) return false;
        return structuralProblem(table, file, isActive, deleted, ['record-flag-unknown']) === '';
      }),
      { numRuns: numRuns(100) },
    );
  });

  it('zero active records gives the header row only', () => {
    const arb = dbfCleanTableArb.map((t) => ({
      fields: t.fields,
      records: t.records.map((r) => ({ ...r, deleted: true })),
    }));
    fc.assert(
      fc.property(arb, (table) => {
        const result = convertDBase(writeDbf(table));
        if (!result.ok || checkResultInvariants(result).length > 0) return false;
        const rows = parseCsv(result.output);
        return rows.length === 1 && JSON.stringify(rows[0]) === JSON.stringify(expectedHeader(table));
      }),
      { numRuns: numRuns(100) },
    );
  });

  it('a larger declared record length warns and leaves the results unchanged', () => {
    const arb = fc.record({
      table: dbfCleanTableArb,
      extra: fc.integer({ min: 1, max: 12 }),
      pad: fc.integer({ min: 0, max: 255 }),
    });
    fc.assert(
      fc.property(arb, ({ table, extra, pad }) => {
        const base = writeDbf(table);
        const headerLength = base[8] + base[9] * 256;
        const recordLength = base[10] + base[11] * 256;
        const newLength = recordLength + extra;
        const out = new Uint8Array(headerLength + table.records.length * newLength + 1);
        out.set(base.subarray(0, headerLength));
        out[10] = newLength & 0xff;
        out[11] = newLength >> 8;
        for (let r = 0; r < table.records.length; r++) {
          const from = headerLength + r * recordLength;
          const to = headerLength + r * newLength;
          out.set(base.subarray(from, from + recordLength), to);
          out.fill(pad, to + recordLength, to + newLength);
        }
        out[out.length - 1] = 0x1a;
        const a = convertDBase(base);
        const b = convertDBase(out);
        if (!a.ok || !b.ok || checkResultInvariants(b).length > 0) return false;
        if (a.output !== b.output) return false;
        if (countOf(b.warnings, 'record-length-mismatch') !== 1) return false;
        const rest = b.warnings.filter((w) => w.code !== 'record-length-mismatch');
        return JSON.stringify(rest) === JSON.stringify(a.warnings);
      }),
      { numRuns: numRuns(100) },
    );
  });

  it('example: one deleted record and one active record', () => {
    const table: DbfTable = {
      fields: [{ name: 'NAME', type: 'C', length: 8, decimals: 0 }],
      records: [
        { deleted: true, values: [Uint8Array.from(Buffer.from('gone    '))] },
        { deleted: false, values: [Uint8Array.from(Buffer.from('=SUM(A) '))] },
      ],
    };
    const result = convertDBase(writeDbf(table));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.output).toBe("NAME\r\n'=SUM(A)\r\n");
      expect(codes(result.warnings)).toEqual(['deleted-records-skipped']);
    }
  });
});

// ---------------------------------------------------------------------------
// Property 18: Record count arithmetic
// Validates: Requirements 6.11, 6.12, 8.11
// ---------------------------------------------------------------------------

function patchCount(file: Uint8Array, declared: number): void {
  new DataView(file.buffer, file.byteOffset, file.byteLength).setUint32(4, declared, true);
}

/** Checks the record-count warnings against the declared and read counts; '' when fine. */
function countWarningsProblem(warnings: ConversionWarning[], declared: number, read: number): string {
  const truncated = warnings.filter((w) => w.code === 'records-truncated');
  if (declared > read) {
    if (truncated.length !== 1) return 'records-truncated count ' + truncated.length;
    if (truncated[0]?.message !== fill(TEMPLATES.recordsTruncated, declared, read)) return 'records-truncated message';
  } else if (truncated.length !== 0) return 'unexpected records-truncated';
  const limit = warnings.filter((w) => w.code === 'record-limit');
  if (declared > MAX_DBF_RECORDS) {
    if (limit.length !== 1) return 'record-limit count ' + limit.length;
    if (limit[0]?.message !== TEMPLATES.recordLimit) return 'record-limit message';
  } else if (limit.length !== 0) return 'unexpected record-limit';
  return '';
}

describe('Property 18: Record count arithmetic', () => {
  const declaredArb = (real: number): fc.Arbitrary<number> =>
    fc.oneof(
      fc.constantFrom(0, 1, real, real + 1, 65535, 65536, 100000, 100001, 4294967295, 2147483648),
      fc.integer({ min: 0, max: 40 }).map((k) => real + k),
    );

  it('rows read, truncation and limit warnings follow the arithmetic for any declared count and cut', () => {
    const arb = fc.record({
      table: dbfCleanTableArb,
      pick: fc.nat(),
      mode: fc.constantFrom('none', 'whole', 'mid'),
      k: fc.nat(),
      extra: fc.nat(),
      decl: fc.nat(),
    });
    fc.assert(
      fc.property(arb, ({ table, pick, mode, k, extra, decl }) => {
        const file = writeDbf(table);
        const headerLength = file[8] + file[9] * 256;
        const recordLength = file[10] + file[11] * 256;
        const real = table.records.length;
        const declared = fc.sample(declaredArb(real), { seed: decl + pick, numRuns: 1 })[0] as number;
        let cut = file.length;
        if (mode === 'whole') cut = headerLength + (k % (real + 1)) * recordLength;
        else if (mode === 'mid' && real > 0) {
          cut = headerLength + (k % real) * recordLength + 1 + (extra % (recordLength - 1));
        }
        const bytes = file.slice(0, cut);
        patchCount(bytes, declared);
        const physical = Math.floor((cut - headerLength) / recordLength);
        const n = Math.min(declared, MAX_DBF_RECORDS, physical);
        const sub: DbfTable = { fields: table.fields, records: table.records.slice(0, n) };
        const deleted = sub.records.filter((r) => r.deleted).length;
        const result = convertDBase(bytes);
        if (!result.ok) return false;
        const problem = structuralProblem(
          sub,
          bytes,
          (i) => !(sub.records[i] as { deleted: boolean }).deleted,
          deleted,
          ['records-truncated', 'record-limit'],
        );
        if (problem !== '') return false;
        return countWarningsProblem(result.warnings, declared, n) === '' && parseCsv(result.output).length <= 1 + MAX_DBF_RECORDS;
      }),
      { numRuns: numRuns(100) },
    );
  });

  it('zero declared records reads the header row only', () => {
    fc.assert(
      fc.property(dbfCleanTableArb, (table) => {
        const file = writeDbf(table);
        patchCount(file, 0);
        const result = convertDBase(file);
        if (!result.ok || checkResultInvariants(result).length > 0) return false;
        const rows = parseCsv(result.output);
        return rows.length === 1 && countWarningsProblem(result.warnings, 0, 0) === '';
      }),
      { numRuns: numRuns(100) },
    );
  });

  it('a real table above MAX_DBF_RECORDS is limited, warned once and converted in time', () => {
    const base = writeDbf({
      fields: [{ name: 'A', type: 'C', length: 1, decimals: 0 }],
      records: [{ deleted: false, values: [Uint8Array.of(0x78)] }],
    });
    const headerLength = base[8] + base[9] * 256;
    const recordLength = base[10] + base[11] * 256;
    expect(recordLength).toBe(2);
    const total = MAX_DBF_RECORDS + 1;
    const big = new Uint8Array(headerLength + total * recordLength + 1);
    big.set(base.subarray(0, headerLength));
    for (let i = 0; i < total; i++) {
      big[headerLength + i * recordLength] = 0x20;
      big[headerLength + i * recordLength + 1] = 0x78;
    }
    big[big.length - 1] = 0x1a;
    for (const declared of [total, 4294967295, MAX_DBF_RECORDS, MAX_DBF_RECORDS - 1]) {
      patchCount(big, declared);
      const result = timed(() => convertDBase(big), CONVERT_TIME_BUDGET_MS);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const read = Math.min(declared, MAX_DBF_RECORDS);
      expect(parseCsv(result.output).length).toBe(1 + read);
      expect(countWarningsProblem(result.warnings, declared, read)).toBe('');
    }
  });
});
