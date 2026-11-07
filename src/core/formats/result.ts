// Result constructors.

import type {
  ConversionFailure,
  ConversionSuccess,
  OutputExtension,
  OutputMime,
} from './types';
import type { WarningCollector } from './warnings';

export function okResult<
  O extends string | Uint8Array,
  M extends OutputMime,
  E extends OutputExtension,
>(output: O, mime: M, extension: E, w: WarningCollector): ConversionSuccess<O, M, E> {
  return { ok: true, output, mime, extension, warnings: w.list() };
}

export function failResult(error: string, w: WarningCollector): ConversionFailure {
  return { ok: false, error, warnings: w.list() };
}
