// Example tests for detectFormat. Validates: Requirements 2.3, 2.4, 2.5, 2.6, 2.7, 14.10
import { describe, expect, it } from 'vitest';
import { detectFormat } from './detect';
import { encodePcx, writeDbf, writeWordStar } from '../../test-support/formats';

const wordstarStyled = writeWordStar([
  { spans: [{ text: 'hello', styles: ['bold'] }] },
  { spans: [{ text: 'world' }] },
]);
const wordstarSoft = writeWordStar([{ spans: [{ text: 'aaa bbb ccc ddd' }], wrapAt: 5 }]);
const dbf = writeDbf({
  fields: [{ name: 'NAME', type: 'C', length: 4, decimals: 0 }],
  records: [{ deleted: false, values: [new Uint8Array([0x41, 0x42, 0x20, 0x20])] }],
});
const pcx = encodePcx({ mode: 'mono', width: 8, height: 1, indices: new Uint8Array(8) });
const plain = new Uint8Array([0x68, 0x69, 0x01]); // "hi" plus a control byte: matches no content rule
const hi = new Uint8Array([0x68, 0x69]); // "hi": text by content only
const TEXT_EXTENSIONS = ['TXT', 'BAT', 'ASC', 'LOG', 'NFO', 'DIZ', '1ST', 'ME'];

describe('detectFormat content', () => {
  it('detects each format from content', () => {
    expect(detectFormat(wordstarStyled)).toEqual({ format: 'wordstar', source: 'content' });
    expect(detectFormat(wordstarSoft)).toEqual({ format: 'wordstar', source: 'content' });
    expect(detectFormat(dbf)).toEqual({ format: 'dbase', source: 'content' });
    expect(detectFormat(pcx)).toEqual({ format: 'pcx', source: 'content' });
  });

  it('lets content beat a conflicting extension', () => {
    expect(detectFormat(pcx, 'x.dbf')).toEqual({ format: 'pcx', source: 'content' });
  });
});

describe('detectFormat extension fallback', () => {
  it.each(['a.ws', 'a.Ws', 'a.WS7'])('maps %s to wordstar', (name) => {
    expect(detectFormat(plain, name)).toEqual({ format: 'wordstar', source: 'extension' });
  });

  it('returns unknown/none for a name with no dot', () => {
    expect(detectFormat(plain, 'readme')).toEqual({ format: 'unknown', source: 'none' });
  });

  it.each(TEXT_EXTENSIONS.flatMap((e) => [`a.${e}`, `a.${e.toLowerCase()}`]))(
    'maps %s to text by extension',
    (name) => {
      expect(detectFormat(plain, name)).toEqual({ format: 'text', source: 'extension' });
    },
  );

  it('maps a mixed-case text extension to text', () => {
    expect(detectFormat(plain, 'Read.TxT')).toEqual({ format: 'text', source: 'extension' });
  });
});

describe('detectFormat text content', () => {
  it('detects text by content when no extension matches', () => {
    expect(detectFormat(hi)).toEqual({ format: 'text', source: 'content' });
    expect(detectFormat(hi, 'readme')).toEqual({ format: 'text', source: 'content' });
    expect(detectFormat(hi, 'a.bin')).toEqual({ format: 'text', source: 'content' });
  });

  it('prefers the extension source when both the extension and the content say text', () => {
    expect(detectFormat(hi, 'a.txt')).toEqual({ format: 'text', source: 'extension' });
  });

  it('treats the empty file as unknown without a text extension and as text with one', () => {
    const empty = new Uint8Array(0);
    expect(detectFormat(empty)).toEqual({ format: 'unknown', source: 'none' });
    expect(detectFormat(empty, 'a.bin')).toEqual({ format: 'unknown', source: 'none' });
    expect(detectFormat(empty, 'a.TXT')).toEqual({ format: 'text', source: 'extension' });
  });

  it('lets the strong extensions WS, DBF and PCX win over text content', () => {
    expect(detectFormat(hi, 'a.ws')).toEqual({ format: 'wordstar', source: 'extension' });
    expect(detectFormat(hi, 'a.DBF')).toEqual({ format: 'dbase', source: 'extension' });
    expect(detectFormat(hi, 'a.Pcx')).toEqual({ format: 'pcx', source: 'extension' });
  });
});

describe('detectFormat input guard', () => {
  it.each([
    ['null', null],
    ['string', 'abc'],
    ['ArrayBuffer', new ArrayBuffer(4)],
    ['array', [1, 2, 3]],
  ])('throws TypeError for %s', (_label, value) => {
    expect(() => detectFormat(value as unknown as Uint8Array)).toThrow(
      new TypeError('invalid input type: expected Uint8Array'),
    );
    expect(() => detectFormat(value as unknown as Uint8Array)).toThrow(TypeError);
  });

  it('accepts a Node Buffer', () => {
    expect(detectFormat(Buffer.from(pcx))).toEqual({ format: 'pcx', source: 'content' });
  });
});
