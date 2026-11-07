import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import { numRuns } from '../../test-support/runs';
import { parseCsv, serializeCsvRow } from '../../test-support/formats';
import { csvCell, csvRow, formulaGuard } from './csv';

/**
 * Feature: format-resurrection, Property 24: CSV serialization round trip
 * **Validates: Requirements 8.2, 8.3, 8.10**
 */

const ALPHABET = [',', '"', '\r', '\n', ' ', 'a', 'b', 'Z', '0', '=', '+', '-', '@', '\t', 'é', 'ñ', 'ü', '─', '│', '█', '☺'];
const cellArb = fc.oneof(
  fc.constant(''),
  fc.array(fc.constantFrom(...ALPHABET), { maxLength: 12 }).map((a) => a.join('')),
);
const rowArb = fc.array(cellArb, { minLength: 1, maxLength: 8 });
const docArb = fc.array(rowArb, { minLength: 1, maxLength: 5 });

const plain = (c: string): string => csvCell(c);
const sameRow = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/** Count CRLF terminators that sit outside quotes. */
function terminatorsOutsideQuotes(text: string): number {
  let inQuotes = false;
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') inQuotes = !inQuotes; // doubled quotes toggle twice
    else if (!inQuotes && ch === '\r' && text[i + 1] === '\n') {
      n++;
      i++;
    }
  }
  return n;
}

describe('Property 24: CSV serialization round trip', () => {
  it('a row parses back to the original cells', () => {
    fc.assert(
      fc.property(rowArb, (cells) => {
        const rows = parseCsv(csvRow(cells.map(plain)));
        return rows.length === 1 && sameRow(rows[0] as string[], cells);
      }),
      { numRuns: numRuns(100) },
    );
  });

  it('with the guard the parsed cell equals formulaGuard(cell)', () => {
    fc.assert(
      fc.property(rowArb, (cells) => {
        const rows = parseCsv(csvRow(cells.map((c) => csvCell(c, { guard: true }))));
        return rows.length === 1 && sameRow(rows[0] as string[], cells.map(formulaGuard));
      }),
      { numRuns: numRuns(100) },
    );
  });

  it('multi-row documents parse into the input rows with one CRLF terminator per row', () => {
    fc.assert(
      fc.property(docArb, (doc) => {
        const text = doc.map((r) => csvRow(r.map(plain))).join('');
        const rows = parseCsv(text);
        return (
          rows.length === doc.length &&
          rows.every((r, i) => sameRow(r, doc[i] as string[])) &&
          text.endsWith('\r\n') &&
          terminatorsOutsideQuotes(text) === doc.length
        );
      }),
      { numRuns: numRuns(100) },
    );
  });

  it('cells without comma, quote, CR or LF are written unquoted', () => {
    fc.assert(
      fc.property(cellArb, (c) => {
        const special = /[",\r\n]/.test(c);
        const out = csvCell(c);
        return special ? out.startsWith('"') && out.endsWith('"') : out === c;
      }),
      { numRuns: numRuns(100) },
    );
  });

  it('matches the independent serializer, except a lone empty cell which it quotes', () => {
    fc.assert(
      fc.property(rowArb, (cells) => {
        const mine = csvRow(cells.map(plain));
        if (cells.length === 1 && cells[0] === '') return mine === '\r\n' && serializeCsvRow(cells) === '""';
        return mine === serializeCsvRow(cells) + '\r\n';
      }),
      { numRuns: numRuns(100) },
    );
  });
});
