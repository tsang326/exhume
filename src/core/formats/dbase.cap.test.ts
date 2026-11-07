import { describe, it } from 'vitest';
import * as fc from 'fast-check';
import { numRuns } from '../../test-support/runs';
import { writeDbf } from '../../test-support/formats';
import { dbfCleanTableArb, dbfTableArb } from '../../test-support/formats/arbitraries';
import { parseCsv } from '../../test-support/formats/csv-parser';
import { checkResultInvariants, utf8ByteLength } from '../../test-support/formats/invariants';
import { runDBase } from './dbase';
import { fill, TEMPLATES } from './templates';
import { ConversionWarningCode } from './types';

// Feature: format-resurrection, Property 23: CSV output cap
// **Validates: Requirements 7.15**

const HUGE = 100_000_000;

/** Splits CSV text into rows at CRLF outside quotes; null if the text is not CRLF-terminated. */
function splitRows(text: string): string[] | null {
  const rows: string[] = [];
  let inQuotes = false;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && ch === '\r' && text[i + 1] === '\n') {
      rows.push(text.slice(start, i + 2));
      i++;
      start = i + 1;
    }
  }
  return start === text.length && !inQuotes ? rows : null;
}

function check(table: Parameters<typeof writeDbf>[0], cap: number): boolean {
  const input = writeDbf(table);
  const full = runDBase(input, HUGE);
  const capped = runDBase(input, cap);
  if (!full.ok || !capped.ok) return false;
  if (checkResultInvariants(capped).length !== 0) return false;

  const out = capped.output;
  if (utf8ByteLength(out) > cap) return false;

  const fullRows = splitRows(full.output);
  if (fullRows === null) return false;

  // Largest k whose cumulative byte length fits the cap.
  let k = 0;
  let sum = 0;
  while (k < fullRows.length && sum + utf8ByteLength(fullRows[k] as string) <= cap) {
    sum += utf8ByteLength(fullRows[k] as string);
    k++;
  }
  // Tiny-cap rule: if the header does not fit, k is 0 and the output is empty.
  if (out !== fullRows.slice(0, k).join('')) return false;

  if (out !== '') {
    const rows = splitRows(out);
    if (rows === null || rows.length !== k) return false;
    try {
      if (parseCsv(out).length !== k) return false;
    } catch {
      return false;
    }
  }

  const capWarnings = capped.warnings.filter((w) => w.code === ConversionWarningCode.OutputCapped);
  const overflow = utf8ByteLength(full.output) > cap;
  if (overflow) {
    if (capWarnings.length !== 1) return false;
    if (capWarnings[0]?.message !== fill(TEMPLATES.outputCappedCsv, cap)) return false;
  } else if (capWarnings.length !== 0) {
    return false;
  }
  return true;
}

describe('dbase CSV output cap', () => {
  it('Property 23: output stops after the last complete row that fits', () => {
    fc.assert(
      fc.property(dbfCleanTableArb, fc.integer({ min: 0, max: 500 }), (t, cap) => check(t, cap)),
      { numRuns: numRuns(200) },
    );
  });

  it('Property 23: holds for tables needing repair', () => {
    fc.assert(
      fc.property(dbfTableArb, fc.integer({ min: 0, max: 500 }), (t, cap) => check(t, cap)),
      { numRuns: numRuns(200) },
    );
  });
});
