import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { decodeCp437 } from '../fat12';
import { expectedCell, isNumberForm } from '../../test-support/formats/oracles';
import { numRuns } from '../../test-support/runs';
import { formatCell, formatCellBytes } from './dbase-cells';
import type { DbfField } from './dbase-header';
import { TEMPLATES, fill } from './templates';
import { ConversionWarningCode } from './types';
import { makeWarningCollector } from './warnings';

// ---------------------------------------------------------------------------
// Property 19: Character cells follow the text rule (Requirement 7.5)
// ---------------------------------------------------------------------------

/** Bytes heavy in NUL, space, control bytes, DEL and the high CP437 half. */
const byteArb = fc.oneof(
  { weight: 3, arbitrary: fc.constant(0x00) },
  { weight: 3, arbitrary: fc.constant(0x20) },
  { weight: 3, arbitrary: fc.integer({ min: 0x01, max: 0x1f }) },
  { weight: 1, arbitrary: fc.constant(0x7f) },
  { weight: 3, arbitrary: fc.integer({ min: 0x80, max: 0xff }) },
  { weight: 2, arbitrary: fc.integer({ min: 0x21, max: 0x7e }) },
);

const fieldBytesArb = fc
  .array(byteArb, { minLength: 1, maxLength: 255 })
  .map((a) => Uint8Array.from(a));

/** 'C', plus letters that are not a known non-text type (read as 'C'). */
const textTypeArb = fc.constantFrom('C', 'X', 'Z', 'B', 'c', '?', '0');

/** Independent model: trim trailing 0x20/0x00, decode CP437, blank control chars. */
function modelText(bytes: Uint8Array): string {
  let end = bytes.length;
  while (end > 0 && (bytes[end - 1] === 0x20 || bytes[end - 1] === 0x00)) end--;
  return decodeCp437(bytes.slice(0, end))
    .split('')
    .map((ch) => (ch.charCodeAt(0) < 0x20 || ch.charCodeAt(0) === 0x7f ? ' ' : ch))
    .join('');
}

function fieldOf(type: string, length: number): DbfField {
  return {
    name: 'F',
    type: type as DbfField['type'],
    length,
    decimals: 0,
    offset: 1,
    unknownType: type !== 'C',
  };
}

describe('Property 19: character cells follow the text rule', () => {
  it('formatCellBytes matches the oracle and the model, guard true, invalid false', () => {
    fc.assert(
      fc.property(textTypeArb, fieldBytesArb, (type, bytes) => {
        // Unknown letters reach the formatter as 'C' (the header parser maps them).
        const got = formatCellBytes('C', bytes);
        const oracle = expectedCell(type, bytes);
        return (
          got.text === oracle.text &&
          got.text === modelText(bytes) &&
          got.guard === true &&
          got.invalid === false &&
          oracle.invalid === false
        );
      }),
      { numRuns: numRuns(300) },
    );
  });

  it('formatCell gives the same cell, adds no warnings and leaves input untouched', () => {
    fc.assert(
      fc.property(textTypeArb, fieldBytesArb, fc.integer({ min: 1, max: 255 }), (type, bytes, n) => {
        const before = bytes.slice();
        const collector = makeWarningCollector();
        const got = formatCell(fieldOf('C', bytes.length), bytes, n, collector);
        const expected = formatCellBytes('C', bytes);
        let same = bytes.length === before.length;
        for (let i = 0; same && i < bytes.length; i++) same = bytes[i] === before[i];
        return (
          got.text === expected.text &&
          got.text === expectedCell(type, bytes).text &&
          got.guard === true &&
          got.invalid === false &&
          collector.list().length === 0 &&
          same
        );
      }),
      { numRuns: numRuns(300) },
    );
  });

  it('trims trailing spaces and NULs but keeps interior ones, blanking controls', () => {
    const bytes = Uint8Array.of(0x41, 0x00, 0x7f, 0x42, 0x20, 0x00, 0x20);
    const r = formatCellBytes('C', bytes);
    expect(r).toEqual({ text: 'A  B', guard: true, invalid: false });
  });
});

// ---------------------------------------------------------------------------
// Property 20: Numeric cells are validated (Requirements 7.6, 7.7, 7.14)
// ---------------------------------------------------------------------------

const numTypeArb = fc.constantFrom<'N' | 'F'>('N', 'F');

function asciiBytes(s: string): Uint8Array {
  return Uint8Array.from(s.split('').map((c) => c.charCodeAt(0)));
}

const padArb = fc.nat({ max: 6 }).map((n) => ' '.repeat(n));

/** Valid number text: optional '-', 1+ digits, optional '.' and 1+ digits. */
const numberTextArb = fc
  .tuple(
    fc.boolean(),
    fc.stringMatching(/^[0-9]{1,12}$/),
    fc.option(fc.stringMatching(/^[0-9]{1,8}$/), { nil: undefined }),
  )
  .map(([neg, int, frac]) => (neg ? '-' : '') + int + (frac === undefined ? '' : '.' + frac));

const paddedValidArb = fc
  .tuple(padArb, numberTextArb, padArb)
  .map(([l, n, r]) => ({ core: n, bytes: asciiBytes(l + n + r) }));

const NEAR_MISSES = [
  '', '+5', '1.', '.5', '--1', '-', '.', '-.5', '1e5', '1 2', '1..2', '1.2.3', '1-', '5-', '0x1', 'abc', '1,5',
];

const nearMissArb = fc
  .tuple(padArb, fc.constantFrom(...NEAR_MISSES), padArb)
  .map(([l, m, r]) => asciiBytes(l + m + r));

/** A valid number with one byte inserted that makes it invalid (NUL, high byte, junk). */
const mutatedArb = fc
  .tuple(
    numberTextArb,
    fc.nat(),
    fc.constantFrom(0x00, 0x09, 0x2b, 0x2c, 0x45, 0x65, 0x80, 0xb2, 0xff, 0x2d, 0x2e),
  )
  .map(([n, pos, b]) => {
    const bytes = asciiBytes(n);
    const at = pos % (bytes.length + 1);
    return Uint8Array.from([...bytes.subarray(0, at), b, ...bytes.subarray(at)]);
  });

const randomBytesArb = fc
  .array(fc.integer({ min: 0, max: 255 }), { minLength: 1, maxLength: 255 })
  .map((a) => Uint8Array.from(a));

const anyNumericBytesArb = fc.oneof(
  paddedValidArb.map((v) => v.bytes),
  nearMissArb,
  mutatedArb,
  randomBytesArb,
);

function trimmedAscii(bytes: Uint8Array): string {
  let lo = 0;
  let hi = bytes.length;
  while (lo < hi && bytes[lo] === 0x20) lo++;
  while (hi > lo && bytes[hi - 1] === 0x20) hi--;
  let s = '';
  for (let i = lo; i < hi; i++) s += String.fromCharCode(bytes[i] as number);
  return s;
}

describe('Property 20: numeric cells are validated', () => {
  it('valid numbers are written unchanged after trimming spaces, never guarded', () => {
    fc.assert(
      fc.property(numTypeArb, paddedValidArb, (type, v) => {
        const got = formatCellBytes(type, v.bytes);
        const oracle = expectedCell(type, v.bytes);
        return (
          got.text === v.core &&
          got.invalid === false &&
          got.guard === false &&
          oracle.text === v.core &&
          oracle.invalid === false
        );
      }),
      { numRuns: numRuns(300) },
    );
  });

  it('any bytes match the oracle: valid form kept, anything else empty and invalid', () => {
    fc.assert(
      fc.property(numTypeArb, anyNumericBytesArb, (type, bytes) => {
        const before = bytes.slice();
        const got = formatCellBytes(type, bytes);
        const oracle = expectedCell(type, bytes);
        const core = trimmedAscii(bytes);
        const valid = isNumberForm(core);
        let same = true;
        for (let i = 0; i < bytes.length; i++) if (bytes[i] !== before[i]) same = false;
        return (
          same &&
          got.guard === false &&
          got.text === oracle.text &&
          got.invalid === oracle.invalid &&
          got.invalid === !valid &&
          got.text === (valid ? core : '')
        );
      }),
      { numRuns: numRuns(500) },
    );
  });

  it('near-miss and damaged values are empty and invalid', () => {
    fc.assert(
      fc.property(numTypeArb, fc.oneof(nearMissArb, mutatedArb), (type, bytes) => {
        const got = formatCellBytes(type, bytes);
        if (isNumberForm(trimmedAscii(bytes))) return true; // a mutation can stay valid
        return got.text === '' && got.invalid === true && got.guard === false;
      }),
      { numRuns: numRuns(300) },
    );
  });

  it('formatCell warns once per field number however many values are bad', () => {
    fc.assert(
      fc.property(
        numTypeArb,
        fc.integer({ min: 1, max: 255 }),
        fc.array(fc.oneof(nearMissArb, mutatedArb), { minLength: 1, maxLength: 20 }),
        (type, n, values) => {
          const collector = makeWarningCollector();
          const field = fieldOf(type, 10);
          let anyBad = false;
          let cellsOk = true;
          for (const bytes of values) {
            const got = formatCell(field, bytes, n, collector);
            const exp = formatCellBytes(type, bytes);
            if (exp.invalid) anyBad = true;
            if (got.text !== exp.text || got.invalid !== exp.invalid || got.guard !== false) {
              cellsOk = false;
            }
          }
          const list = collector.list();
          const expectedCount = anyBad ? 1 : 0;
          const first = list[0];
          return (
            cellsOk &&
            list.length === expectedCount &&
            (!anyBad ||
              (first !== undefined &&
                first.code === ConversionWarningCode.FieldValueInvalid &&
                first.message === fill(TEMPLATES.fieldValueInvalid, n)))
          );
        },
      ),
      { numRuns: numRuns(200) },
    );
  });

  it('valid values add no warnings', () => {
    fc.assert(
      fc.property(numTypeArb, fc.integer({ min: 1, max: 255 }), paddedValidArb, (type, n, v) => {
        const collector = makeWarningCollector();
        formatCell(fieldOf(type, v.bytes.length), v.bytes, n, collector);
        return collector.list().length === 0;
      }),
      { numRuns: numRuns(200) },
    );
  });

  it('several different fields give one warning each', () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(fc.integer({ min: 1, max: 255 }), { minLength: 1, maxLength: 10 }),
        fc.integer({ min: 1, max: 4 }),
        (fieldNumbers, repeats) => {
          const collector = makeWarningCollector();
          for (let r = 0; r < repeats; r++) {
            for (const n of fieldNumbers) {
              formatCell(fieldOf('N', 5), asciiBytes('1e5  '), n, collector);
            }
          }
          const messages = collector.list().map((w) => w.message);
          const expected = fieldNumbers.map((n) => fill(TEMPLATES.fieldValueInvalid, n));
          return (
            messages.length === fieldNumbers.length &&
            expected.every((m) => messages.includes(m)) &&
            collector.list().every((w) => w.code === ConversionWarningCode.FieldValueInvalid)
          );
        },
      ),
      { numRuns: numRuns(100) },
    );
  });

  it('5000 bad values on one field produce a single warning', () => {
    const collector = makeWarningCollector();
    const field = fieldOf('N', 4);
    for (let i = 0; i < 5000; i++) formatCell(field, asciiBytes('+5  '), 3, collector);
    const list = collector.list();
    expect(list).toHaveLength(1);
    expect(list[0]?.message).toBe(fill(TEMPLATES.fieldValueInvalid, 3));
  });

  it('keeps unnormalised examples and rejects the listed bad forms', () => {
    for (const [s, text] of [['-0', '-0'], ['007', '007'], ['1.50', '1.50'], ['  -3.25  ', '-3.25']] as const) {
      expect(formatCellBytes('N', asciiBytes(s))).toEqual({ text, guard: false, invalid: false });
      expect(formatCellBytes('F', asciiBytes(s))).toEqual({ text, guard: false, invalid: false });
    }
    for (const s of ['', '   ', '+5', '1.', '.5', '--1', '1e5', '1 2']) {
      expect(formatCellBytes('N', asciiBytes(s.length ? s : ' '))).toEqual({ text: '', guard: false, invalid: true });
    }
    expect(formatCellBytes('N', Uint8Array.of(0x31, 0x00)).invalid).toBe(true);
    expect(formatCellBytes('F', Uint8Array.of(0x31, 0xb2)).invalid).toBe(true);
  });
});
