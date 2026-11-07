import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { numRuns } from '../runs';
import { FixtureError, decodePng, encodePcx, parseCsv, writeDbf, writeWordStar } from './index';
import type { DbfTable, PcxMode, PcxSource, WsParagraph, WsStyle } from './index';

describe('writeWordStar', () => {
  it('sets the high bit on word ends, wraps softly and ends with CRLF', () => {
    const bytes = writeWordStar([{ spans: [{ text: 'ab cd' }], wrapAt: 2 }]);
    expect(Array.from(bytes)).toEqual([0x61, 0xe2, 0x8d, 0x0a, 0x63, 0xe4, 0x0d, 0x0a]);
  });

  it('brackets styled spans with toggles', () => {
    const bytes = writeWordStar([{ spans: [{ text: 'a', styles: ['bold'] }] }]);
    expect(Array.from(bytes)).toEqual([0x02, 0xe1, 0x02, 0x0d, 0x0a]);
  });

  it('rejects non-printable text naming the field', () => {
    expect(() => writeWordStar([{ spans: [{ text: '\u0001' }] }])).toThrow(FixtureError);
  });
});

describe('writeDbf', () => {
  it('writes header, terminator, records and end marker', () => {
    const bytes = writeDbf({
      fields: [{ name: 'A', type: 'C', length: 2, decimals: 0 }],
      records: [{ deleted: true, values: [Uint8Array.of(0x78, 0x20)] }],
    });
    expect(bytes.length).toBe(32 + 32 + 1 + 3 + 1);
    expect(bytes[64]).toBe(0x0d);
    expect(bytes[65]).toBe(0x2a);
    expect(bytes[bytes.length - 1]).toBe(0x1a);
  });

  it('names the offending field and writes nothing on a bad length', () => {
    try {
      writeDbf({ fields: [{ name: 'A', type: 'C', length: 255, decimals: 0 }], records: [] });
      expect.unreachable();
    } catch (e) {
      expect((e as FixtureError).field).toBe('fields[0].length');
    }
  });
});

describe('encodePcx', () => {
  it('lets a run cross scanlines and appends the palette trailer', () => {
    const bytes = encodePcx({ mode: 'indexed256', width: 2, height: 4, indices: new Uint8Array(8) });
    // 4 rows of 2 zero bytes = one run of 8
    expect(Array.from(bytes.subarray(128, 130))).toEqual([0xc8, 0x00]);
    expect(bytes.length).toBe(128 + 2 + 769);
    expect(bytes[130]).toBe(0x0c);
  });

  it('escapes single bytes of 0xC0 and above', () => {
    const bytes = encodePcx({ mode: 'indexed256', width: 2, height: 1, indices: Uint8Array.of(0xc1, 0x05) });
    expect(Array.from(bytes.subarray(128, 131))).toEqual([0xc1, 0xc1, 0x05]);
  });

  it('rejects a bad dimension', () => {
    expect(() => encodePcx({ mode: 'mono', width: 0, height: 1, indices: new Uint8Array(0) })).toThrow(FixtureError);
  });
});

// ---------------------------------------------------------------------------
// Task 4.5: determinism, out-of-bounds descriptions, decoder and parser rejects
// ---------------------------------------------------------------------------

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const printable = fc
  .array(fc.integer({ min: 0x20, max: 0x7e }), { maxLength: 24 })
  .map((codes) => String.fromCharCode(...codes));

const wsParagraphs: fc.Arbitrary<WsParagraph[]> = fc.array(
  fc.record({
    spans: fc.array(
      fc.record({
        text: printable,
        styles: fc.subarray<WsStyle>(['bold', 'underline', 'italic']),
      }),
      { maxLength: 4 },
    ),
    wrapAt: fc.option(fc.integer({ min: 1, max: 30 }), { nil: undefined }),
  }),
  { maxLength: 6 },
);

const dbfTables: fc.Arbitrary<DbfTable> = fc
  .array(fc.integer({ min: 1, max: 6 }), { minLength: 1, maxLength: 4 })
  .chain((lengths) =>
    fc
      .array(
        fc.record({
          deleted: fc.boolean(),
          bytes: fc.uint8Array({ minLength: 24, maxLength: 24 }),
        }),
        { maxLength: 5 },
      )
      .map((recs) => ({
        fields: lengths.map((length, i) => ({ name: `F${i}`, type: 'C', length, decimals: 0 })),
        records: recs.map((r) => {
          let at = 0;
          return {
            deleted: r.deleted,
            values: lengths.map((n) => {
              const v = r.bytes.slice(at, at + n);
              at += n;
              return v;
            }),
          };
        }),
      })),
  );

const MODE_COLOURS: Record<PcxMode, number> = {
  mono: 2,
  planar16: 16,
  packed16: 16,
  indexed256: 256,
  rgb24: 0,
};

const pcxSources: fc.Arbitrary<PcxSource> = fc
  .tuple(
    fc.constantFrom<PcxMode>('mono', 'planar16', 'packed16', 'indexed256', 'rgb24'),
    fc.integer({ min: 1, max: 9 }),
    fc.integer({ min: 1, max: 9 }),
    fc.integer({ min: 0, max: 4 }),
  )
  .chain(([mode, width, height, padding]) =>
    fc.uint8Array({ minLength: width * height * 3, maxLength: width * height * 3 }).map((raw): PcxSource => {
      if (mode === 'rgb24') return { mode, width, height, padding, rgb: raw };
      const indices = raw.slice(0, width * height).map((v) => v % MODE_COLOURS[mode]);
      return { mode, width, height, padding, indices };
    }),
  );

describe('Property 36: fixture writers are deterministic', () => {
  // **Validates: Requirements 13.7, 13.8, 13.10**
  it('writeWordStar returns identical bytes for the same description', () => {
    fc.assert(
      fc.property(wsParagraphs, (d) => sameBytes(writeWordStar(d), writeWordStar(d))),
      { numRuns: numRuns(100) },
    );
  });

  it('writeDbf returns identical bytes for the same description', () => {
    fc.assert(
      fc.property(dbfTables, (d) => sameBytes(writeDbf(d), writeDbf(d))),
      { numRuns: numRuns(100) },
    );
  });

  it('encodePcx returns identical bytes for the same description', () => {
    fc.assert(
      fc.property(pcxSources, (d) => sameBytes(encodePcx(d), encodePcx(d))),
      { numRuns: numRuns(100) },
    );
  });
});

describe('out-of-bounds descriptions', () => {
  function fieldOf(fn: () => unknown): string {
    try {
      fn();
    } catch (e) {
      if (e instanceof FixtureError) return e.field;
      throw e;
    }
    return '<no throw>';
  }

  it('writeWordStar names the paragraph, wrapAt and style fields', () => {
    const tooMany = Array.from({ length: 1001 }, () => ({ spans: [] }));
    expect(fieldOf(() => writeWordStar(tooMany))).toBe('paragraphs');
    expect(fieldOf(() => writeWordStar([{ spans: [], wrapAt: 0 }]))).toBe('paragraphs[0].wrapAt');
    expect(fieldOf(() => writeWordStar([{ spans: [{ text: 'a', styles: ['bold', 'bold'] }] }]))).toBe(
      'paragraphs[0].spans[0].styles',
    );
  });

  it('writeDbf names the field name, record count and value length', () => {
    const f = (name: string): DbfTable => ({ fields: [{ name, type: 'C', length: 1, decimals: 0 }], records: [] });
    expect(fieldOf(() => writeDbf(f('')))).toBe('fields[0].name');
    expect(fieldOf(() => writeDbf(f('ABCDEFGHIJK')))).toBe('fields[0].name');
    expect(
      fieldOf(() =>
        writeDbf({
          fields: [{ name: 'A', type: 'C', length: 2, decimals: 0 }],
          records: [{ deleted: false, values: [Uint8Array.of(1)] }],
        }),
      ),
    ).toBe('records[0].values[0]');
    const many = Array.from({ length: 65536 }, () => ({ deleted: false, values: [] }));
    expect(fieldOf(() => writeDbf({ fields: [], records: many }))).toBe('records');
  });

  it('encodePcx names the dimension, padding and indices fields', () => {
    const base: PcxSource = { mode: 'mono', width: 1, height: 1, indices: Uint8Array.of(0) };
    expect(fieldOf(() => encodePcx({ ...base, width: 65536 }))).toBe('width');
    expect(fieldOf(() => encodePcx({ ...base, height: 0 }))).toBe('height');
    expect(fieldOf(() => encodePcx({ ...base, padding: 65 }))).toBe('padding');
    expect(fieldOf(() => encodePcx({ ...base, indices: Uint8Array.of(2) }))).toBe('indices');
  });
});

describe('decodePng and parseCsv rejection', () => {
  const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  function chunk(type: string, data: number[]): number[] {
    const len = data.length;
    const head = [(len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255];
    const t = Array.from(type, (c) => c.charCodeAt(0));
    return [...head, ...t, ...data, 0, 0, 0, 0]; // CRC is never checked by the decoder
  }

  function ihdr(colourType: number): number[] {
    return chunk('IHDR', [0, 0, 0, 1, 0, 0, 0, 1, 8, colourType, 0, 0, 0]);
  }

  /** A 1 by 1 PNG; `zlibBody` is everything in IDAT after the 2-byte zlib header. */
  function png(colourType: number, zlibBody: number[]): Uint8Array {
    return Uint8Array.from([
      ...SIGNATURE,
      ...ihdr(colourType),
      ...chunk('IDAT', [0x78, 0x01, ...zlibBody]),
      ...chunk('IEND', []),
    ]);
  }

  function storedBody(filter: number): number[] {
    // one final stored block of 5 bytes (filter + RGBA), then a dummy Adler-32
    return [0x01, 0x05, 0x00, 0xfa, 0xff, filter, 1, 2, 3, 4, 0, 0, 0, 0];
  }

  function featureOf(fn: () => unknown): string {
    try {
      fn();
    } catch (e) {
      if (e instanceof FixtureError) return e.field;
      throw e;
    }
    return '<no throw>';
  }

  it('accepts the hand-crafted baseline', () => {
    const d = decodePng(png(6, storedBody(0)));
    expect(Array.from(d.rgba)).toEqual([1, 2, 3, 4]);
  });

  it('rejects a compressed deflate block', () => {
    // BFINAL=1, BTYPE=01 (fixed Huffman)
    const body = [0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00];
    expect(featureOf(() => decodePng(png(6, body)))).toBe('deflate-compressed-block');
  });

  it('rejects a filter other than 0', () => {
    expect(featureOf(() => decodePng(png(6, storedBody(1))))).toBe('png-filter-not-0');
  });

  it('rejects a colour type other than 6', () => {
    expect(featureOf(() => decodePng(png(2, storedBody(0))))).toBe('png-colour-type-not-6');
  });

  it('rejects an unterminated quoted cell', () => {
    expect(featureOf(() => parseCsv('a,"b'))).toBe('csv-unterminated-quote');
    expect(featureOf(() => parseCsv('"a""'))).toBe('csv-unterminated-quote');
  });
});
