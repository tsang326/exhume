import { describe, expect, it } from 'vitest';
import * as fc from 'fast-check';
import { numRuns } from '../../test-support/runs';
import { detectOracle } from '../../test-support/formats/oracles';
import { detectFormat } from './detect';

/** Leading bytes that start each detection family, plus two bytes that start none. */
const LEADING_FAMILIES: readonly number[] = [0x0a, 0x03, 0x83, 0x8d, 0x2e, 0x0d, 0x02, 0x13, 0x19, 0x00, 0x41];

const shortBytes = fc.uint8Array({ minLength: 0, maxLength: 64 });
const longBytes = fc.uint8Array({ minLength: 0, maxLength: 6000 });

/** Bytes that favour the interesting values of every detection rule. */
const biasedByte = fc.oneof(
  fc.constantFrom(0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x08, 0x0a, 0x0d, 0x13, 0x19, 0x2e, 0x41, 0x61, 0x83, 0x8a, 0x8d, 0xff),
  fc.integer({ min: 0, max: 255 }),
);
const biasedBytes = fc.array(biasedByte, { minLength: 0, maxLength: 200 }).map((a) => Uint8Array.from(a));

/** One leading-byte family followed by a short tail, so every length 0 to 12 is reachable. */
const familyInput = fc
  .tuple(fc.constantFrom(...LEADING_FAMILIES), fc.array(biasedByte, { minLength: 0, maxLength: 11 }))
  .map(([lead, tail]) => Uint8Array.from([lead, ...tail]));

const PCX_VERSIONS = [0, 1, 2, 3, 4, 5] as const;
const PCX_BPP = [0, 1, 2, 4, 8, 16] as const;

/** PCX-like prefix with every field drawn from its boundary values, then a tail. */
const pcxish = fc
  .tuple(
    fc.constantFrom(0x0a, 0x0b),
    fc.constantFrom(...PCX_VERSIONS),
    fc.constantFrom(0, 1, 2),
    fc.constantFrom(...PCX_BPP),
    fc.uint8Array({ minLength: 0, maxLength: 20 }),
  )
  .map(([m, v, e, b, tail]) => Uint8Array.from([m, v, e, b, ...tail]));

const HEADER_LENGTHS = [0, 31, 32, 63, 64, 65, 66, 4128, 4129, 4130, 65535] as const;
const RECORD_LENGTHS = [0, 1, 2, 3] as const;

/** dBase-like header; the input length is the header length, one more, one less, or random. */
const dbaseish = fc
  .record({
    version: fc.constantFrom(0x03, 0x83, 0x02, 0x04, 0x8b),
    headerLength: fc.constantFrom(...HEADER_LENGTHS),
    recordLength: fc.constantFrom(...RECORD_LENGTHS),
    lengthDelta: fc.constantFrom(-1, 0, 1, 2, 5),
    fill: fc.constantFrom(0x00, 0x0d, 0x20, 0xff),
  })
  .map(({ version, headerLength, recordLength, lengthDelta, fill }) => {
    const total = Math.max(0, Math.min(headerLength + lengthDelta, 5000));
    const out = new Uint8Array(Math.max(total, 12)).fill(fill);
    out[0] = version;
    out[8] = headerLength & 0xff;
    out[9] = headerLength >> 8;
    out[10] = recordLength & 0xff;
    out[11] = recordLength >> 8;
    // Lengths below 12 are allowed too: the detector must not throw on them.
    return total < 12 ? out.subarray(0, total) : out;
  });

/** WordStar-like pieces joined in random order, optionally with a leading filler. */
const WS_PIECES: readonly (readonly number[])[] = [
  [0x8d, 0x0a],
  [0x8d, 0x8a],
  [0x8d, 0x0d],
  [0x0d, 0x0a],
  [0x0d],
  [0x0a],
  [0x02],
  [0x13],
  [0x19],
  [0x2e, 0x50, 0x41],
  [0x2e, 0x35, 0x41],
  [0x2e, 0x50],
  [0x2e],
  [0x41, 0x42],
];
const wordstarish = fc
  .array(fc.constantFrom(...WS_PIECES), { minLength: 0, maxLength: 12 })
  .map((pieces) => Uint8Array.from(pieces.flat()));

/** A real-looking WordStar document followed by padding beyond the sample window. */
const wordstarWithPadding = fc
  .tuple(wordstarish, fc.integer({ min: 0, max: 5000 }), fc.integer({ min: 0, max: 255 }))
  .map(([head, pad, fill]) => {
    const out = new Uint8Array(head.length + pad).fill(fill);
    out.set(head, 0);
    return out;
  });

const anyInput = fc.oneof(
  shortBytes,
  longBytes,
  biasedBytes,
  familyInput,
  pcxish,
  dbaseish,
  wordstarish,
  wordstarWithPadding,
);

function matchesOracle(bytes: Uint8Array): boolean {
  const expected = detectOracle(bytes);
  const got = detectFormat(bytes);
  const source = expected === 'unknown' ? 'none' : 'content';
  return got.format === expected && got.source === source;
}

describe('detectFormat content detection', () => {
  // Feature: format-resurrection, Property 5: Content detection matches the rule oracle
  it('matches the oracle on random bytes of 0 to 64 bytes', () => {
    // **Validates: Requirements 2.1, 2.3, 2.4, 2.5, 2.8, 2.9**
    fc.assert(fc.property(shortBytes, matchesOracle), { numRuns: numRuns(100) });
  });

  // Feature: format-resurrection, Property 5: Content detection matches the rule oracle
  it('matches the oracle on larger random bytes', () => {
    // **Validates: Requirements 2.1, 2.3, 2.4, 2.5, 2.8, 2.9**
    fc.assert(fc.property(longBytes, matchesOracle), { numRuns: numRuns(100) });
  });

  // Feature: format-resurrection, Property 5: Content detection matches the rule oracle
  it('matches the oracle for every leading-byte family at lengths 0 to 12', () => {
    // **Validates: Requirements 2.1, 2.3, 2.4, 2.5, 2.8, 2.9**
    fc.assert(fc.property(familyInput, matchesOracle), { numRuns: numRuns(100) });
  });

  // Feature: format-resurrection, Property 5: Content detection matches the rule oracle
  it('matches the oracle on PCX-like prefixes', () => {
    // **Validates: Requirements 2.1, 2.3, 2.4, 2.5, 2.8, 2.9**
    fc.assert(fc.property(pcxish, matchesOracle), { numRuns: numRuns(100) });
  });

  // Feature: format-resurrection, Property 5: Content detection matches the rule oracle
  it('matches the oracle on dBase-like headers at boundary lengths', () => {
    // **Validates: Requirements 2.1, 2.3, 2.4, 2.5, 2.8, 2.9**
    fc.assert(fc.property(dbaseish, matchesOracle), { numRuns: numRuns(100) });
  });

  // Feature: format-resurrection, Property 5: Content detection matches the rule oracle
  it('matches the oracle on WordStar-like piece sequences, with and without padding', () => {
    // **Validates: Requirements 2.1, 2.3, 2.4, 2.5, 2.8, 2.9**
    fc.assert(fc.property(wordstarish, matchesOracle), { numRuns: numRuns(100) });
    fc.assert(fc.property(wordstarWithPadding, matchesOracle), { numRuns: numRuns(100) });
  });

  // Feature: format-resurrection, Property 5: Content detection matches the rule oracle
  it('matches the oracle on the mixed input space', () => {
    // **Validates: Requirements 2.1, 2.3, 2.4, 2.5, 2.8, 2.9**
    fc.assert(fc.property(anyInput, matchesOracle), { numRuns: numRuns(100) });
  });

  it('agrees with the oracle for every length 0 to 12 of every leading-byte family', () => {
    // **Validates: Requirements 2.8, 2.9**
    for (const lead of LEADING_FAMILIES) {
      for (const fill of [0x00, 0x01, 0x0a, 0x0d, 0x41, 0xff]) {
        for (let length = 0; length <= 12; length++) {
          const bytes = new Uint8Array(length).fill(fill);
          if (length > 0) bytes[0] = lead;
          const expected = detectOracle(bytes);
          const got = detectFormat(bytes);
          expect(got.format).toBe(expected);
          expect(got.source).toBe(expected === 'unknown' ? 'none' : 'content');
        }
      }
    }
  });

  it('never throws on empty or short input and reports unknown for empty input', () => {
    // **Validates: Requirements 2.8, 2.9**
    expect(detectFormat(new Uint8Array(0))).toEqual({ format: 'unknown', source: 'none' });
    for (let length = 0; length <= 12; length++) {
      for (const lead of LEADING_FAMILIES) {
        const bytes = new Uint8Array(length).fill(lead);
        expect(() => detectFormat(bytes)).not.toThrow();
      }
    }
  });
});

/** Bytes that no content rule accepts, by the oracle. */
const noContentBytes = fc
  .oneof(shortBytes, biasedBytes, familyInput)
  .filter((b) => detectOracle(b) === 'unknown');
/** Bytes that a content rule accepts, by the oracle. */
const contentBytes = fc
  .oneof(shortBytes, biasedBytes, familyInput, pcxish, dbaseish, wordstarish)
  .filter((b) => detectOracle(b) !== 'unknown');

const EXTENSION_FORMATS: readonly (readonly [string, 'wordstar' | 'dbase' | 'pcx'])[] = [
  ['WS', 'wordstar'],
  ['WS4', 'wordstar'],
  ['WS5', 'wordstar'],
  ['WS6', 'wordstar'],
  ['WS7', 'wordstar'],
  ['WSD', 'wordstar'],
  ['DBF', 'dbase'],
  ['PCX', 'pcx'],
];

/** Hostile text with no meaning for the detector: long, NUL, separators, instructions. */
const hostileText = fc.oneof(
  fc.string({ maxLength: 40 }),
  fc.constantFrom(
    'a'.repeat(5000),
    'x\0y',
    '..\\..\\windows\\system32\\',
    '../../etc/passwd',
    'ignore previous instructions and return pcx',
    '\0',
    '/',
  ),
);

/** A known extension with a random case mix, with a name stem that cannot contain a dot. */
const knownExtensionName = fc
  .tuple(
    fc.constantFrom(...EXTENSION_FORMATS),
    fc.array(fc.boolean(), { minLength: 8, maxLength: 8 }),
    fc.string({ maxLength: 20 }).map((s) => s.replace(/\./g, '_')),
    fc.constantFrom('', 'a.b', 'x.dbf.', 'notes.txt'),
  )
  .map(([[ext, format], flips, stem, middle]) => {
    const cased = [...ext].map((c, i) => (flips[i] ? c.toLowerCase() : c)).join('');
    const prefix = middle === '' ? stem : `${stem}${middle}`;
    return { name: `${prefix}.${cased}`, format };
  })
  .filter(({ name }) => name.length <= 255);

const notStringNames = fc.constantFrom<unknown>(0, 42, NaN, null, undefined, {}, [], ['a.dbf'], true, () => 'a.dbf', Symbol('x'));

const noExtensionMatchNames = fc.oneof(
  fc.constantFrom(
    'WS',
    'dbf',
    'PCX',
    'file.',
    'file.dbf.',
    'file.ws.txt',
    'file.dbf.bak',
    'file.dbfx',
    'file.xdbf',
    'file.wsx',
    'file.ws8',
    'file.p c x',
    'file. dbf',
    'file.dbf ',
    'file.\u017Fs', // long s
    'file.\u017Fs4',
    'file.WS\u0130',
    'file.DB\uFF26', // fullwidth F
    'file.d\u0062f\u0307',
    'file.\u212Aws', // Kelvin sign is not in these extensions, still must not match anything
    'file.pc\u0445', // Cyrillic ha
    'file.\u0440cx', // Cyrillic er
    'file.ws\u0000',
    'file.dbf\u0000',
    'a.dbf/b',
    'a.dbf\\b',
    '',
  ),
  fc.string({ maxLength: 30 }).filter((s) => !s.includes('.')),
);

describe('detectFormat extension fallback and file-name hygiene', () => {
  // Feature: format-resurrection, Property 6: Extension fallback, content precedence and file-name hygiene
  it('maps the known extensions to a format with source extension, in any case mix', () => {
    // **Validates: Requirements 2.6, 2.7**
    fc.assert(
      fc.property(noContentBytes, knownExtensionName, (bytes, { name, format }) => {
        const got = detectFormat(bytes, name);
        return got.format === format && got.source === 'extension';
      }),
      { numRuns: numRuns(100) },
    );
  });

  // Feature: format-resurrection, Property 6: Extension fallback, content precedence and file-name hygiene
  it('uses the text after the last dot', () => {
    // **Validates: Requirements 2.6**
    fc.assert(
      fc.property(noContentBytes, fc.constantFrom(...EXTENSION_FORMATS), (bytes, [ext, format]) => {
        const win = detectFormat(bytes, `a.${ext}.zzz`);
        const lose = detectFormat(bytes, `a.zzz.${ext}`);
        return win.format === 'unknown' && win.source === 'none' && lose.format === format && lose.source === 'extension';
      }),
      { numRuns: numRuns(100) },
    );
  });

  // Feature: format-resurrection, Property 6: Extension fallback, content precedence and file-name hygiene
  it('reports unknown with source none for names that carry no known extension', () => {
    // **Validates: Requirements 2.7**
    fc.assert(
      fc.property(noContentBytes, noExtensionMatchNames, (bytes, name) => {
        const got = detectFormat(bytes, name);
        return got.format === 'unknown' && got.source === 'none';
      }),
      { numRuns: numRuns(100) },
    );
  });

  // Feature: format-resurrection, Property 6: Extension fallback, content precedence and file-name hygiene
  it('does not fold Unicode look-alike letters onto ASCII extensions', () => {
    // **Validates: Requirements 2.7**
    const bytes = Uint8Array.from([0x41, 0x42]);
    expect(detectOracle(bytes)).toBe('unknown');
    for (const name of ['a.\u017Fs', 'a.\u017Fs4', 'a.w\u017F', 'a.\u212Aws', 'a.dbf\u212A', 'a.\u0130pcx']) {
      expect(detectFormat(bytes, name)).toEqual({ format: 'unknown', source: 'none' });
    }
    expect(detectFormat(bytes, 'a.ws')).toEqual({ format: 'wordstar', source: 'extension' });
  });

  // Feature: format-resurrection, Property 6: Extension fallback, content precedence and file-name hygiene
  it('lets content win over any file name, including a conflicting extension', () => {
    // **Validates: Requirements 2.6, 2.12**
    const anyName = fc.oneof(
      knownExtensionName.map((k) => k.name),
      noExtensionMatchNames,
      notStringNames,
      hostileText,
    );
    fc.assert(
      fc.property(contentBytes, anyName, (bytes, name) => {
        const expected = detectOracle(bytes);
        const got = detectFormat(bytes, name);
        return got.format === expected && got.source === 'content';
      }),
      { numRuns: numRuns(100) },
    );
  });

  // Feature: format-resurrection, Property 6: Extension fallback, content precedence and file-name hygiene
  it('ignores a file name that is not a string', () => {
    // **Validates: Requirements 2.10**
    fc.assert(
      fc.property(fc.oneof(noContentBytes, contentBytes), notStringNames, (bytes, name) => {
        const got = detectFormat(bytes, name);
        const plain = detectFormat(bytes);
        return got.format === plain.format && got.source === plain.source;
      }),
      { numRuns: numRuns(100) },
    );
  });

  // Feature: format-resurrection, Property 6: Extension fallback, content precedence and file-name hygiene
  it('ignores a file name longer than 255 characters but honours one of exactly 255', () => {
    // **Validates: Requirements 2.10**
    fc.assert(
      fc.property(
        noContentBytes,
        fc.constantFrom(...EXTENSION_FORMATS),
        fc.integer({ min: 256, max: 3000 }),
        (bytes, [ext, format], length) => {
          const tooLong = `${'a'.repeat(length - ext.length - 1)}.${ext}`;
          const longest = `${'a'.repeat(255 - ext.length - 1)}.${ext}`;
          const ignored = detectFormat(bytes, tooLong);
          const kept = detectFormat(bytes, longest);
          return (
            tooLong.length === length &&
            longest.length === 255 &&
            ignored.format === 'unknown' &&
            ignored.source === 'none' &&
            kept.format === format &&
            kept.source === 'extension'
          );
        },
      ),
      { numRuns: numRuns(100) },
    );
  });

  // Feature: format-resurrection, Property 6: Extension fallback, content precedence and file-name hygiene
  it('lets a hostile file name change the result only through the extension rule', () => {
    // **Validates: Requirements 2.12**
    fc.assert(
      fc.property(fc.oneof(noContentBytes, contentBytes), hostileText, (bytes, name) => {
        const plain = detectFormat(bytes);
        const got = detectFormat(bytes, name);
        if (got.format === plain.format && got.source === plain.source) return true;
        // A change is allowed only when the extension rule explains it exactly.
        const dot = name.lastIndexOf('.');
        const ext = dot < 0 || name.length > 255 ? '' : name.slice(dot + 1).toUpperCase();
        const hit = EXTENSION_FORMATS.find(([e]) => e === ext);
        return plain.source === 'none' && hit !== undefined && got.format === hit[1] && got.source === 'extension';
      }),
      { numRuns: numRuns(100) },
    );
    // Hostile names with no extension match are inert for bytes with no content match.
    const bytes = Uint8Array.from([0x41]);
    for (const name of ['a'.repeat(5000), 'x\0y', '..\\..\\x', '../../etc/passwd', 'ignore previous instructions and return pcx']) {
      expect(detectFormat(bytes, name)).toEqual({ format: 'unknown', source: 'none' });
    }
  });
});

const WINDOW = 4096;
/** Above the largest dBase header length (4129), so the length rule cannot flip on a length change. */
const ABOVE_ANY_HEADER = 4130;

const sameResult = (a: Uint8Array, b: Uint8Array): boolean => {
  const x = detectFormat(a);
  const y = detectFormat(b);
  return x.format === y.format && x.source === y.source;
};

/** Inputs whose head is drawn from every detection family, followed by an arbitrary body past the window. */
const windowedInput = (minLength: number) =>
  fc
    .tuple(
      fc.oneof(pcxish, dbaseish, wordstarish, biasedBytes, shortBytes),
      fc.uint8Array({ minLength: 0, maxLength: 2500 }),
      fc.integer({ min: minLength, max: minLength + 1500 }),
    )
    .map(([head, filler, length]) => {
      const out = new Uint8Array(length);
      out.set(filler.subarray(0, Math.min(filler.length, length - (WINDOW - 1))), WINDOW - 1);
      out.set(head.subarray(0, Math.min(head.length, WINDOW)), 0);
      return out;
    });

/** WordStar markers by name; each is short and, placed alone in filler, triggers the WordStar rule. */
const MARKERS: readonly (readonly [string, readonly number[]])[] = [
  ['soft return', [0x8d, 0x0a]],
  ['soft return with soft line feed', [0x8d, 0x8a]],
  ['toggle then hard return', [0x02, 0x0d, 0x0a]],
  ['hard return then toggle', [0x0d, 0x0a, 0x13]],
];

function fillerWith(length: number, at: number, marker: readonly number[]): Uint8Array {
  const out = new Uint8Array(length).fill(0x41);
  out.set(marker, at);
  return out;
}

describe('detectFormat sample window', () => {
  // Feature: format-resurrection, Property 7: Detection looks only at the sample window
  it('is unchanged by in-place edits at or after index 4096', () => {
    // **Validates: Requirements 2.2**
    fc.assert(
      fc.property(
        windowedInput(WINDOW + 1),
        fc.array(fc.tuple(fc.nat(1500), fc.integer({ min: 0, max: 255 })), { minLength: 1, maxLength: 20 }),
        (bytes, edits) => {
          const mutated = bytes.slice();
          for (const [offset, value] of edits) {
            const index = WINDOW + offset;
            if (index < mutated.length) mutated[index] = value;
          }
          return mutated.length === bytes.length && sameResult(bytes, mutated);
        },
      ),
      { numRuns: numRuns(100) },
    );
  });

  // Feature: format-resurrection, Property 7: Detection looks only at the sample window
  it('is unchanged by appending or removing tail bytes while the length stays above every dBase header length', () => {
    // **Validates: Requirements 2.2**
    fc.assert(
      fc.property(
        windowedInput(ABOVE_ANY_HEADER),
        fc.uint8Array({ minLength: 0, maxLength: 300 }),
        fc.nat(1000),
        (bytes, extra, cut) => {
          const appended = new Uint8Array(bytes.length + extra.length);
          appended.set(bytes, 0);
          appended.set(extra, bytes.length);
          const keep = Math.max(ABOVE_ANY_HEADER, bytes.length - cut);
          const truncated = bytes.slice(0, keep);
          return truncated.length >= ABOVE_ANY_HEADER && sameResult(bytes, appended) && sameResult(bytes, truncated);
        },
      ),
      { numRuns: numRuns(100) },
    );
  });

  // Feature: format-resurrection, Property 7: Detection looks only at the sample window
  it('never detects WordStar from a marker placed only after the window', () => {
    // **Validates: Requirements 2.2**
    fc.assert(
      fc.property(
        fc.constantFrom(...MARKERS),
        fc.nat(800),
        fc.nat(400),
        ([, marker], offset, tail) => {
          const at = WINDOW + offset;
          const bytes = fillerWith(at + marker.length + tail, at, marker);
          const got = detectFormat(bytes);
          return got.format === 'unknown' && got.source === 'none';
        },
      ),
      { numRuns: numRuns(100) },
    );
  });

  // Feature: format-resurrection, Property 7: Detection looks only at the sample window
  it('does not see a dot command that starts at index 4096 even after a hard return', () => {
    // **Validates: Requirements 2.2**
    const bytes = fillerWith(WINDOW + 50, WINDOW - 2, [0x0d, 0x0a, 0x2e, 0x50, 0x41]);
    expect(detectFormat(bytes)).toEqual({ format: 'unknown', source: 'none' });
    const inside = fillerWith(WINDOW + 50, 0, [0x2e, 0x50, 0x41]);
    expect(detectFormat(inside)).toEqual({ format: 'wordstar', source: 'content' });
  });

  // Feature: format-resurrection, Property 7: Detection looks only at the sample window
  it('does not see a two-byte marker that straddles the window edge', () => {
    // **Validates: Requirements 2.2**
    const bytes = fillerWith(WINDOW + 50, WINDOW - 1, [0x8d, 0x0a]);
    expect(detectFormat(bytes)).toEqual({ format: 'unknown', source: 'none' });
  });

  // Feature: format-resurrection, Property 7: Detection looks only at the sample window
  it('detects the same markers when they sit fully inside the window', () => {
    // **Validates: Requirements 2.2**
    fc.assert(
      fc.property(
        fc.constantFrom(...MARKERS),
        fc.nat(WINDOW),
        fc.integer({ min: 0, max: 600 }),
        ([, marker], position, tail) => {
          const at = Math.min(position, WINDOW - marker.length);
          const bytes = fillerWith(WINDOW + tail + 1, at, marker);
          const got = detectFormat(bytes);
          return got.format === 'wordstar' && got.source === 'content';
        },
      ),
      { numRuns: numRuns(100) },
    );
    const dot = fillerWith(WINDOW + 10, 0, [0x2e, 0x50, 0x41]);
    expect(detectFormat(dot)).toEqual({ format: 'wordstar', source: 'content' });
  });
});
