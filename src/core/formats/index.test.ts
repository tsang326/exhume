import { describe, expect, it } from 'vitest';
import * as api from './index';
import {
  convertWordStar,
  convertDBase,
  convertPcx,
  convertPlainText,
  encodePng,
  detectFormat,
  convertAuto,
  ConversionWarningCode,
  MAX_CONVERT_INPUT_BYTES,
  DETECT_SAMPLE_BYTES,
  MAX_WARNINGS,
  MAX_MARKDOWN_OUTPUT_BYTES,
  MAX_DBF_FIELDS,
  MAX_DBF_RECORDS,
  MAX_CSV_OUTPUT_BYTES,
  MAX_IMAGE_DIMENSION,
  MAX_IMAGE_PIXELS,
  MAX_PCX_BYTES_PER_LINE,
  MAX_PCX_DECODED_BYTES,
  MAX_PNG_BYTES,
  CONVERT_TIME_BUDGET_MS,
} from './index';
import type {
  ConversionResult,
  ConversionWarning,
  ConversionSuccess,
  ConversionFailure,
  MarkdownResult,
  CsvResult,
  TextResult,
  PngResult,
  RgbaImage,
  DetectResult,
  DetectedFormat,
  DetectSource,
  OutputMime,
  OutputExtension,
} from './index';
import { encodePcx, writeDbf, writeWordStar } from '../../test-support/formats';

const badInputs: Array<[string, unknown]> = [
  ['null', null],
  ['undefined', undefined],
  ['string', 'abc'],
  ['number', 42],
  ['array', [1, 2, 3]],
  ['ArrayBuffer', new ArrayBuffer(64)],
  ['DataView', new DataView(new ArrayBuffer(64))],
];

const wordstar = writeWordStar([{ spans: [{ text: 'Hello', styles: ['bold'] }, { text: ' world' }] }]);
const dbase = writeDbf({
  fields: [{ name: 'NAME', type: 'C', length: 5, decimals: 0 }],
  records: [{ deleted: false, values: [Uint8Array.from([0x41, 0x42, 0x20, 0x20, 0x20])] }],
});
const pcx = encodePcx({
  mode: 'mono',
  width: 8,
  height: 2,
  indices: Uint8Array.from([0, 1, 0, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 0]),
});

const converters: Array<[string, (input: Uint8Array) => unknown, Uint8Array]> = [
  ['convertWordStar', convertWordStar, wordstar],
  ['convertDBase', convertDBase, dbase],
  ['convertPcx', convertPcx, pcx],
  ['convertPlainText', convertPlainText, Uint8Array.from([0x68, 0x69, 0x0d, 0x0a])],
  ['detectFormat', (i) => detectFormat(i), wordstar],
  ['convertAuto', (i) => convertAuto(i), wordstar],
];

describe('formats public index', () => {
  it('exposes the public values', () => {
    for (const f of [convertWordStar, convertDBase, convertPcx, convertPlainText, encodePng, detectFormat, convertAuto]) {
      expect(typeof f).toBe('function');
    }
    expect(ConversionWarningCode.InputTruncated).toBe('input-truncated');
    const limits = [
      MAX_CONVERT_INPUT_BYTES, DETECT_SAMPLE_BYTES, MAX_WARNINGS, MAX_MARKDOWN_OUTPUT_BYTES,
      MAX_DBF_FIELDS, MAX_DBF_RECORDS, MAX_CSV_OUTPUT_BYTES, MAX_IMAGE_DIMENSION,
      MAX_IMAGE_PIXELS, MAX_PCX_BYTES_PER_LINE, MAX_PCX_DECODED_BYTES, MAX_PNG_BYTES,
      CONVERT_TIME_BUDGET_MS,
    ];
    for (const l of limits) expect(typeof l).toBe('number');
  });

  it('exposes the public types', () => {
    const types: [
      ConversionResult?, ConversionWarning?, ConversionSuccess<string, 'text/markdown', '.md'>?,
      ConversionFailure?, MarkdownResult?, CsvResult?, TextResult?, PngResult?, RgbaImage?, DetectResult?,
      DetectedFormat?, DetectSource?, OutputMime?, OutputExtension?,
    ] = [];
    expect(types).toHaveLength(0);
  });

  it('does not export the internal runners', () => {
    const keys = Object.keys(api);
    expect(keys).not.toContain('runWordStar');
    expect(keys).not.toContain('runDBase');
    expect(keys).not.toContain('runPlainText');
  });

  describe.each(converters)('%s', (_name, fn, sample) => {
    describe.each(badInputs)('rejects %s', (_n, input) => {
      it('throws the exact TypeError', () => {
        expect(() => fn(input as Uint8Array)).toThrow(TypeError);
        expect(() => fn(input as Uint8Array)).toThrow(
          new TypeError('invalid input type: expected Uint8Array'),
        );
      });
    });

    it('treats a Buffer like a Uint8Array', () => {
      const buf = Buffer.from(sample);
      expect(fn(buf)).toEqual(fn(Uint8Array.from(sample)));
    });
  });

  describe.each(badInputs)('encodePng with %s', (_n, input) => {
    it('returns a failure without throwing', () => {
      let result: PngResult | undefined;
      expect(() => {
        result = encodePng(input as RgbaImage);
      }).not.toThrow();
      expect(result).toMatchObject({ ok: false, error: 'PNG input invalid' });
    });
  });

  it('encodePng fails without throwing for {} and bad fields', () => {
    const bad: unknown[] = [
      {},
      { width: 1, height: 1 },
      { width: 1, height: 1, rgba: [0, 0, 0, 0] },
      { width: 1.5, height: 1, rgba: new Uint8Array(4) },
      { width: 0, height: 1, rgba: new Uint8Array(0) },
      { width: '1', height: 1, rgba: new Uint8Array(4) },
      { width: 1, height: 1, rgba: new Uint8Array(3) },
    ];
    for (const b of bad) {
      const r = encodePng(b as RgbaImage);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe('PNG input invalid');
    }
  });

  it('convertAuto and detectFormat accept an optional file name', () => {
    expect(detectFormat(wordstar, 'letter.ws')).toBeDefined();
    expect(convertAuto(wordstar, 'letter.ws').ok).toBe(true);
    expect(detectFormat(dbase, 'DATA.DBF').format).toBe('dbase');
    expect(convertAuto(dbase, 'DATA.DBF').ok).toBe(true);
    expect(convertAuto(pcx, 'pic.pcx').ok).toBe(true);
    expect(detectFormat(pcx)).toEqual(detectFormat(pcx, undefined));
  });
});
