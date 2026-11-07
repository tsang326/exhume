// Bounded warning collector: at most MAX_WARNINGS stored, then one warnings-capped.

import { MAX_WARNINGS } from './limits';
import { TEMPLATES, fill } from './templates';
import { ConversionWarningCode } from './types';
import type { ConversionWarning } from './types';

export interface WarningCollector {
  /** Adds a warning. After MAX_WARNINGS stored warnings, the first further add stores one
   *  `warnings-capped` warning and every later add is ignored. */
  add(code: ConversionWarningCode, message: string): void;
  /** Adds at most one warning for (code, key). Duplicates do not count toward the cap. */
  addOnce(code: ConversionWarningCode, message: string, key?: number): void;
  /** Copies of the stored warnings; length <= MAX_WARNINGS + 1. */
  list(): ConversionWarning[];
}

export function makeWarningCollector(): WarningCollector {
  const stored: ConversionWarning[] = [];
  const seen = new Set<string>();
  let capped = false;

  function add(code: ConversionWarningCode, message: string): void {
    if (capped) return;
    if (stored.length >= MAX_WARNINGS) {
      capped = true;
      stored.push({
        code: ConversionWarningCode.WarningsCapped,
        message: fill(TEMPLATES.warningsCapped, MAX_WARNINGS),
      });
      return;
    }
    stored.push({ code, message });
  }

  function addOnce(code: ConversionWarningCode, message: string, key?: number): void {
    const id = code + ':' + (key === undefined ? '' : String(key));
    if (seen.has(id)) return;
    seen.add(id);
    add(code, message);
  }

  function list(): ConversionWarning[] {
    return stored.map((w) => ({ code: w.code, message: w.message }));
  }

  return { add, addOnce, list };
}
