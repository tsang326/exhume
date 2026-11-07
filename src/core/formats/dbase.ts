// dBase III to CSV. Bounded by MAX_DBF_RECORDS and MAX_DBF_FIELDS; no regular expressions.
import { csvCell, csvRow, utf8Length } from './csv';
import { formatCell } from './dbase-cells';
import { parseDbfHeader } from './dbase-header';
import { assertUint8Array, guarded, limitInput } from './guard';
import { MAX_CSV_OUTPUT_BYTES, MAX_DBF_RECORDS } from './limits';
import { failResult, okResult } from './result';
import { TEMPLATES, fill } from './templates';
import { ConversionWarningCode } from './types';
import type { CsvResult } from './types';
import { makeWarningCollector } from './warnings';

const FLAG_ACTIVE = 0x20;
const FLAG_DELETED = 0x2a;

/** Public converter: cap is MAX_CSV_OUTPUT_BYTES. */
export function convertDBase(input: Uint8Array): CsvResult {
  return runDBase(input, MAX_CSV_OUTPUT_BYTES);
}

/**
 * Test seam with a configurable output cap. Tiny-cap rule: the header row is written
 * only if it fits within outputCap; otherwise the output is empty with an output-capped
 * warning. Data rows stop after the last complete row that fits.
 */
export function runDBase(input: Uint8Array, outputCap: number): CsvResult {
  assertUint8Array(input);
  const w = makeWarningCollector();
  const result = guarded((): CsvResult => {
    const data = limitInput(input, w);
    const parsed = parseDbfHeader(data, w);
    if (!parsed.ok) return failResult(parsed.error, w);
    const h = parsed.header;
    const fields = h.fields;

    const headerCells: string[] = [];
    for (let k = 0; k < fields.length; k++) {
      headerCells.push(csvCell((fields[k] as { name: string }).name, { guard: true }));
    }
    const rows: string[] = [];
    let total = 0;
    let capped = false;
    const headerRow = csvRow(headerCells);
    const headerBytes = utf8Length(headerRow);
    if (headerBytes > outputCap) {
      capped = true;
    } else {
      rows.push(headerRow);
      total = headerBytes;
    }

    const physical = Math.floor((data.length - h.headerLength) / h.recordLength);
    const count = Math.min(h.recordCount, MAX_DBF_RECORDS, physical);
    if (h.recordCount > count) {
      w.add(ConversionWarningCode.RecordsTruncated, fill(TEMPLATES.recordsTruncated, h.recordCount, count));
    }
    if (h.recordCount > MAX_DBF_RECORDS) {
      w.add(ConversionWarningCode.RecordLimit, TEMPLATES.recordLimit);
    }
    if (h.recordLength > 1 + h.fieldLengthSum) {
      w.add(
        ConversionWarningCode.RecordLengthMismatch,
        fill(TEMPLATES.recordLengthMismatch, h.recordLength, 1 + h.fieldLengthSum),
      );
    }

    let deleted = 0;
    for (let r = 0; r < count && !capped; r++) {
      const start = h.headerLength + r * h.recordLength;
      const flag = data[start] as number;
      if (flag === FLAG_DELETED) {
        deleted++;
        continue;
      }
      if (flag !== FLAG_ACTIVE) {
        w.addOnce(ConversionWarningCode.RecordFlagUnknown, TEMPLATES.recordFlagUnknown);
      }
      const cells: string[] = [];
      for (let k = 0; k < fields.length; k++) {
        const f = fields[k] as (typeof fields)[number];
        const bytes = data.subarray(start + f.offset, start + f.offset + f.length);
        const c = formatCell(f, bytes, k + 1, w);
        cells.push(c.guard ? csvCell(c.text, { guard: true }) : csvCell(c.text));
      }
      const row = csvRow(cells);
      const size = utf8Length(row);
      if (total + size > outputCap) {
        capped = true;
        break;
      }
      rows.push(row);
      total += size;
    }
    if (deleted > 0) {
      w.add(ConversionWarningCode.DeletedRecordsSkipped, fill(TEMPLATES.deletedRecordsSkipped, deleted));
    }
    if (capped) {
      w.add(ConversionWarningCode.OutputCapped, fill(TEMPLATES.outputCappedCsv, outputCap));
    }
    return okResult(rows.join(''), 'text/csv', '.csv', w);
  }, w);
  return result;
}
