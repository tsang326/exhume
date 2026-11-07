/** Reference RFC 4180 writer for tests: quote on comma, quote, CR or LF; double inner quotes. */
export function writeCsvCell(cell: string): string {
  return /[",\r\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell;
}

export function writeCsvRow(cells: readonly string[]): string {
  return cells.map(writeCsvCell).join(',');
}

/** Every row, including the last, ends with CRLF. Zero rows give "". */
export function writeCsv(rows: readonly (readonly string[])[]): string {
  return rows.map((r) => writeCsvRow(r) + '\r\n').join('');
}
