import { FixtureError } from './errors';

/**
 * RFC 4180 subset parser. Rows end at CRLF, LF or CR outside quotes; a final
 * terminator does not add a row. Quoted cells may hold commas, line breaks and
 * doubled quotes. Throws FixtureError on an unterminated quote or on text after
 * a closing quote, and returns no partial result.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;
  let afterQuote = false; // a quoted cell just closed
  let dirty = false; // something consumed since the last row terminator

  const endCell = (): void => {
    row.push(cell);
    cell = '';
    afterQuote = false;
  };
  const endRow = (): void => {
    endCell();
    rows.push(row);
    row = [];
    dirty = false;
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    dirty = true;
    if (ch === ',') {
      endCell();
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else if (afterQuote) {
      throw new FixtureError('csv-text-after-closing-quote', `at index ${i}`);
    } else if (ch === '"' && cell === '') {
      inQuotes = true;
    } else {
      cell += ch;
    }
  }
  if (inQuotes) throw new FixtureError('csv-unterminated-quote');
  if (dirty) endRow();
  return rows;
}

/**
 * Serializes one row without a line terminator. Written separately from the
 * production serializer: a cell is quoted when it holds a comma, quote, CR or LF,
 * and a lone empty cell is quoted so the row survives a parse.
 */
export function serializeCsvRow(cells: readonly string[]): string {
  const parts: string[] = [];
  for (const c of cells) {
    const needs = /[",\r\n]/.test(c) || (cells.length === 1 && c === '');
    parts.push(needs ? `"${c.split('"').join('""')}"` : c);
  }
  return parts.join(',');
}
