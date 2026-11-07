/**
 * CSV cell and row serialisation (RFC 4180, CRLF rows) with the spreadsheet
 * formula guard. Pure functions, no regular expressions.
 *
 * Guard usage: the guard belongs to text ('C' type) cells and field names only.
 * Numeric, float, date and logical cells are exempt, since a negative number
 * legitimately starts with '-'. Callers opt in per cell with
 * `csvCell(text, { guard: true })`; the default is no guard.
 * The guard runs BEFORE quoting, so the apostrophe sits inside the quotes.
 */

export interface CsvCellOptions {
  /** Apply formulaGuard before quoting. Default false. */
  readonly guard?: boolean;
}

/** Prefix "'" when the text starts with = + - @ TAB or CR. */
export function formulaGuard(text: string): string {
  if (text.length === 0) return text;
  const c = text.charCodeAt(0);
  // '=' 0x3D, '+' 0x2B, '-' 0x2D, '@' 0x40, TAB 0x09, CR 0x0D
  if (c === 0x3d || c === 0x2b || c === 0x2d || c === 0x40 || c === 0x09 || c === 0x0d) {
    return "'" + text;
  }
  return text;
}

/** Quote when the text holds a comma, double quote, CR or LF; double inner quotes. */
export function csvCell(text: string, options?: CsvCellOptions): string {
  const s = options !== undefined && options.guard === true ? formulaGuard(text) : text;
  let needsQuotes = false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x2c || c === 0x22 || c === 0x0d || c === 0x0a) {
      needsQuotes = true;
      break;
    }
  }
  if (!needsQuotes) return s;
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i);
    out += ch === '"' ? '""' : ch;
  }
  return out + '"';
}

/** Cells (already serialised by csvCell) joined by commas; always ends with CRLF. */
export function csvRow(cells: readonly string[]): string {
  let out = '';
  for (let i = 0; i < cells.length; i++) {
    if (i > 0) out += ',';
    out += cells[i];
  }
  return out + '\r\n';
}

/** UTF-8 byte length by code-unit ranges (no surrogates can occur in converter output). */
export function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : 3;
  }
  return n;
}
