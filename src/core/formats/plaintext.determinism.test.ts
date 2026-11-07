import fc from 'fast-check';
import { describe, it } from 'vitest';
import { convertAuto, convertDBase, convertPcx, convertPlainText, convertWordStar, detectFormat } from './index';
import type { ConversionResult } from './index';
import { plainTextBytesArb } from '../../test-support/formats/arbitraries';
import { hostileInputArb } from '../../test-support/formats/hostile';
import { numRuns } from '../../test-support/runs';

const CAP = 200_000;

const textArb: fc.Arbitrary<Uint8Array> = fc.oneof(
  plainTextBytesArb,
  hostileInputArb('text').map((h) => h.bytes.subarray(0, CAP)),
  hostileInputArb('auto').map((h) => h.bytes.subarray(0, CAP)),
  fc.uint8Array({ maxLength: 512 }),
);

const otherArb: fc.Arbitrary<Uint8Array> = fc.oneof(
  plainTextBytesArb,
  fc.uint8Array({ maxLength: 512 }),
  hostileInputArb('auto').map((h) => h.bytes.subarray(0, 4096)),
);

/** A Buffer view with a non-zero byteOffset inside a larger allocation. */
function pooledView(bytes: Uint8Array): Uint8Array {
  const pad = Buffer.alloc(13, 0xaa);
  const slab = Buffer.concat([pad, Buffer.from(bytes), pad]);
  return slab.subarray(pad.length, pad.length + bytes.length);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function sameResult(a: ConversionResult, b: ConversionResult): boolean {
  if (a.ok !== b.ok) return false;
  const wa = a.warnings.map((w) => `${w.code}|${w.message}`);
  const wb = b.warnings.map((w) => `${w.code}|${w.message}`);
  if (wa.length !== wb.length || wa.some((w, i) => w !== wb[i])) return false;
  if (!a.ok || !b.ok) return !a.ok && !b.ok && a.error === b.error;
  if (a.mime !== b.mime || a.extension !== b.extension) return false;
  if (typeof a.output === 'string' || typeof b.output === 'string') return a.output === b.output;
  return sameBytes(a.output, b.output);
}

/**
 * Feature: plain-text, Property 6: Determinism and Buffer equivalence
 *
 * **Validates: Requirements 1.14, 2.12**
 */
describe('Property 6: determinism and Buffer equivalence', () => {
  it('convertPlainText is deterministic, Buffer-equivalent and leaves the input unchanged', () => {
    fc.assert(
      fc.property(textArb, otherArb, (bytes, other) => {
        const before = Uint8Array.from(bytes);
        const first = convertPlainText(bytes);
        convertWordStar(other);
        const second = convertPlainText(bytes);
        convertDBase(other);
        convertPcx(other);
        convertAuto(other);
        const third = convertPlainText(bytes);
        const copy = convertPlainText(Buffer.from(bytes));
        const view = convertPlainText(pooledView(bytes));
        return (
          sameBytes(before, bytes) &&
          sameResult(first, second) &&
          sameResult(first, third) &&
          sameResult(first, copy) &&
          sameResult(first, view)
        );
      }),
      { numRuns: numRuns(100) },
    );
  });

  it('detectFormat is deterministic, Buffer-equivalent and leaves the input unchanged', () => {
    fc.assert(
      fc.property(textArb, otherArb, (bytes, other) => {
        const before = Uint8Array.from(bytes);
        const first = JSON.stringify(detectFormat(bytes));
        detectFormat(other);
        const second = JSON.stringify(detectFormat(bytes));
        convertAuto(other);
        const third = JSON.stringify(detectFormat(bytes));
        const copy = JSON.stringify(detectFormat(Buffer.from(bytes)));
        const view = JSON.stringify(detectFormat(pooledView(bytes)));
        return (
          sameBytes(before, bytes) && first === second && first === third && first === copy && first === view
        );
      }),
      { numRuns: numRuns(100) },
    );
  });
});
