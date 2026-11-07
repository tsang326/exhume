import { CSV_MAX_ROWS, CSV_MAX_COLS } from './limits';

export interface CsvTable {
  rows: string[][]; // at most maxRows rows, each at most maxCols cells
  totalRows: number; // real record count
  totalCols: number; // real maximum cells in any record
  truncated: boolean; // totalRows > maxRows || totalCols > maxCols
}

const START = 0;
const UNQUOTED = 1;
const QUOTED = 2;
const QUOTE_SEEN = 3;

/**
 * RFC 4180 reader for display. One pass, total (never throws).
 * Counting continues past the display limits; only the first maxRows rows
 * and maxCols cells per row are stored.
 */
export function parseCsv(
  text: string,
  maxRows: number = CSV_MAX_ROWS,
  maxCols: number = CSV_MAX_COLS,
): CsvTable {
  const rows: string[][] = [];
  let totalRows = 0;
  let totalCols = 0;

  let state = START;
  let field = '';
  let cells: string[] = [];
  let count = 0;
  let open = false; // the current record has consumed at least one character

  const endField = (): void => {
    if (count < maxCols) cells.push(field);
    count++;
    field = '';
  };
  const endRecord = (): void => {
    endField();
    if (count > totalCols) totalCols = count;
    if (totalRows < maxRows) rows.push(cells);
    totalRows++;
    cells = [];
    count = 0;
    open = false;
    state = START;
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i] as string;
    if (state === QUOTED) {
      if (c === '"') state = QUOTE_SEEN;
      else field += c;
      continue;
    }
    if (state === QUOTE_SEEN && c === '"') {
      field += '"';
      state = QUOTED;
      continue;
    }
    if (c === ',') {
      endField();
      state = START;
      open = true;
    } else if (c === '\r' || c === '\n') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      endRecord();
    } else if (state === START && c === '"') {
      state = QUOTED;
      open = true;
    } else {
      // plain character, or literal text after a closing quote
      field += c;
      state = UNQUOTED;
      open = true;
    }
  }
  if (open || state === QUOTED || state === QUOTE_SEEN) endRecord();

  return { rows, totalRows, totalCols, truncated: totalRows > maxRows || totalCols > maxCols };
}
