import fc from 'fast-check';
import { describe, it } from 'vitest';
import { convertAuto } from '../core/formats/index';
import { decodePng, parseCsv } from '../test-support/formats/index';
import { numRuns } from '../test-support/runs';
import { CP437_LETTERS } from './content/cp437';
import { logoToPcx } from './content/logo';
import type { AuthoredLogo } from './content/logo';
import { tableToDbf } from './content/table';
import type { AuthoredField, AuthoredTable } from './content/table';

// Characters a C value may hold: printable ASCII except the formula starters
// (checked separately for the first position) plus the listed CP437 letters.
const ASCII_REST = Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => String.fromCharCode(0x20 + i));
const ASCII_FIRST = ASCII_REST.filter((c) => c !== ' ' && !'=+-@'.includes(c));
const LETTERS = Array.from(CP437_LETTERS.keys());

const firstChar = fc.oneof({ weight: 6, arbitrary: fc.constantFrom(...ASCII_FIRST) }, { weight: 1, arbitrary: fc.constantFrom(...LETTERS) });
const restChar = fc.oneof({ weight: 6, arbitrary: fc.constantFrom(...ASCII_REST) }, { weight: 1, arbitrary: fc.constantFrom(...LETTERS) });

/** A C value of 0..max characters: no leading or trailing space, no formula starter. */
function textValue(max: number): fc.Arbitrary<string> {
  return fc.integer({ min: 0, max }).chain((n) => {
    if (n === 0) return fc.constant('');
    if (n === 1) return firstChar;
    return fc
      .tuple(firstChar, fc.array(restChar, { minLength: n - 2, maxLength: n - 2 }), fc.constantFrom(...ASCII_FIRST))
      .map(([a, mid, z]) => a + mid.join('') + z);
  });
}

const digitStr = (min: number, max: number): fc.Arbitrary<string> =>
  fc.integer({ min, max }).map((n) => String(n));

/** A plain decimal number that fits `length` characters. */
function numberValue(length: number): fc.Arbitrary<string> {
  return fc
    .tuple(fc.boolean(), digitStr(0, 9999), fc.option(digitStr(0, 99), { nil: undefined }))
    .map(([neg, whole, frac]) => `${neg ? '-' : ''}${whole}${frac === undefined ? '' : `.${frac}`}`)
    .filter((s) => s.length <= length);
}

const dateValue: fc.Arbitrary<string> = fc
  .tuple(fc.integer({ min: 1980, max: 2099 }), fc.integer({ min: 1, max: 12 }), fc.integer({ min: 1, max: 28 }))
  .map(([y, m, d]) => `${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`);

const fieldSpec: fc.Arbitrary<AuthoredField> = fc.oneof(
  fc.integer({ min: 1, max: 12 }).map((length): AuthoredField => ({ name: '', type: 'C', length, decimals: 0 })),
  fc.integer({ min: 8, max: 12 }).map((length): AuthoredField => ({ name: '', type: 'N', length, decimals: 2 })),
  fc.constant<AuthoredField>({ name: '', type: 'D', length: 8, decimals: 0 }),
);

function valueFor(f: AuthoredField): fc.Arbitrary<string> {
  if (f.type === 'C') return textValue(f.length);
  if (f.type === 'N') return numberValue(f.length);
  return dateValue;
}

const authoredTable: fc.Arbitrary<AuthoredTable> = fc
  .array(fieldSpec, { minLength: 1, maxLength: 5 })
  .map((specs) => specs.map((f, i): AuthoredField => ({ ...f, name: `F${i}` })))
  .chain((fields) =>
    fc
      .array(fc.tuple(...fields.map(valueFor)), { maxLength: 8 })
      .map((rows): AuthoredTable => ({ fields, rows })),
  );

const authoredLogo: fc.Arbitrary<AuthoredLogo> = fc
  .tuple(fc.integer({ min: 1, max: 24 }), fc.integer({ min: 1, max: 24 }), fc.integer({ min: 1, max: 16 }))
  .chain(([width, height, colors]) =>
    fc
      .tuple(
        fc.array(fc.tuple(fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 }), fc.integer({ min: 0, max: 255 })), {
          minLength: colors,
          maxLength: colors,
        }),
        fc.array(fc.integer({ min: 0, max: colors - 1 }), { minLength: width * height, maxLength: width * height }),
      )
      .map(([palette, grid]): AuthoredLogo => ({
        width,
        height,
        palette,
        pixel: (x, y) => grid[y * width + x] as number,
      })),
  );

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function sameRows(a: string[][], b: string[][]): boolean {
  if (a.length !== b.length) return false;
  for (let r = 0; r < a.length; r++) {
    const ra = a[r] as string[];
    const rb = b[r] as string[];
    if (ra.length !== rb.length) return false;
    for (let c = 0; c < ra.length; c++) if (ra[c] !== rb[c]) return false;
  }
  return true;
}

describe('demo-disks builders (properties)', () => {
  // Feature: demo-disks, Property 3: Table builder round trip
  // **Validates: Requirements 6.4, 10.8**
  it('Property 3: converting tableToDbf bytes gives back expectedCsv', () => {
    fc.assert(
      fc.property(authoredTable, (table) => {
        const { bytes, expectedCsv } = tableToDbf(table);
        const result = convertAuto(bytes, 'TABLE.DBF');
        if (!result.ok || typeof result.output !== 'string') return false;
        return sameRows(parseCsv(result.output), expectedCsv);
      }),
      { numRuns: numRuns(100) },
    );
  });

  // Feature: demo-disks, Property 4: Logo builder round trip
  // **Validates: Requirements 6.6, 10.8**
  it('Property 4: converting logoToPcx bytes gives the authored size and pixels', () => {
    fc.assert(
      fc.property(authoredLogo, (logo) => {
        const { bytes, expectedRgba } = logoToPcx(logo);
        const result = convertAuto(bytes, 'LOGO.PCX');
        if (!result.ok || typeof result.output === 'string') return false;
        const png = decodePng(result.output);
        return png.width === logo.width && png.height === logo.height && sameBytes(png.rgba, expectedRgba);
      }),
      { numRuns: numRuns(100) },
    );
  });
});
