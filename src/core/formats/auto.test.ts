import { describe, expect, it } from 'vitest';
import { encodePcx, writeDbf, writeWordStar } from '../../test-support/formats';
import { convertAuto } from './auto';
import { convertDBase } from './dbase';
import * as barrel from './index';
import { convertPcx } from './pcx';
import { convertPlainText } from './plaintext';
import { convertWordStar } from './wordstar';

const ascii = (s: string): Uint8Array => Uint8Array.from(Array.from(s, (c) => c.charCodeAt(0)));

const wsBytes = writeWordStar([
  { spans: [{ text: 'hello ' }, { text: 'world', styles: ['bold'] }] },
  { spans: [{ text: 'second paragraph' }] },
]);
const dbfBytes = writeDbf({
  fields: [{ name: 'NAME', type: 'C', length: 5, decimals: 0 }],
  records: [{ deleted: false, values: [ascii('Ann  ')] }],
});
const pcxBytes = encodePcx({
  mode: 'indexed256',
  width: 2,
  height: 2,
  indices: Uint8Array.from([0, 1, 2, 3]),
  palette: new Uint8Array(768).map((_, i) => i % 256),
});

const NO_CONVERTER = { ok: false, error: 'no converter for this format', warnings: [] };

describe('convertAuto', () => {
  it('is re-exported from the barrel', () => {
    expect(barrel.convertAuto).toBe(convertAuto);
  });

  it('routes WordStar content to the WordStar converter', () => {
    const r = convertAuto(wsBytes);
    expect(r).toEqual(convertWordStar(wsBytes));
    expect(r.ok && r.mime).toBe('text/markdown');
    expect(r.ok && r.extension).toBe('.md');
  });

  it('routes dBase content to the dBase converter', () => {
    const r = convertAuto(dbfBytes);
    expect(r).toEqual(convertDBase(dbfBytes));
    expect(r.ok && r.mime).toBe('text/csv');
    expect(r.ok && r.extension).toBe('.csv');
  });

  it('routes PCX content to the PCX converter', () => {
    const r = convertAuto(pcxBytes);
    expect(r).toEqual(convertPcx(pcxBytes));
    expect(r.ok && r.mime).toBe('image/png');
    expect(r.ok && r.extension).toBe('.png');
  });

  it('returns the no-converter failure for unknown input', () => {
    for (const input of [new Uint8Array(0), Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])]) {
      expect(convertAuto(input)).toStrictEqual(NO_CONVERTER);
    }
  });

  it('routes plain text content to the plain text converter', () => {
    const input = ascii('hello');
    const r = convertAuto(input);
    expect(r).toEqual(convertPlainText(input));
    expect(r.ok && r.mime).toBe('text/plain');
    expect(r.ok && r.extension).toBe('.txt');
  });

  it('returns a fresh warnings array on every call', () => {
    const unknown = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
    const a = convertAuto(unknown);
    a.warnings.push({ code: 'x' } as never);
    const b = convertAuto(unknown);
    expect(b).toStrictEqual(NO_CONVERTER);
    expect(b.warnings).not.toBe(a.warnings);
  });

  it('falls back to the extension for headerless samples', () => {
    const plain = ascii('hello world');
    expect(convertAuto(plain, 'x.ws')).toEqual(convertWordStar(plain));

    const short = ascii('hello');
    const dbf = convertAuto(short, 'a.dbf');
    expect(dbf).toEqual(convertDBase(short));
    expect(dbf).toMatchObject({ ok: false, error: 'dBase header invalid: condition 2' });

    const pcx = convertAuto(short, 'a.pcx');
    expect(pcx).toEqual(convertPcx(short));
    expect(pcx).toMatchObject({ ok: false, error: 'PCX header too short: 5 bytes' });
  });

  it('prefers content over a conflicting extension', () => {
    expect(convertAuto(pcxBytes, 'x.dbf')).toEqual(convertPcx(pcxBytes));
  });

  it('throws the exact TypeError for non-Uint8Array input, even with a file name', () => {
    for (const bad of [null, undefined, 'abc', [1, 2], new ArrayBuffer(4), Buffer.from('a').buffer]) {
      expect(() => convertAuto(bad as never, 'x.ws')).toThrow(
        new TypeError('invalid input type: expected Uint8Array'),
      );
      expect(() => convertAuto(bad as never)).toThrow(TypeError);
    }
  });

  it('ignores a hostile non-string file name', () => {
    const hostile = {
      toString() {
        throw new Error('boom');
      },
    };
    for (const name of [hostile, 42, null, ['x.ws'], Symbol('x.ws')]) {
      expect(convertAuto(ascii('hello world'), name)).toEqual(convertPlainText(ascii('hello world')));
    }
  });
});
