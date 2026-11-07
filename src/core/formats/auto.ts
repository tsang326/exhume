import { convertDBase } from './dbase';
import { detectFormat } from './detect';
import { assertUint8Array } from './guard';
import { convertPcx } from './pcx';
import { TEMPLATES } from './templates';
import type { ConversionResult } from './types';
import { convertWordStar } from './wordstar';

/** Detects the format, then runs the matching converter. */
export function convertAuto(input: Uint8Array, fileName?: unknown): ConversionResult {
  assertUint8Array(input);
  const { format } = detectFormat(input, fileName);
  switch (format) {
    case 'wordstar':
      return convertWordStar(input);
    case 'dbase':
      return convertDBase(input);
    case 'pcx':
      return convertPcx(input);
    default:
      return { ok: false, error: TEMPLATES.errNoConverter, warnings: [] };
  }
}
