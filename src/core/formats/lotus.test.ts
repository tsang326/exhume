import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkResultInvariants } from '../../test-support/formats/invariants';
import { numRuns } from '../../test-support/runs';
import { timed } from '../../test-support/timed';
import { convertAuto, convertLotus, detectFormat } from './index';
import { CONVERT_TIME_BUDGET_MS, MAX_SHEET_COLS, MAX_SHEET_ROWS } from './limits';
import { formatNumber, runLotus, serialDate } from './lotus';
import { TEMPLATES, fill } from './templates';
import { ConversionWarningCode } from './types';

// Record builders, written from the published 1-2-3 file format notes, independent of lotus.ts.
const rec = (op: number, body: number[]): number[] => [op & 255, op >> 8, body.length & 255, body.length >> 8, ...body];
const head = (fmt: number, col: number, row: number): number[] => [fmt, col & 255, col >> 8, row & 255, row >> 8];
const f64 = (v: number): number[] => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, v, true);
  return [...b];
};
const bof = (version = 0x0406): number[] => rec(0x00, [version & 255, version >> 8]);
const eof = (): number[] => rec(0x01, []);
const label = (col: number, row: number, text: string, prefix = "'"): number[] =>
  rec(0x0f, [...head(0xff, col, row), ...[...(prefix + text)].map((c) => c.charCodeAt(0)), 0]);
const int = (col: number, row: number, v: number, fmt = 0xff): number[] => rec(0x0d, [...head(fmt, col, row), v & 255, (v >> 8) & 255]);
const num = (col: number, row: number, v: number, fmt: number): number[] => rec(0x0e, [...head(fmt, col, row), ...f64(v)]);
const formula = (col: number, row: number, v: number, fmt: number): number[] =>
  rec(0x10, [...head(fmt, col, row), ...f64(v), 3, 0, 0x01, 0x00, 0x03]);
const str = (col: number, row: number, text: string): number[] =>
  rec(0x33, [...head(0xff, col, row), ...[...text].map((c) => c.charCodeAt(0)), 0]);
const sheet = (...records: number[][]): Uint8Array => Uint8Array.from(records.flat());

describe('Lotus 1-2-3 worksheets', () => {
  it('is detected by content and by the WK1 and WKS extensions', () => {
    expect(detectFormat(sheet(bof(), eof()))).toEqual({ format: 'lotus', source: 'content' });
    expect(detectFormat(sheet(bof(0x0404), eof()))).toEqual({ format: 'lotus', source: 'content' });
    expect(detectFormat(Uint8Array.of(1, 2, 3), 'SALES.WK1')).toEqual({ format: 'lotus', source: 'extension' });
    expect(detectFormat(Uint8Array.of(1, 2, 3), 'sales.wks')).toEqual({ format: 'lotus', source: 'extension' });
    expect(detectFormat(sheet(bof(0x0405), eof())).format).not.toBe('lotus');
  });

  it('writes a grid of labels, numbers, dates and saved formula values', () => {
    const bytes = sheet(
      bof(),
      rec(0x06, Array(8).fill(0)), // RANGE: no cell value
      label(0, 0, 'Customer Invoices'),
      label(0, 2, 'Invoice'),
      label(1, 2, 'Customer'),
      label(2, 2, 'InvAmt', '"'),
      label(3, 2, 'InvDate'),
      int(0, 3, 10001),
      label(1, 3, 'Smith Electric'),
      num(2, 3, 392.39092683419585, 0xa2), // currency, 2 decimals
      formula(3, 3, 32787, 0xf2), // special D1 date
      int(0, 4, -7),
      label(1, 4, 'Toy, World'),
      formula(2, 4, 0, 0xff),
      str(2, 4, 'N/A'),
      eof(),
    );
    const r = convertLotus(bytes);
    expect(r).toEqual({
      ok: true,
      mime: 'text/csv',
      extension: '.csv',
      warnings: [],
      output:
        'Customer Invoices,,,\r\n' +
        ',,,\r\n' +
        'Invoice,Customer,InvAmt,InvDate\r\n' +
        '10001,Smith Electric,392.39,1989-10-06\r\n' +
        '-7,"Toy, World",N/A,\r\n',
    });
    expect(convertAuto(bytes, 'INVOICES.WK1')).toEqual(r);
  });

  it('guards labels that a spreadsheet would run as a formula, but not negative numbers', () => {
    const r = convertLotus(sheet(bof(), label(0, 0, '=HYPERLINK(1)'), num(1, 0, -2.5, 0x02), eof()));
    expect(r.ok && r.output).toBe("'=HYPERLINK(1),-2.50\r\n");
  });

  it('formats dates, times and general numbers the way 1-2-3 counts them', () => {
    expect(serialDate(1)).toBe('1900-01-01');
    expect(serialDate(59)).toBe('1900-02-28');
    expect(serialDate(60)).toBeNull(); // 1-2-3's 1900-02-29
    expect(serialDate(61)).toBe('1900-03-01');
    expect(serialDate(36526)).toBe('2000-01-01');
    expect(serialDate(73050)).toBe('2099-12-31');
    expect(serialDate(73051)).toBeNull();
    expect(serialDate(0)).toBeNull();
    expect(formatNumber(32787.75, 0xf7)).toBe('18:00:00'); // special time
    expect(formatNumber(0.1 + 0.2, 0xff)).toBe('0.3'); // general, 15 digits
    expect(formatNumber(1234.5, 0x40)).toBe('1235'); // comma, 0 decimals
    expect(formatNumber(0.125, 0x33)).toBe('0.125'); // percent: the stored value
    expect(formatNumber(Number.NaN, 0xff)).toBe('');
    expect(formatNumber(70000, 0xf2)).toBe('2091-08-25');
    expect(formatNumber(99999, 0xf2)).toBe('99999');
  });

  it('rejects a file that does not start with a release 1A or 2 BOF record', () => {
    expect(convertLotus(Uint8Array.of(0, 0, 2))).toEqual({ ok: false, error: TEMPLATES.errLotusInvalid, warnings: [] });
    expect(convertLotus(sheet(rec(0x00, [6, 4, 0])))).toEqual({ ok: false, error: TEMPLATES.errLotusInvalid, warnings: [] });
    expect(convertLotus(sheet(bof(0x0405), eof()))).toEqual({
      ok: false,
      error: fill(TEMPLATES.errLotusVersion, 0x0405),
      warnings: [],
    });
  });

  it('keeps the cells it read when the file ends inside a record', () => {
    const whole = sheet(bof(), label(0, 0, 'kept'), label(1, 0, 'cut off'));
    const r = convertLotus(whole.subarray(0, whole.length - 3));
    expect(r.ok && r.output).toBe('kept\r\n');
    expect(r.warnings.map((x) => x.code)).toEqual([ConversionWarningCode.SheetTruncated]);
  });

  it('skips cells outside the sheet limits with one warning', () => {
    const r = convertLotus(sheet(bof(), int(0, 0, 1), int(MAX_SHEET_COLS, 0, 2), int(0, MAX_SHEET_ROWS, 3), eof()));
    expect(r.ok && r.output).toBe('1\r\n');
    expect(r.warnings.map((x) => x.code)).toEqual([ConversionWarningCode.LimitExceeded]);
  });

  it('stops at the output cap after the last whole row', () => {
    const r = runLotus(sheet(bof(), label(0, 0, 'abc'), label(0, 1, 'def'), eof()), 7);
    expect(r.ok && r.output).toBe('abc\r\n');
    expect(r.warnings.map((x) => x.code)).toEqual([ConversionWarningCode.OutputCapped]);
  });

  // Totality: any bytes after a valid BOF, and valid sheets with bytes flipped.
  const cellArb = fc.oneof(
    fc.tuple(fc.nat(300), fc.nat(9000), fc.string({ maxLength: 40 })).map(([c, r, t]) => label(c, r, t)),
    fc.tuple(fc.nat(300), fc.nat(9000), fc.integer({ min: -32768, max: 32767 }), fc.nat(255)).map(([c, r, v, f]) => int(c, r, v, f)),
    fc.tuple(fc.nat(300), fc.nat(9000), fc.double(), fc.nat(255)).map(([c, r, v, f]) => num(c, r, v, f)),
    fc.tuple(fc.nat(300), fc.nat(9000), fc.double(), fc.nat(255)).map(([c, r, v, f]) => formula(c, r, v, f)),
    fc.tuple(fc.nat(0xffff), fc.uint8Array({ maxLength: 64 })).map(([op, b]) => rec(op, [...b])),
  );
  const hostileArb = fc.oneof(
    fc.uint8Array({ maxLength: 4096 }).map((b) => sheet(bof(), [...b])),
    fc
      .tuple(fc.array(cellArb, { maxLength: 60 }), fc.array(fc.tuple(fc.nat(), fc.nat(255)), { maxLength: 8 }), fc.boolean())
      .map(([cells, flips, end]) => {
        const b = sheet(bof(), ...cells, end ? eof() : []);
        for (const [at, v] of flips) if (b.length > 6) b[6 + (at % (b.length - 6))] = v;
        return b;
      }),
  );

  it('never throws, stays in budget, leaves its input alone and honours the result contract', () => {
    fc.assert(
      fc.property(hostileArb, (bytes) => {
        const before = bytes.slice();
        const r = timed(() => convertLotus(bytes), CONVERT_TIME_BUDGET_MS);
        const unchanged = before.length === bytes.length && before.every((b, i) => bytes[i] === b);
        const problems = [...checkResultInvariants(r), ...checkResultInvariants(convertAuto(bytes))];
        if (!unchanged || problems.length > 0) throw new Error(`modified=${!unchanged} ${problems.join('; ')}`);
        return true;
      }),
      { numRuns: numRuns(300) },
    );
  });
});

describe('dBase IV tables with memo fields', () => {
  it('converts version 0x8B and writes memo cells empty with one warning', () => {
    const name = (s: string): number[] => [...s].map((c) => c.charCodeAt(0)).concat(Array(11 - s.length).fill(0));
    const field = (n: string, type: string, len: number): number[] => [...name(n), type.charCodeAt(0), 0, 0, 0, 0, len, 0, ...Array(14).fill(0)];
    const headerLength = 32 + 32 * 2 + 1;
    const recordLength = 1 + 6 + 10;
    const bytes = Uint8Array.from([
      0x8b, 89, 2, 8, 1, 0, 0, 0, headerLength, 0, recordLength, 0, ...Array(20).fill(0),
      ...field('TITLE', 'C', 6),
      ...field('ABSTRACT', 'M', 10),
      0x0d,
      0x20, ...[...'Floppy'].map((c) => c.charCodeAt(0)), ...[...'         1'].map((c) => c.charCodeAt(0)),
      0x1a,
    ]);
    expect(detectFormat(bytes)).toEqual({ format: 'dbase', source: 'content' });
    const r = convertAuto(bytes, 'REFERENC.DBF');
    expect(r.ok && r.output).toBe('TITLE,ABSTRACT\r\nFloppy,\r\n');
    expect(r.warnings.map((x) => x.code)).toEqual([ConversionWarningCode.MemoNotAvailable]);
  });
});

describe('dBase IV source files read as text', () => {
  it.each(['MAIN.PRG', 'CUSTFORM.FMT', 'CALCUST.QBE', 'LIST.FRG', 'MAILING.LBG', 'RAISE.UPD'])('%s', (fileName) => {
    // A .QBE keeps its design data after the 0x1A end-of-file byte; the text stops there.
    const bytes = Uint8Array.from([...[...'USE CUSTLIST\r\n'].map((c) => c.charCodeAt(0)), 0xb3, 0x0d, 0x0a, 0x1a, 0, 1, 2, 0x83]);
    expect(detectFormat(bytes, fileName)).toEqual({ format: 'text', source: 'extension' });
    const r = convertAuto(bytes, fileName);
    expect(r.ok && r.output).toBe('USE CUSTLIST\n│\n');
  });
});
