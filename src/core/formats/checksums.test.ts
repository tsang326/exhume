import { crc32 as zlibCrc32 } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { numRuns } from '../../test-support/runs';
import { referenceAdler32 } from '../../test-support/formats/oracles';
import { adler32, adler32Update, crc32, crc32Update } from './checksums';

const ascii = (s: string): Uint8Array => Uint8Array.from(s, (ch) => ch.charCodeAt(0));

const bytes = fc.uint8Array({ minLength: 0, maxLength: 12000 });

describe('checksums', () => {
  // Feature: format-resurrection, Property 35: Checksums match references
  it('crc32 equals zlib.crc32', () => {
    // **Validates: Requirements 11.5, 11.6, 11.7**
    fc.assert(fc.property(bytes, (b) => crc32(b) === zlibCrc32(b)), { numRuns: numRuns(100) });
  });

  // Feature: format-resurrection, Property 35: Checksums match references
  it('adler32 equals the per-byte reference', () => {
    // **Validates: Requirements 11.5, 11.6, 11.7**
    fc.assert(fc.property(bytes, (b) => adler32(b) === referenceAdler32(b)), {
      numRuns: numRuns(100),
    });
  });

  // Feature: format-resurrection, Property 35: Checksums match references
  it('adler32 of all-0xFF arrays beyond the deferred-modulus window matches the reference', () => {
    // **Validates: Requirements 11.5, 11.6, 11.7**
    fc.assert(
      fc.property(fc.integer({ min: 5551, max: 20000 }), (n) => {
        const b = new Uint8Array(n).fill(0xff);
        return adler32(b) === referenceAdler32(b);
      }),
      { numRuns: numRuns(100) },
    );
  });

  // Feature: format-resurrection, Property 35: Checksums match references
  it('chaining across a split point equals a single pass', () => {
    // **Validates: Requirements 11.5, 11.6, 11.7**
    fc.assert(
      fc.property(bytes, fc.nat(), (b, r) => {
        const k = b.length === 0 ? 0 : r % (b.length + 1);
        const head = b.subarray(0, k);
        const tail = b.subarray(k);
        const crcOk = crc32Update(crc32(head), tail) === crc32(b);
        const adlerOk = adler32Update(adler32(head), tail) === adler32(b);
        return crcOk && adlerOk;
      }),
      { numRuns: numRuns(100) },
    );
  });

  // Feature: format-resurrection, Property 35: Checksums match references
  it('start/end range arguments select the half-open range', () => {
    // **Validates: Requirements 11.5, 11.6, 11.7**
    fc.assert(
      fc.property(bytes, fc.nat(), fc.nat(), (b, r1, r2) => {
        const x = r1 % (b.length + 1);
        const y = r2 % (b.length + 1);
        const s = Math.min(x, y);
        const e = Math.max(x, y);
        const slice = b.slice(s, e);
        return (
          crc32Update(0, b, s, e) === crc32(slice) &&
          adler32Update(1, b, s, e) === adler32(slice) &&
          adler32Update(1, b, s, e) === referenceAdler32(slice)
        );
      }),
      { numRuns: numRuns(100) },
    );
  });

  it('matches the known example vectors', () => {
    expect(crc32(ascii('123456789'))).toBe(0xcbf43926);
    expect(adler32(ascii('Wikipedia'))).toBe(0x11e60398);
    expect(crc32(new Uint8Array(0))).toBe(0);
    expect(adler32(new Uint8Array(0))).toBe(1);
  });
});
