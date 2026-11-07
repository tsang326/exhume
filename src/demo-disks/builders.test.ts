import { describe, expect, it } from 'vitest';
import { DemoBuildError } from './errors';
import { logoToPcx } from './content/logo';
import type { AuthoredLogo } from './content/logo';
import { tableToDbf } from './content/table';
import type { AuthoredTable } from './content/table';

function table(overrides: Partial<AuthoredTable> = {}): AuthoredTable {
  return {
    fields: [
      { name: 'NAME', type: 'C', length: 6, decimals: 0 },
      { name: 'SINCE', type: 'D', length: 8, decimals: 0 },
      { name: 'BALANCE', type: 'N', length: 8, decimals: 2 },
    ],
    rows: [['Ana', '19890314', '12.50']],
    ...overrides,
  };
}

function logo(overrides: Partial<AuthoredLogo> = {}): AuthoredLogo {
  return {
    width: 2,
    height: 2,
    palette: [
      [0, 0, 0],
      [255, 128, 7],
    ],
    pixel: (x, y) => (x + y) % 2,
    ...overrides,
  };
}

describe('tableToDbf', () => {
  it('builds bytes and the expected CSV rows, with dates as YYYY-MM-DD', () => {
    const { bytes, expectedCsv } = tableToDbf(table());
    expect(bytes.length).toBeGreaterThan(32);
    expect(expectedCsv).toEqual([
      ['NAME', 'SINCE', 'BALANCE'],
      ['Ana', '1989-03-14', '12.50'],
    ]);
  });

  it('accepts a CP437 letter above 0x7F', () => {
    const { bytes } = tableToDbf(table({ rows: [['José', '19890314', '1.00']] }));
    expect(bytes.includes(0x82)).toBe(true);
  });

  it.each(['=SUM', '+1', '-x', '@a'])('rejects a text value starting with %s', (v) => {
    expect(() => tableToDbf(table({ rows: [[v, '19890314', '1.00']] }))).toThrow(DemoBuildError);
  });

  it('rejects a value that is too long', () => {
    expect(() => tableToDbf(table({ rows: [['TooLongName', '19890314', '1.00']] }))).toThrow(DemoBuildError);
  });

  it('rejects a character with no CP437 byte', () => {
    expect(() => tableToDbf(table({ rows: [['A\u20ac', '19890314', '1.00']] }))).toThrow(DemoBuildError);
  });

  it.each(['', 'lower', 'HAS SPACE', 'TOOLONGNAME1'])('rejects the field name %j', (name) => {
    const t = table();
    t.fields = [{ name, type: 'C', length: 6, decimals: 0 }, ...t.fields.slice(1)];
    expect(() => tableToDbf(t)).toThrow(DemoBuildError);
  });

  it('rejects a bad date, a bad number and a short row', () => {
    expect(() => tableToDbf(table({ rows: [['Ana', '1989-3-1', '1.00']] }))).toThrow(DemoBuildError);
    expect(() => tableToDbf(table({ rows: [['Ana', '19890314', 'abc']] }))).toThrow(DemoBuildError);
    expect(() => tableToDbf(table({ rows: [['Ana', '19890314']] }))).toThrow(DemoBuildError);
  });

  it('rejects a table with no fields', () => {
    expect(() => tableToDbf({ fields: [], rows: [] })).toThrow(DemoBuildError);
  });
});

describe('logoToPcx', () => {
  it('builds bytes and the expected RGBA pixels with alpha 255', () => {
    const { bytes, expectedRgba } = logoToPcx(logo());
    expect(bytes[0]).toBe(0x0a);
    expect(Array.from(expectedRgba)).toEqual([
      0, 0, 0, 255, 255, 128, 7, 255,
      255, 128, 7, 255, 0, 0, 0, 255,
    ]);
  });

  it('rejects zero or oversized dimensions', () => {
    expect(() => logoToPcx(logo({ width: 0 }))).toThrow(DemoBuildError);
    expect(() => logoToPcx(logo({ height: 0 }))).toThrow(DemoBuildError);
    expect(() => logoToPcx(logo({ width: 257 }))).toThrow(DemoBuildError);
  });

  it('rejects a pixel index outside the palette', () => {
    expect(() => logoToPcx(logo({ pixel: () => 2 }))).toThrow(DemoBuildError);
    expect(() => logoToPcx(logo({ pixel: () => -1 }))).toThrow(DemoBuildError);
  });

  it('rejects an empty palette and a palette component above 255', () => {
    expect(() => logoToPcx(logo({ palette: [] }))).toThrow(DemoBuildError);
    expect(() => logoToPcx(logo({ palette: [[0, 0, 256]], pixel: () => 0 }))).toThrow(DemoBuildError);
  });
});
