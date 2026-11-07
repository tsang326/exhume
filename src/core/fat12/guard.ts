/**
 * Last-resort guard. This is the documented exception to the "no catch" rule
 * of the reader (the only other try is the finally in walkChain).
 *
 * It is NOT a design path for hostile input: every disk-derived condition must
 * be handled explicitly with a warning. Property tests assert that
 * `internal-error` never appears for any generated image. If it does appear,
 * that is a bug in the reader.
 *
 * The warning message contains only the caller's constant label. The thrown
 * value and its message are never used, since they could carry disk-derived
 * text.
 */
import { WarningCode } from './types';
import type { WarningSink } from './warnings';

export function guarded<T>(label: string, fn: () => T, onError: () => T, sink: WarningSink): T {
  try {
    return fn();
  } catch {
    sink.add(WarningCode.InternalError, `internal error in ${label}`);
    return onError();
  }
}
