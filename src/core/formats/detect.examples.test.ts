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
const plain = new Uint8Array([0x68, 0x69]); // "hi": matches no content rule

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
