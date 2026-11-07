import { describe, expect, it } from 'vitest';
import { convertDBase, convertPcx, convertWordStar } from './index';
import type { ConversionResult } from './index';
import {
  CONVERT_TIME_BUDGET_MS,
  MAX_CONVERT_INPUT_BYTES,
  MAX_WARNINGS,
} from './limits';
import { TEMPLATES, fill } from './templates';
import { parseCsv } from '../../test-support/formats';
import { writeDbf } from '../../test-support/formats/dbase-writer';
import { checkResultInvariants } from '../../test-support/formats/invariants';
import { timed } from '../../test-support/timed';

// Every case builds its input first and times only the converter call.
// Each case must not throw, stay within budget, honour the result contract and
// either fail or carry at least one warning.

function run(convert: (input: Uint8Array) => ConversionResult, input: Uint8Array): ConversionResult {
  const before = input.length;
  const result = timed(() => convert(input), CONVERT_TIME_BUDGET_MS);
  expect(input.length).toBe(before);
  expect(checkResultInvariants(result)).toEqual([]);
  expect(result.warnings.length).toBeLessThanOrEqual(MAX_WARNINGS + 1);
  expect(!result.ok || result.warnings.length > 0).toBe(true);
  return result;
}

// ---------------------------------------------------------------------------
// PCX builders
// ---------------------------------------------------------------------------

interface PcxHeaderSpec {
  bpp: number;
  planes: number;
  xmax: number;
  ymax: number;
  bytesPerLine: number;
}

function pcxHeader(s: PcxHeaderSpec): Uint8Array {
  const h = new Uint8Array(128);
  h[0] = 0x0a;
  h[1] = 5;
  h[2] = 1;
  h[3] = s.bpp;
  h[8] = s.xmax & 0xff;
  h[9] = s.xmax >> 8;
  h[10] = s.ymax & 0xff;
  h[11] = s.ymax >> 8;
  h[65] = s.planes;
  h[66] = s.bytesPerLine & 0xff;
  h[67] = s.bytesPerLine >> 8;
  return h;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

describe('targeted hostile PCX', () => {
  it('rejects a 65,535 by 65,535 header without decoding', () => {
    const input = concat(
      pcxHeader({ bpp: 8, planes: 1, xmax: 65534, ymax: 65534, bytesPerLine: 4096 }),
      new Uint8Array(64),
    );
    const r = run(convertPcx, input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(fill(TEMPLATES.errPcxLarge, 65535, 65535));
  });

  it('rejects bytes per line 65,535', () => {
    const input = concat(
      pcxHeader({ bpp: 8, planes: 1, xmax: 63, ymax: 63, bytesPerLine: 65535 }),
      new Uint8Array(64),
    );
    const r = run(convertPcx, input);
    expect(r.ok).toBe(false);
  });

  it('ignores a 4 MiB 0xFF 0x00 RLE bomb beyond the 64 by 64 target', () => {
    // The decoder fills 4,096 bytes and stops; no trailer sits at the consumed position,
    // so a palette-missing warning is guaranteed.
    const header = pcxHeader({ bpp: 8, planes: 1, xmax: 63, ymax: 63, bytesPerLine: 64 });
    const input = new Uint8Array(MAX_CONVERT_INPUT_BYTES);
    input.set(header, 0);
    for (let i = header.length; i < input.length; i += 2) {
      input[i] = 0xff;
      input[i + 1] = 0x00;
    }
    const r = run(convertPcx, input);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.mime).toBe('image/png');
      expect(r.warnings.some((w) => w.code === 'pcx-palette-missing')).toBe(true);
    }
  });

  it('bounds the RLE stream at a 769-byte trailer overlapping pixel data', () => {
    // By design (pcx.ts) the 0x0C-marked trailer wins: pixel data stops at the trailer
    // start, so the image is short and a pcx-data-truncated warning is raised.
    const header = pcxHeader({ bpp: 8, planes: 1, xmax: 39, ymax: 39, bytesPerLine: 40 });
    const data = new Uint8Array(1600).fill(0x01);
    const input = concat(header, data);
    input[input.length - 769] = 0x0c; // marker byte inside the pixel data
    const r = run(convertPcx, input);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.some((w) => w.code === 'pcx-data-truncated')).toBe(true);
    }
  });

  it('reports 2049x2048 as too large and decodes nothing', () => {
    const input = concat(
      pcxHeader({ bpp: 8, planes: 1, xmax: 2048, ymax: 2047, bytesPerLine: 2050 }),
      new Uint8Array(256).fill(1),
    );
    const r = run(convertPcx, input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(fill(TEMPLATES.errPcxLarge, 2049, 2048));
    expect('output' in r).toBe(false);
  });

  it('reports a 4097-wide image as too large and decodes nothing', () => {
    const input = concat(
      pcxHeader({ bpp: 8, planes: 1, xmax: 4096, ymax: 0, bytesPerLine: 4096 }),
      new Uint8Array(256).fill(1),
    );
    const r = run(convertPcx, input);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(fill(TEMPLATES.errPcxLarge, 4097, 1));
    expect('output' in r).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// dBase builders
// ---------------------------------------------------------------------------

function ascii(text: string, length: number): Uint8Array {
  const out = new Uint8Array(length).fill(0x20);
  for (let i = 0; i < text.length && i < length; i++) out[i] = text.charCodeAt(i);
  return out;
}

/** Fixed header with the given counts; descriptors are filled by the caller. */
function rawDbfHeader(recordCount: number, headerLength: number, recordLength: number, size: number): Uint8Array {
  const h = new Uint8Array(size);
  h[0] = 0x03;
  h[4] = recordCount & 0xff;
  h[5] = (recordCount >>> 8) & 0xff;
  h[6] = (recordCount >>> 16) & 0xff;
  h[7] = (recordCount >>> 24) & 0xff;
  h[8] = headerLength & 0xff;
  h[9] = headerLength >> 8;
  h[10] = recordLength & 0xff;
  h[11] = recordLength >> 8;
  return h;
}

function setDescriptor(h: Uint8Array, index: number, name: string, type: string, length: number): void {
  const d = 32 + index * 32;
  for (let i = 0; i < name.length; i++) h[d + i] = name.charCodeAt(i);
  h[d + 11] = type.charCodeAt(0);
  h[d + 16] = length;
}

describe('targeted hostile dBase', () => {
  it('handles a record count of 4,294,967,295 on a one-record file', () => {
    const input = writeDbf({
      fields: [{ name: 'NAME', type: 'C', length: 4, decimals: 0 }],
      records: [{ deleted: false, values: [ascii('abcd', 4)] }],
    });
    input[4] = 0xff;
    input[5] = 0xff;
    input[6] = 0xff;
    input[7] = 0xff;
    const r = run(convertDBase, input);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings.some((w) => w.code === 'records-truncated')).toBe(true);
      expect(r.warnings.some((w) => w.code === 'record-limit')).toBe(true);
    }
  });

  it('handles record length 65,535 with a tiny file', () => {
    const h = rawDbfHeader(1, 66, 65535, 67);
    setDescriptor(h, 0, 'A', 'C', 1);
    h[64] = 0x0d;
    const r = run(convertDBase, h);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.some((w) => w.code === 'record-length-mismatch')).toBe(true);
  });

  it('rejects header length 65,535', () => {
    const h = rawDbfHeader(1, 65535, 2, 70000);
    setDescriptor(h, 0, 'A', 'C', 1);
    h[64] = 0x0d;
    const r = run(convertDBase, h);
    expect(r.ok).toBe(false);
  });

  it('rejects 255 descriptors with no terminator', () => {
    const size = 32 + 255 * 32;
    const h = rawDbfHeader(1, size, 256, size);
    for (let i = 0; i < 255; i++) setDescriptor(h, i, 'F', 'C', 1);
    const r = run(convertDBase, h);
    expect(r.ok).toBe(false);
  });

  it('neutralises formula prefixes in field names and C values', () => {
    // A fifth field with unknown type letter Q and a deleted record guarantee warnings,
    // because the formula-prefix handling itself is silent.
    const prefixes = ['=', '+', '-', '@'];
    const names = ['=SUM', '+ADD', '-SUB', '@AT', 'ODD'];
    const fields = names.map((name, i) => ({
      name,
      type: i === 4 ? 'Q' : 'C',
      length: 8,
      decimals: 0,
    }));
    const values = ['=1+1', '+cmd', '-cmd', '@SUM(A)', 'zzz'].map((v) => ascii(v, 8));
    const input = writeDbf({
      fields,
      records: [
        { deleted: false, values },
        { deleted: true, values },
      ],
    });
    const r = run(convertDBase, input);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings.some((w) => w.code === 'field-type-unknown')).toBe(true);
    expect(r.warnings.some((w) => w.code === 'deleted-records-skipped')).toBe(true);
    expect(typeof r.output).toBe('string');
    const rows = parseCsv(r.output as string);
    expect(rows.length).toBe(2);
    for (const row of rows) {
      for (let c = 0; c < 4; c++) {
        const cell = row[c] as string;
        expect(prefixes.includes(cell.charAt(0))).toBe(false);
        expect(cell.charAt(0)).toBe("'");
      }
    }
  });
});

// ---------------------------------------------------------------------------
// WordStar
// ---------------------------------------------------------------------------

describe('targeted hostile WordStar', () => {
  it('survives 4 MiB of style-toggle bytes', () => {
    // A dropped control byte (0x01) at the start guarantees a control-codes-dropped warning.
    const input = new Uint8Array(MAX_CONVERT_INPUT_BYTES);
    const toggles = [0x02, 0x13, 0x19];
    for (let i = 0; i < input.length; i++) {
      input[i] = i % 997 === 996 ? 0x61 + (i % 26) : (toggles[i % 3] as number);
    }
    input[0] = 0x01;
    const r = run(convertWordStar, input);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.some((w) => w.code === 'control-codes-dropped')).toBe(true);
  });

  it('survives 100,000 dot-command lines', () => {
    const line = '.MT 5\r\n';
    const input = new Uint8Array(line.length * 100_000);
    for (let n = 0; n < 100_000; n++) {
      for (let i = 0; i < line.length; i++) input[n * line.length + i] = line.charCodeAt(i);
    }
    const r = run(convertWordStar, input);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings.some((w) => w.code === 'dot-commands-ignored')).toBe(true);
  });
});
