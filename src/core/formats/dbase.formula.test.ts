import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { numRuns } from '../../test-support/runs';
import { writeDbf } from '../../test-support/formats';
import type { DbfFieldSpec, DbfTable } from '../../test-support/formats';
import { dbfNeedsRepairTableArb } from '../../test-support/formats/arbitraries';
import { parseCsv } from '../../test-support/formats/csv-parser';
import { convertDBase } from './dbase';

// Feature: format-resurrection, Property 25: Formula prefixes are neutralised
// **Validates: Requirements 8.4, 8.5, 8.6**

const PREFIXES = '=+-@\t\r';
const isPrefix = (ch: string): boolean => ch !== '' && PREFIXES.includes(ch);

/** Model of a C cell: trailing spaces/NULs trimmed, control bytes become spaces. */
function modelText(bytes: Uint8Array): string {
  let end = bytes.length;
  while (end > 0 && (bytes[end - 1] === 0x20 || bytes[end - 1] === 0x00)) end--;
  let s = '';
  for (let i = 0; i < end; i++) {
    const b = bytes[i] as number;
    s += b < 0x20 || b === 0x7f ? ' ' : String.fromCharCode(b);
  }
  return s;
}

const guarded = (s: string): string => (s !== '' && '=+-@'.includes(s.charAt(0)) ? "'" + s : s);
const quoteRaw = (s: string): string => '"' + s.split('"').join('""') + '"';
const needsQuotes = (s: string): boolean => /[,"\r\n]/.test(s);

/** Non-C cells: empty, digit start, T, F, or minus then a digit. */
function typedCellOk(cell: string): boolean {
  if (cell === '') return true;
  const c = cell.charAt(0);
  if (c >= '0' && c <= '9') return true;
  if (c === 'T' || c === 'F') return true;
  return c === '-' && cell.length > 1 && cell.charAt(1) >= '0' && cell.charAt(1) <= '9';
}

function check(table: DbfTable): boolean {
  const res = convertDBase(writeDbf(table));
  if (!res.ok) return false;
  let rows: string[][];
  try {
    rows = parseCsv(res.output);
  } catch {
    return false;
  }
  const live = table.records.filter((r) => !r.deleted);
  if (rows.length !== 1 + live.length) return false;

  const header = rows[0] as string[];
  if (header.length !== table.fields.length) return false;
  for (let k = 0; k < table.fields.length; k++) {
    const name = (table.fields[k] as DbfFieldSpec).name;
    const cell = header[k] as string;
    if (cell !== guarded(name)) return false;
    // Any surviving prefix character must sit behind the guard quote.
    if (isPrefix(cell.charAt(0))) return false;
  }
  for (let r = 0; r < live.length; r++) {
    const row = rows[r + 1] as string[];
    if (row.length !== table.fields.length) return false;
    for (let k = 0; k < table.fields.length; k++) {
      const f = table.fields[k] as DbfFieldSpec;
      const cell = row[k] as string;
      if (f.type === 'C') {
        const original = modelText((live[r] as { values: Uint8Array[] }).values[k] as Uint8Array);
        if (cell !== guarded(original)) return false;
        if (isPrefix(cell.charAt(0))) return false;
        if (original !== '' && '=+-@'.includes(original.charAt(0)) && cell.length !== original.length + 1) return false;
        if (needsQuotes(guarded(original)) && !res.output.includes(quoteRaw(guarded(original)))) return false;
      } else if (!typedCellOk(cell)) {
        return false;
      }
    }
  }
  return true;
}

// --- generators -------------------------------------------------------------

const ascii = (s: string, n: number): Uint8Array => {
  const out = new Uint8Array(n).fill(0x20);
  for (let i = 0; i < Math.min(s.length, n); i++) out[i] = s.charCodeAt(i);
  return out;
};

const bodyArb = fc
  .array(fc.constantFrom(...'abcXYZ 019,"\n\t.;-=+@'.split('')), { minLength: 0, maxLength: 14 })
  .map((c) => c.join(''));
const cTextArb = fc.oneof(
  bodyArb,
  fc.tuple(fc.constantFrom('=', '+', '-', '@', '\t', '\r'), bodyArb).map(([p, t]) => p + t),
);
const typedTextArb: Record<string, fc.Arbitrary<string>> = {
  N: fc.constantFrom('-5', '12.50', '-0.5', '+', '--5', 'abc', '=1', '1e5', ''),
  F: fc.constantFrom('-5', '12.50', '-0.5', '+', '--5', 'abc', '@x', ''),
  D: fc.constantFrom('20240101', '20240230', '=2024011', '-0000101', 'ABCDEFGH', '        '),
  L: fc.constantFrom('T', 'F', 'Y', 'n', '?', ' ', '-', '=', '@', '+'),
};

const hostileTableArb: fc.Arbitrary<DbfTable> = fc
  .array(
    fc.record({
      prefix: fc.constantFrom('', '=', '+', '-', '@'),
      type: fc.constantFrom('C', 'C', 'N', 'F', 'D', 'L'),
    }),
    { minLength: 1, maxLength: 5 },
  )
  .chain((specs) => {
    const fields: DbfFieldSpec[] = specs.map((s, i) => ({
      name: `${s.prefix}cmd${i}`,
      type: s.type,
      length: s.type === 'D' ? 8 : s.type === 'L' ? 1 : 16,
      decimals: s.type === 'N' || s.type === 'F' ? 2 : 0,
    }));
    return fc
      .array(
        fc.record({
          deleted: fc.boolean(),
          values: fc.tuple(
            ...fields.map((f) =>
              (f.type === 'C' ? cTextArb : (typedTextArb[f.type] as fc.Arbitrary<string>)).map((t) =>
                ascii(f.type === 'N' || f.type === 'F' ? t.padStart(f.length) : t, f.length),
              ),
            ),
          ) as unknown as fc.Arbitrary<Uint8Array[]>,
        }),
        { minLength: 0, maxLength: 8 },
      )
      .map((records) => ({ fields, records }));
  });

describe('Property 25: formula prefixes are neutralised', () => {
  it('guards names and C cells and leaves typed cells unguarded (needs-repair tables)', () => {
    fc.assert(
      fc.property(dbfNeedsRepairTableArb, (t) => check(t)),
      { numRuns: numRuns(100) },
    );
  });

  it('guards hostile field names and prefixed C values', () => {
    fc.assert(
      fc.property(hostileTableArb, (t) => check(t)),
      { numRuns: numRuns(150) },
    );
  });

  it('neutralises the targeted hostile file', () => {
    const fields: DbfFieldSpec[] = [
      { name: '=cmd', type: 'C', length: 12, decimals: 0 },
      { name: '+SUM', type: 'C', length: 12, decimals: 0 },
      { name: '-neg', type: 'N', length: 8, decimals: 0 },
      { name: '@name', type: 'C', length: 12, decimals: 0 },
    ];
    const table: DbfTable = {
      fields,
      records: [
        {
          deleted: false,
          values: [ascii('=1,2', 12), ascii('+1', 12), ascii('-5'.padStart(8), 8), ascii('@SUM(A1)', 12)],
        },
        { deleted: false, values: [ascii('-1', 12), ascii('plain', 12), ascii('7'.padStart(8), 8), ascii('', 12)] },
      ],
    };
    const res = convertDBase(writeDbf(table));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(parseCsv(res.output)).toEqual([
      ["'=cmd", "'+SUM", "'-neg", "'@name"],
      ["'=1,2", "'+1", '-5', "'@SUM(A1)"],
      ["'-1", 'plain', '7', ''],
    ]);
    expect(res.output).toContain('"\'=1,2"');
    expect(check(table)).toBe(true);
  });
});
