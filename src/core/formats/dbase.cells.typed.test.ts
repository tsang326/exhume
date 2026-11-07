import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { expectedCell, isRealDate } from '../../test-support/formats/oracles';
import { numRuns } from '../../test-support/runs';
import { formatCell, formatCellBytes } from './dbase-cells';
import type { DbfField } from './dbase-header';
import { TEMPLATES, fill } from './templates';
import { ConversionWarningCode } from './types';
import { makeWarningCollector } from './warnings';

function fieldOf(type: string, length: number): DbfField {
  return {
    name: 'F',
    type: type as DbfField['type'],
    length,
    decimals: 0,
    offset: 1,
    unknownType: false,
  };
}

function ascii(s: string): Uint8Array {
  return Uint8Array.from(s, (ch) => ch.charCodeAt(0));
}

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

// ---------------------------------------------------------------------------
// Property 21: Date cells are validated (Requirements 7.8, 7.9, 7.10)
// ---------------------------------------------------------------------------

const digitArb = fc.integer({ min: 0, max: 9 }).map((n) => String(n));
const validDateArb = fc
  .record({
    y: fc.integer({ min: 1, max: 9999 }),
    m: fc.integer({ min: 1, max: 12 }),
    d: fc.integer({ min: 1, max: 31 }),
  })
  .filter(({ y, m, d }) => isRealDate(y, m, d))
  .map(({ y, m, d }) => ascii(pad(y, 4) + pad(m, 2) + pad(d, 2)));
/** Any 8-digit string, so month/day edges (00, 13, 32, 31 in 30-day months) occur. */
const edgeDateArb = fc
  .record({
    y: fc.oneof(fc.integer({ min: 0, max: 9999 }), fc.constantFrom(0, 1, 1900, 2000, 9999)),
    m: fc.oneof(fc.integer({ min: 0, max: 99 }), fc.constantFrom(0, 1, 2, 4, 12, 13)),
    d: fc.oneof(fc.integer({ min: 0, max: 99 }), fc.constantFrom(0, 1, 28, 29, 30, 31, 32)),
  })
  .map(({ y, m, d }) => ascii(pad(y, 4) + pad(m, 2) + pad(d, 2)));
const knownDatesArb = fc.constantFrom(
  '20000229',
  '19000229',
  '00010101',
  '99991231',
  '00000101',
  '20240431',
  '20240001',
  '20241301',
  '20240132',
).map(ascii);
const spacesArb = fc.integer({ min: 1, max: 16 }).map((n) => new Uint8Array(n).fill(0x20));
const mixArb = fc
  .array(fc.oneof(fc.constant(' '), digitArb), { minLength: 1, maxLength: 16 })
  .map((a) => ascii(a.join('')));
const wrongLengthArb = fc
  .tuple(fc.constantFrom(7, 9), validDateArb)
  .map(([n, v]) => {
    const s = String.fromCharCode(...v);
    return ascii(n === 7 ? s.slice(0, 7) : s + '0');
  });
const randomBytesArb = fc
  .array(fc.integer({ min: 0, max: 255 }), { minLength: 1, maxLength: 16 })
  .map((a) => Uint8Array.from(a));
const eightRandomArb = fc
  .array(fc.integer({ min: 0, max: 255 }), { minLength: 8, maxLength: 8 })
  .map((a) => Uint8Array.from(a));
const dateBytesArb = fc.oneof(
  validDateArb,
  edgeDateArb,
  knownDatesArb,
  spacesArb,
  mixArb,
  wrongLengthArb,
  randomBytesArb,
  eightRandomArb,
);

function allSpaces(b: Uint8Array): boolean {
  return b.every((x) => x === 0x20);
}

describe('Property 21: date cells are validated', () => {
  it('formatCellBytes matches the oracle for every kind of date field', () => {
    fc.assert(
      fc.property(dateBytesArb, (bytes) => {
        const got = formatCellBytes('D', bytes);
        const want = expectedCell('D', bytes);
        return got.text === want.text && got.invalid === want.invalid && got.guard === false;
      }),
      { numRuns: numRuns(500) },
    );
  });

  it('valid dates give YYYY-MM-DD, blanks give empty, everything else is empty and invalid', () => {
    fc.assert(
      fc.property(dateBytesArb, (bytes) => {
        const got = formatCellBytes('D', bytes);
        const s = String.fromCharCode(...bytes);
        if (allSpaces(bytes)) return got.text === '' && !got.invalid;
        if (
          bytes.length === 8 &&
          /^[0-9]{8}$/.test(s) &&
          isRealDate(Number(s.slice(0, 4)), Number(s.slice(4, 6)), Number(s.slice(6, 8)))
        ) {
          return got.text === `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` && !got.invalid;
        }
        return got.text === '' && got.invalid;
      }),
      { numRuns: numRuns(500) },
    );
  });

  it('formatCell warns exactly once per field number, never for valid or blank', () => {
    fc.assert(
      fc.property(
        dateBytesArb,
        fc.integer({ min: 1, max: 255 }),
        fc.integer({ min: 1, max: 20 }),
        (bytes, fieldNumber, times) => {
          const collector = makeWarningCollector();
          const field = fieldOf('D', bytes.length);
          let anyInvalid = false;
          for (let i = 0; i < times; i++) {
            const r = formatCell(field, bytes, fieldNumber, collector);
            const want = expectedCell('D', bytes);
            if (r.text !== want.text || r.invalid !== want.invalid || r.guard) return false;
            anyInvalid = r.invalid;
          }
          const warnings = collector.list();
          if (!anyInvalid) return warnings.length === 0;
          return (
            warnings.length === 1 &&
            warnings[0]?.code === ConversionWarningCode.FieldValueInvalid &&
            warnings[0]?.message === fill(TEMPLATES.fieldValueInvalid, fieldNumber)
          );
        },
      ),
      { numRuns: numRuns(300) },
    );
  });

  it('distinct field numbers each get their own warning', () => {
    const collector = makeWarningCollector();
    const bad = ascii('20240230');
    for (const n of [3, 1, 3, 2, 1, 2]) formatCell(fieldOf('D', 8), bad, n, collector);
    const messages = collector.list().map((w) => w.message);
    expect(messages).toEqual([
      fill(TEMPLATES.fieldValueInvalid, 3),
      fill(TEMPLATES.fieldValueInvalid, 1),
      fill(TEMPLATES.fieldValueInvalid, 2),
    ]);
  });

  it('known edge dates behave as specified', () => {
    expect(formatCellBytes('D', ascii('20000229'))).toEqual({
      text: '2000-02-29',
      guard: false,
      invalid: false,
    });
    expect(formatCellBytes('D', ascii('19000229')).invalid).toBe(true);
    expect(formatCellBytes('D', ascii('00010101')).text).toBe('0001-01-01');
    expect(formatCellBytes('D', ascii('99991231')).text).toBe('9999-12-31');
    expect(formatCellBytes('D', ascii('00000101')).invalid).toBe(true);
    expect(formatCellBytes('D', ascii('2024043 ')).invalid).toBe(true);
    expect(formatCellBytes('D', ascii('        ')).invalid).toBe(false);
    expect(formatCellBytes('D', ascii('1234567')).invalid).toBe(true);
    expect(formatCellBytes('D', ascii('123456789')).invalid).toBe(true);
  });

  it('agrees with the oracle for February 29 in every year 1..9999', () => {
    let mismatches = 0;
    for (let y = 1; y <= 9999; y++) {
      const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
      const got = formatCellBytes('D', ascii(`${pad(y, 4)}0229`));
      const want = expectedCell('D', ascii(`${pad(y, 4)}0229`));
      if (got.invalid === leap || got.text !== want.text || got.invalid !== want.invalid) {
        mismatches++;
      }
    }
    expect(mismatches).toBe(0);
  });

  it('agrees with the oracle on every month length in sampled years', () => {
    const lengths = [31, 0, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mismatches = 0;
    for (const y of [1, 4, 100, 1900, 1999, 2000, 2023, 2024, 9999]) {
      const feb = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
      for (let m = 1; m <= 12; m++) {
        const len = m === 2 ? feb : (lengths[m - 1] as number);
        for (let d = 1; d <= 32; d++) {
          const bytes = ascii(pad(y, 4) + pad(m, 2) + pad(d, 2));
          const got = formatCellBytes('D', bytes);
          const want = expectedCell('D', bytes);
          if (got.invalid !== d > len || got.text !== want.text) mismatches++;
        }
      }
    }
    expect(mismatches).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Property 22: Logical cells map as specified (Requirements 7.11, 7.12)
// ---------------------------------------------------------------------------

function specLogical(b: number): { text: string; invalid: boolean } {
  if ([0x54, 0x74, 0x59, 0x79].includes(b)) return { text: 'TRUE', invalid: false };
  if ([0x46, 0x66, 0x4e, 0x6e].includes(b)) return { text: 'FALSE', invalid: false };
  if (b === 0x3f || b === 0x20) return { text: '', invalid: false };
  return { text: '', invalid: true };
}

const longerLogicalArb = fc
  .tuple(
    fc.integer({ min: 0, max: 255 }),
    fc.array(fc.integer({ min: 0, max: 255 }), { minLength: 0, maxLength: 15 }),
  )
  .map(([first, rest]) => Uint8Array.from([first, ...rest]));

describe('Property 22: logical cells map as specified', () => {
  it('every first byte 0..255 in a 1-byte field matches the spec and the oracle', () => {
    let mismatches = 0;
    for (let b = 0; b < 256; b++) {
      const bytes = Uint8Array.of(b);
      const got = formatCellBytes('L', bytes);
      const want = expectedCell('L', bytes);
      const spec = specLogical(b);
      if (
        got.text !== want.text ||
        got.invalid !== want.invalid ||
        got.text !== spec.text ||
        got.invalid !== spec.invalid ||
        got.guard !== false
      ) {
        mismatches++;
      }
      const collector = makeWarningCollector();
      const r = formatCell(fieldOf('L', 1), bytes, 4, collector);
      const warnings = collector.list();
      const warnOk = spec.invalid
        ? warnings.length === 1 &&
          warnings[0]?.code === ConversionWarningCode.FieldValueInvalid &&
          warnings[0]?.message === fill(TEMPLATES.fieldValueInvalid, 4)
        : warnings.length === 0;
      if (r.text !== spec.text || r.invalid !== spec.invalid || r.guard || !warnOk) mismatches++;
    }
    expect(mismatches).toBe(0);
  });

  it('named letters map to TRUE, FALSE, or empty', () => {
    for (const ch of 'TtYy') expect(formatCellBytes('L', ascii(ch)).text).toBe('TRUE');
    for (const ch of 'FfNn') expect(formatCellBytes('L', ascii(ch)).text).toBe('FALSE');
    for (const ch of '? ') {
      expect(formatCellBytes('L', ascii(ch))).toEqual({ text: '', guard: false, invalid: false });
    }
    expect(formatCellBytes('L', ascii('X'))).toEqual({ text: '', guard: false, invalid: true });
  });

  it('an empty byte array is invalid and empty without throwing', () => {
    const got = formatCellBytes('L', new Uint8Array(0));
    expect(got).toEqual({ text: '', guard: false, invalid: true });
    expect(expectedCell('L', new Uint8Array(0)).invalid).toBe(true);
  });

  it('for longer fields the first byte decides', () => {
    fc.assert(
      fc.property(longerLogicalArb, (bytes) => {
        const got = formatCellBytes('L', bytes);
        const want = expectedCell('L', bytes);
        const spec = specLogical(bytes[0] as number);
        return (
          got.text === want.text &&
          got.invalid === want.invalid &&
          got.text === spec.text &&
          got.invalid === spec.invalid &&
          got.guard === false
        );
      }),
      { numRuns: numRuns(500) },
    );
  });

  it('formatCell warns once per field number for invalid logical values', () => {
    fc.assert(
      fc.property(
        longerLogicalArb,
        fc.integer({ min: 1, max: 255 }),
        fc.integer({ min: 1, max: 10 }),
        (bytes, fieldNumber, times) => {
          const collector = makeWarningCollector();
          const field = fieldOf('L', bytes.length);
          for (let i = 0; i < times; i++) formatCell(field, bytes, fieldNumber, collector);
          const warnings = collector.list();
          if (!specLogical(bytes[0] as number).invalid) return warnings.length === 0;
          return (
            warnings.length === 1 &&
            warnings[0]?.code === ConversionWarningCode.FieldValueInvalid &&
            warnings[0]?.message === fill(TEMPLATES.fieldValueInvalid, fieldNumber)
          );
        },
      ),
      { numRuns: numRuns(300) },
    );
  });

  it('memo fields are empty, valid, unguarded for any bytes', () => {
    fc.assert(
      fc.property(longerLogicalArb, (bytes) => {
        const got = formatCellBytes('M', bytes);
        return got.text === '' && !got.invalid && got.guard === false;
      }),
      { numRuns: numRuns(200) },
    );
  });

  it('memo-not-available is added exactly once per collector', () => {
    fc.assert(
      fc.property(
        fc.array(longerLogicalArb, { minLength: 1, maxLength: 8 }),
        (values) => {
          const collector = makeWarningCollector();
          values.forEach((v, i) => formatCell(fieldOf('M', v.length), v, i + 1, collector));
          const warnings = collector.list();
          return (
            warnings.length === 1 &&
            warnings[0]?.code === ConversionWarningCode.MemoNotAvailable &&
            warnings[0]?.message === TEMPLATES.memoNotAvailable
          );
        },
      ),
      { numRuns: numRuns(200) },
    );
  });
});
