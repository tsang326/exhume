import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { numRuns } from '../../test-support/runs';
import { writeCsv } from '../../test-support/web/csv-writer';
import { parseCsv } from './csv-display';
import { CSV_MAX_ROWS, CSV_MAX_COLS } from './limits';

const cellArb = fc.oneof(
  fc.string({ maxLength: 12 }),
  fc.constantFrom('', ' ', ',', '"', '\r', '\n', '\r\n', 'a,"b"', 'é☃', '""'),
  fc.string({ unit: fc.constantFrom('a', ',', '"', '\r', '\n', ' ', 'é'), maxLength: 12 }),
);
const tableArb = fc.array(fc.array(cellArb, { minLength: 1, maxLength: 50 }), { maxLength: 200 });

function same(a: string[][], b: string[][]): boolean {
  return (
    a.length === b.length &&
    a.every((r, i) => r.length === (b[i] as string[]).length && r.every((c, j) => c === (b[i] as string[])[j]))
  );
}

describe('csv-display examples', () => {
  it('reads doubled quotes and CRLF', () => {
    const t = parseCsv('a,"b""c"\r\n');
    expect(t.rows).toEqual([['a', 'b"c']]);
    expect(t.totalRows).toBe(1);
    expect(t.totalCols).toBe(2);
    expect(t.truncated).toBe(false);
  });
  it('keeps an embedded CRLF inside quotes', () => {
    expect(parseCsv('"x\r\ny",z\r\n').rows).toEqual([['x\r\ny', 'z']]);
  });
  it('adds no extra record for a trailing terminator', () => {
    expect(parseCsv('a\r\nb\r\n').totalRows).toBe(2);
    expect(parseCsv('a\r\nb').totalRows).toBe(2);
    expect(parseCsv('a\nb\rc').rows).toEqual([['a'], ['b'], ['c']]);
  });
  it('takes the rest of the input for an unterminated quote', () => {
    expect(parseCsv('a,"b,c\r\nd').rows).toEqual([['a', 'b,c\r\nd']]);
  });
  it('yields zero rows for empty input', () => {
    expect(parseCsv('')).toEqual({ rows: [], totalRows: 0, totalCols: 0, truncated: false });
  });
  it('keeps text after a closing quote as literal', () => {
    expect(parseCsv('"a"b,c').rows).toEqual([['ab', 'c']]);
  });
});

describe('csv-display properties', () => {
  it('round-trips the reference writer', () => {
    // Feature: graveyard-ui, Property 24: CSV display parsing round-trips what the reference writer writes
    // **Validates: Requirements 9.9**
    fc.assert(
      fc.property(tableArb, (table) => {
        const t = parseCsv(writeCsv(table));
        return !t.truncated && t.totalRows === table.length && same(t.rows, table);
      }),
      { numRuns: numRuns(100) },
    );
  });

  it('never throws on any string and yields no rows for empty', () => {
    // Feature: graveyard-ui, Property 24: CSV display parsing round-trips what the reference writer writes
    // **Validates: Requirements 9.9**
    fc.assert(
      fc.property(fc.string({ unit: 'binary', maxLength: 200 }), (s) => {
        try {
          const t = parseCsv(s);
          return s !== '' || t.rows.length === 0;
        } catch {
          return false;
        }
      }),
      { numRuns: numRuns(100) },
    );
  });

  it('reports real sizes past the display limits', () => {
    // Feature: graveyard-ui, Property 25: CSV display limits report real sizes
    // **Validates: Requirements 9.8**
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 300 }),
        fc.array(fc.integer({ min: 1, max: 80 }), { minLength: 1, maxLength: 5 }),
        (rowCount, widthPool) => {
          const table: string[][] = [];
          for (let r = 0; r < rowCount; r++) {
            const w = widthPool[r % widthPool.length] as number;
            table.push(Array.from({ length: w }, (_, c) => `r${r}c${c}`));
          }
          const t = parseCsv(writeCsv(table));
          const realCols = rowCount === 0 ? 0 : Math.max(...widthPool.slice(0, Math.min(rowCount, widthPool.length)));
          return (
            t.rows.length === Math.min(rowCount, CSV_MAX_ROWS) &&
            t.rows.every((r) => r.length <= CSV_MAX_COLS) &&
            t.totalRows === rowCount &&
            t.totalCols === realCols &&
            t.truncated === (rowCount > CSV_MAX_ROWS || realCols > CSV_MAX_COLS)
          );
        },
      ),
      { numRuns: numRuns(100) },
    );
  });

  it('honours custom limits', () => {
    // Feature: graveyard-ui, Property 25: CSV display limits report real sizes
    // **Validates: Requirements 9.8**
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 1, max: 6 }),
        fc.integer({ min: 0, max: 12 }),
        fc.integer({ min: 1, max: 12 }),
        (maxRows, maxCols, rowCount, cols) => {
          const table = Array.from({ length: rowCount }, (_, r) =>
            Array.from({ length: cols }, (_, c) => `${r}.${c}`),
          );
          const t = parseCsv(writeCsv(table), maxRows, maxCols);
          const realCols = rowCount === 0 ? 0 : cols;
          return (
            t.rows.length === Math.min(rowCount, maxRows) &&
            t.rows.every((r) => r.length === Math.min(cols, maxCols)) &&
            t.totalRows === rowCount &&
            t.totalCols === realCols &&
            t.truncated === (rowCount > maxRows || realCols > maxCols)
          );
        },
      ),
      { numRuns: numRuns(100) },
    );
  });
});
