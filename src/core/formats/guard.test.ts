import { describe, expect, it } from 'vitest';
import { assertUint8Array, guarded, limitInput } from './guard';
import { MAX_CONVERT_INPUT_BYTES, MAX_WARNINGS } from './limits';
import { failResult, okResult } from './result';
import { ConversionWarningCode } from './types';
import { makeWarningCollector } from './warnings';

const C = ConversionWarningCode;

describe('warning collector', () => {
  it('stores 100 adds without a cap warning', () => {
    const w = makeWarningCollector();
    for (let i = 0; i < MAX_WARNINGS; i++) w.add(C.ControlCodesDropped, 'x');
    expect(w.list()).toHaveLength(MAX_WARNINGS);
  });

  it('adds one warnings-capped on the 101st and ignores later adds', () => {
    const w = makeWarningCollector();
    for (let i = 0; i < MAX_WARNINGS + 50; i++) w.add(C.ControlCodesDropped, 'x');
    const l = w.list();
    expect(l).toHaveLength(MAX_WARNINGS + 1);
    expect(l[MAX_WARNINGS]).toEqual({ code: C.WarningsCapped, message: 'warnings capped at 100' });
  });

  it('addOnce dedupes by code and key without using the cap', () => {
    const w = makeWarningCollector();
    for (let i = 0; i < 300; i++) w.addOnce(C.FieldTypeUnknown, 'x', 1);
    w.addOnce(C.FieldTypeUnknown, 'x', 2);
    w.addOnce(C.RecordLimit, 'y');
    w.addOnce(C.RecordLimit, 'y');
    expect(w.list()).toHaveLength(3);
  });

  it('list returns copies', () => {
    const w = makeWarningCollector();
    w.add(C.RecordLimit, 'y');
    w.list()[0]!.message = 'changed';
    expect(w.list()[0]!.message).toBe('y');
  });
});

describe('guard', () => {
  it('accepts Uint8Array and Buffer, rejects others', () => {
    expect(() => assertUint8Array(new Uint8Array(1))).not.toThrow();
    expect(() => assertUint8Array(Buffer.from([1]))).not.toThrow();
    for (const bad of [new ArrayBuffer(1), new DataView(new ArrayBuffer(1)), [1], 'a', null]) {
      expect(() => assertUint8Array(bad)).toThrow(
        new TypeError('invalid input type: expected Uint8Array'),
      );
    }
  });

  it('rejects undefined and numbers with the exact message', () => {
    for (const bad of [undefined, 42]) {
      expect(() => assertUint8Array(bad)).toThrow(
        new TypeError('invalid input type: expected Uint8Array'),
      );
    }
  });

  it('limitInput truncates with one warning', () => {
    const w = makeWarningCollector();
    const big = new Uint8Array(MAX_CONVERT_INPUT_BYTES + 1);
    expect(limitInput(big, w).length).toBe(MAX_CONVERT_INPUT_BYTES);
    expect(w.list()).toEqual([
      { code: C.InputTruncated, message: 'input truncated to 4194304 bytes (MAX_CONVERT_INPUT_BYTES)' },
    ]);
    const w2 = makeWarningCollector();
    limitInput(new Uint8Array(MAX_CONVERT_INPUT_BYTES), w2);
    expect(w2.list()).toHaveLength(0);
  });

  it('guarded turns a throw into errInternal and keeps warnings', () => {
    const w = makeWarningCollector();
    w.add(C.RecordLimit, 'y');
    const r = guarded(() => {
      throw new RangeError('boom');
    }, w);
    expect(r).toEqual({
      ok: false,
      error: 'conversion failed',
      warnings: [{ code: C.RecordLimit, message: 'y' }],
    });
  });

  it('guarded passes through normal results', () => {
    const w = makeWarningCollector();
    const r = guarded(() => okResult('a', 'text/csv', '.csv', w), w);
    expect(r).toEqual({ ok: true, output: 'a', mime: 'text/csv', extension: '.csv', warnings: [] });
    expect(failResult('e', w)).toEqual({ ok: false, error: 'e', warnings: [] });
  });
});
