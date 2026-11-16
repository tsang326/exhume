// Lotus 1-2-3 worksheet (.WKS release 1A, .WK1 release 2) to CSV.
// One pass over the record stream; cells land in a grid bounded by MAX_SHEET_ROWS and
// MAX_SHEET_COLS. Formulas are not evaluated: the value 1-2-3 saved with them is written.
// No regular expressions, no recursion.

import { decodeCp437 } from '../fat12';
import { csvCell, csvRow, utf8Length } from './csv';
import { assertUint8Array, guarded, limitInput } from './guard';
import { MAX_CSV_OUTPUT_BYTES, MAX_SHEET_COLS, MAX_SHEET_ROWS } from './limits';
import { failResult, okResult } from './result';
import { TEMPLATES, fill, limitExceededMessage } from './templates';
import { ConversionWarningCode } from './types';
import type { CsvResult } from './types';
import { makeWarningCollector } from './warnings';
import type { WarningCollector } from './warnings';

const RECORD_HEADER_BYTES = 4;
const OP_BOF = 0x00;
const OP_EOF = 0x01;
const OP_INTEGER = 0x0d;
const OP_NUMBER = 0x0e;
const OP_LABEL = 0x0f;
const OP_FORMULA = 0x10;
const OP_STRING = 0x33;
const BOF_LENGTH = 2;
const VERSION_WKS = 0x0404;
const VERSION_WK1 = 0x0406;
const CELL_HEAD_BYTES = 5; // format byte, column u16, row u16
const NUMBER_BYTES = 8;
const INTEGER_BYTES = 2;

// Format byte: bits 4-6 type, bits 0-3 decimals or special sub-type.
const TYPE_FIXED = 0;
const TYPE_CURRENCY = 2;
const TYPE_COMMA = 4;
const TYPE_SPECIAL = 7;
const SPECIAL_DATES = [2, 3, 4, 9, 10];
const SPECIAL_TIMES = [7, 8];
const MAX_DECIMALS = 15;
const GENERAL_DIGITS = 15;

// Serial day 1 is 1900-01-01. 1-2-3 counts 1900-02-29 (serial 60), which did not exist.
const FAKE_LEAP_DAY = 60;
const MAX_DATE_SERIAL = 73050; // 2099-12-31, the last date 1-2-3 accepts
const MS_PER_DAY = 86_400_000;
const SECONDS_PER_DAY = 86_400;
const EPOCH_MS = Date.UTC(1899, 11, 31);

const LABEL_PREFIXES = [0x27, 0x22, 0x5e, 0x5c, 0x7c]; // ' " ^ \ |

/** Public converter: cap is MAX_CSV_OUTPUT_BYTES. */
export function convertLotus(input: Uint8Array): CsvResult {
  return runLotus(input, MAX_CSV_OUTPUT_BYTES);
}

interface Cell {
  text: string;
  guard: boolean;
}

const u16 = (d: Uint8Array, at: number): number => (d[at] as number) | ((d[at + 1] as number) << 8);

/** Test seam with a configurable output cap. Rows stop after the last complete row that fits. */
export function runLotus(input: Uint8Array, outputCap: number): CsvResult {
  assertUint8Array(input);
  const w = makeWarningCollector();
  return guarded((): CsvResult => {
    const data = limitInput(input, w);
    if (data.length < RECORD_HEADER_BYTES + BOF_LENGTH || u16(data, 0) !== OP_BOF || u16(data, 2) !== BOF_LENGTH) {
      return failResult(TEMPLATES.errLotusInvalid, w);
    }
    const version = u16(data, RECORD_HEADER_BYTES);
    if (version !== VERSION_WKS && version !== VERSION_WK1) {
      return failResult(fill(TEMPLATES.errLotusVersion, version), w);
    }

    const grid = new Map<number, Cell>();
    let maxRow = -1;
    let maxCol = -1;
    let at = 0;
    let ended = false;
    while (at + RECORD_HEADER_BYTES <= data.length) {
      const op = u16(data, at);
      const length = u16(data, at + 2);
      const body = at + RECORD_HEADER_BYTES;
      if (body + length > data.length) break;
      at = body + length;
      if (op === OP_EOF) {
        ended = true;
        break;
      }
      const rec = data.subarray(body, body + length);
      const cell = readCell(op, rec);
      if (cell === null) continue;
      const col = u16(rec, 1);
      const row = u16(rec, 3);
      if (row >= MAX_SHEET_ROWS || col >= MAX_SHEET_COLS) {
        w.addOnce(ConversionWarningCode.LimitExceeded, limitExceededMessage(row >= MAX_SHEET_ROWS ? 'MAX_SHEET_ROWS' : 'MAX_SHEET_COLS'));
        continue;
      }
      grid.set(row * MAX_SHEET_COLS + col, cell);
      if (row > maxRow) maxRow = row;
      if (col > maxCol) maxCol = col;
    }
    if (!ended) w.add(ConversionWarningCode.SheetTruncated, TEMPLATES.sheetTruncated);

    return writeCsv(grid, maxRow, maxCol, outputCap, w);
  }, w);
}

/** The cell a record holds, or null for a record that holds no cell value. */
function readCell(op: number, rec: Uint8Array): Cell | null {
  if (op !== OP_INTEGER && op !== OP_NUMBER && op !== OP_LABEL && op !== OP_FORMULA && op !== OP_STRING) return null;
  if (rec.length < CELL_HEAD_BYTES) return null;
  const format = rec[0] as number;
  const value = rec.subarray(CELL_HEAD_BYTES);
  if (op === OP_LABEL || op === OP_STRING) {
    return { text: labelText(value, op === OP_LABEL), guard: true };
  }
  if (op === OP_INTEGER) {
    if (value.length < INTEGER_BYTES) return null;
    const n = u16(value, 0);
    return { text: formatNumber(n >= 0x8000 ? n - 0x10000 : n, format), guard: false };
  }
  if (value.length < NUMBER_BYTES) return null;
  const n = new DataView(value.buffer, value.byteOffset, NUMBER_BYTES).getFloat64(0, true);
  return { text: formatNumber(n, format), guard: false };
}

/** Label bytes up to the first NUL, without the alignment prefix, control bytes as '_'. */
function labelText(bytes: Uint8Array, prefixed: boolean): string {
  let end = 0;
  while (end < bytes.length && bytes[end] !== 0) end++;
  let start = 0;
  if (prefixed && end > 0 && LABEL_PREFIXES.includes(bytes[0] as number)) start = 1;
  const out = new Uint8Array(end - start);
  for (let i = start; i < end; i++) {
    const b = bytes[i] as number;
    out[i - start] = b < 0x20 || b === 0x7f ? 0x5f : b;
  }
  return decodeCp437(out);
}

/** A number as the cell's display format would show it, without thousands separators or symbols. */
export function formatNumber(n: number, format: number): string {
  if (!Number.isFinite(n)) return '';
  const type = (format >> 4) & 0x07;
  const sub = format & 0x0f;
  if (type === TYPE_FIXED || type === TYPE_CURRENCY || type === TYPE_COMMA) {
    return n.toFixed(Math.min(sub, MAX_DECIMALS));
  }
  if (type === TYPE_SPECIAL && SPECIAL_DATES.includes(sub)) {
    const date = serialDate(n);
    if (date !== null) return date;
  }
  if (type === TYPE_SPECIAL && SPECIAL_TIMES.includes(sub) && n >= 0) {
    return clockTime(n);
  }
  return String(Number(n.toPrecision(GENERAL_DIGITS)));
}

/** ISO date for a 1-2-3 serial day, or null outside 1900-01-01 .. 2099-12-31 and for the fake leap day. */
export function serialDate(n: number): string | null {
  const day = Math.floor(n);
  if (day < 1 || day > MAX_DATE_SERIAL || day === FAKE_LEAP_DAY) return null;
  const real = day > FAKE_LEAP_DAY ? day - 1 : day;
  return new Date(EPOCH_MS + real * MS_PER_DAY).toISOString().slice(0, 10);
}

function clockTime(n: number): string {
  const total = Math.round((n - Math.floor(n)) * SECONDS_PER_DAY) % SECONDS_PER_DAY;
  const two = (v: number): string => (v < 10 ? '0' : '') + String(v);
  return `${two(Math.floor(total / 3600))}:${two(Math.floor(total / 60) % 60)}:${two(total % 60)}`;
}

function writeCsv(grid: Map<number, Cell>, maxRow: number, maxCol: number, cap: number, w: WarningCollector): CsvResult {
  const rows: string[] = [];
  let total = 0;
  let capped = false;
  for (let r = 0; r <= maxRow; r++) {
    const cells: string[] = [];
    for (let c = 0; c <= maxCol; c++) {
      const cell = grid.get(r * MAX_SHEET_COLS + c);
      cells.push(cell === undefined ? '' : csvCell(cell.text, { guard: cell.guard }));
    }
    const row = csvRow(cells);
    const size = utf8Length(row);
    if (total + size > cap) {
      capped = true;
      break;
    }
    rows.push(row);
    total += size;
  }
  if (capped) w.add(ConversionWarningCode.OutputCapped, fill(TEMPLATES.outputCappedCsv, cap));
  return okResult(rows.join(''), 'text/csv', '.csv', w);
}
