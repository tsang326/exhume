import { describe, it } from 'vitest';
import fc from 'fast-check';
import { convertAuto, convertDBase, convertPcx, convertPlainText, convertWordStar, detectFormat } from './index';
import { CONVERT_TIME_BUDGET_MS, MAX_CONVERT_INPUT_BYTES } from './limits';
import { contentSpecArb, expandContent } from '../../test-support/formats/arbitraries';
import { hostileInputArb, mutatedFixtureArb } from '../../test-support/formats/hostile';
import type { HostileFormat, HostileInput } from '../../test-support/formats/hostile';
import { checkResultInvariants } from '../../test-support/formats/invariants';
import { numRuns } from '../../test-support/runs';
import { timed } from '../../test-support/timed';

// Property 2: Totality on hostile input.
// **Validates: Requirements 1.7, 1.9, 12.3, 12.5, 12.11, 14.3, 14.4**

const MAX_RANDOM_BYTES = 2_097_152;

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Input is already generated. Only the call is timed. Afterwards: the input is
 * unchanged and, for converters, the result honours the contract.
 */
function checkConverter(name: string, bytes: Uint8Array, call: (input: Uint8Array) => unknown, contract: boolean): void {
  const before = bytes.slice();
  let result: unknown;
  try {
    result = timed(() => call(bytes), CONVERT_TIME_BUDGET_MS);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`${name}: threw or exceeded budget on ${bytes.length}-byte input: ${msg}`);
  }
  if (!sameBytes(before, bytes)) throw new Error(`${name}: modified its input`);
  if (contract) {
    const violations = checkResultInvariants(result);
    if (violations.length > 0) throw new Error(`${name}: ${violations.join('; ')}`);
  } else {
    const r = result as { format?: unknown } | null;
    if (typeof r !== 'object' || r === null || typeof r.format !== 'string') {
      throw new Error(`${name}: result has no format string`);
    }
  }
}

const CONVERTERS: Record<Exclude<HostileFormat, 'auto'>, (input: Uint8Array) => unknown> = {
  wordstar: (b) => convertWordStar(b),
  dbase: (b) => convertDBase(b),
  pcx: (b) => convertPcx(b),
  text: (b) => convertPlainText(b),
};

function runAll(format: HostileFormat, bytes: Uint8Array): void {
  if (format === 'auto') {
    checkConverter('detectFormat', bytes, (b) => detectFormat(b), false);
    checkConverter('convertAuto', bytes, (b) => convertAuto(b), true);
  } else {
    checkConverter(`convert ${format}`, bytes, CONVERTERS[format], true);
  }
}

const FORMATS: HostileFormat[] = ['wordstar', 'dbase', 'pcx', 'text', 'auto'];

// Feature: plain-text, Property 8: Totality on hostile input
// **Validates: Requirements 2.9, 3.2, 3.5, 3.7, 3.10**

const PLAIN_TEXT_SIZES: number[] = [MAX_CONVERT_INPUT_BYTES, MAX_CONVERT_INPUT_BYTES + 1];

const plainTextHostileArb: fc.Arbitrary<Uint8Array> = fc.oneof(
  { weight: 3, arbitrary: fc.uint8Array({ minLength: 0, maxLength: 4096 }) },
  {
    weight: 2,
    arbitrary: fc
      .uint8Array({ minLength: 0, maxLength: 4096 })
      .map((a) => a.map((b) => (b === 0x1a ? 0x1b : b))),
  },
  {
    weight: 2,
    arbitrary: fc
      .array(fc.integer({ min: 0, max: 0x1f }), { minLength: 0, maxLength: 4096 })
      .map((a) => Uint8Array.from(a)),
  },
  {
    weight: 1,
    arbitrary: fc.integer({ min: 0, max: 4096 }).map((n) => new Uint8Array(n).fill(0x0d)),
  },
  { weight: 3, arbitrary: mutatedFixtureArb('text').map((h) => h.bytes) },
  { weight: 3, arbitrary: hostileInputArb('text').map((h) => h.bytes) },
  {
    weight: 1,
    arbitrary: fc
      .tuple(fc.constantFrom(...PLAIN_TEXT_SIZES), fc.constantFrom(0x0d, 0xc4, 0x01, 0x41, 0xff))
      .map(([n, b]) => new Uint8Array(n).fill(b)),
  },
);

describe('plain text hostile input (Property 8)', () => {
  it('convertPlainText and convertAuto are total on hostile bytes', () => {
    fc.assert(
      fc.property(plainTextHostileArb, (bytes: Uint8Array) => {
        checkConverter('convertPlainText', bytes, (b) => convertPlainText(b), true);
        checkConverter('convertAuto', bytes, (b) => convertAuto(b), true);
      }),
      { numRuns: numRuns(100) },
    );
  }, 600_000);
});

describe('formats hostile input (Property 2)', () => {
  for (const format of FORMATS) {
    it(`hostile families: ${format}`, () => {
      fc.assert(
        fc.property(hostileInputArb(format), (input: HostileInput) => {
          runAll(format, input.bytes);
        }),
        { numRuns: numRuns(100) },
      );
    }, 600_000);

    it(`one mutation of a valid fixture: ${format}`, () => {
      fc.assert(
        fc.property(mutatedFixtureArb(format), (input: HostileInput) => {
          runAll(format, input.bytes);
        }),
        { numRuns: numRuns(100) },
      );
    }, 600_000);

    it(`random bytes, full 0..2,097,152 range: ${format}`, () => {
      fc.assert(
        fc.property(
          fc.oneof(
            { weight: 3, arbitrary: contentSpecArb(0, 4096) },
            { weight: 1, arbitrary: contentSpecArb(0, MAX_RANDOM_BYTES) },
            { weight: 1, arbitrary: contentSpecArb(MAX_RANDOM_BYTES, MAX_RANDOM_BYTES) },
          ),
          (spec) => {
            runAll(format, expandContent(spec.seed, spec.length));
          },
        ),
        { numRuns: numRuns(100) },
      );
    }, 600_000);
  }
});
