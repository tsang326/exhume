// Input guards and the last-resort wrapper for converter bodies.

import { MAX_CONVERT_INPUT_BYTES } from './limits';
import { failResult } from './result';
import { TEMPLATES, fill } from './templates';
import { ConversionWarningCode } from './types';
import type { ConversionFailure } from './types';
import type { WarningCollector } from './warnings';

/** Same check as fat12 openDisk: accepts Buffer and cross-realm arrays, rejects the rest. */
export function assertUint8Array(x: unknown): asserts x is Uint8Array {
  if (Object.prototype.toString.call(x) !== '[object Uint8Array]') {
    throw new TypeError('invalid input type: expected Uint8Array');
  }
}

/** Cuts input to MAX_CONVERT_INPUT_BYTES and adds one input-truncated warning when longer. */
export function limitInput(input: Uint8Array, w: WarningCollector): Uint8Array {
  if (input.length <= MAX_CONVERT_INPUT_BYTES) return input;
  w.add(
    ConversionWarningCode.InputTruncated,
    fill(TEMPLATES.inputTruncated, MAX_CONVERT_INPUT_BYTES),
  );
  return input.subarray(0, MAX_CONVERT_INPUT_BYTES);
}

/** Runs fn; an unexpected throw becomes a failure result that keeps earlier warnings. */
export function guarded<T>(fn: () => T, w: WarningCollector): T | ConversionFailure {
  try {
    return fn();
  } catch {
    return failResult(TEMPLATES.errInternal, w);
  }
}
