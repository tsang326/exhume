import { MAX_REASON_CHARS } from './limits';
import { WarningCode } from './types';
import type { Warning } from './types';

/** Clamp a reason or message to MAX_REASON_CHARS characters. */
export function clampText(text: string, max: number = MAX_REASON_CHARS): string {
  return text.length <= max ? text : text.slice(0, max);
}

export interface WarningSink {
  add(code: WarningCode, message: string, path?: string): void;
  list(): Warning[];
  /** Start a chain walk: only the first warning added until endWalk() is kept. */
  beginWalk(): void;
  endWalk(): void;
}

/** Codes added at most once per scan. */
const ONCE_PER_SCAN: ReadonlySet<WarningCode> = new Set<WarningCode>([
  WarningCode.FatCopiesDiffer,
  WarningCode.MediaMismatch,
  WarningCode.BootSignatureMissing,
  WarningCode.EntryLimit,
]);

export function makeWarningSink(): WarningSink {
  const warnings: Warning[] = [];
  const seenOnce = new Set<WarningCode>();
  let inWalk = false;
  let walkUsed = false;

  return {
    add(code, message, path) {
      if (inWalk) {
        if (walkUsed) return;
        walkUsed = true;
      }
      if (ONCE_PER_SCAN.has(code)) {
        if (seenOnce.has(code)) return;
        seenOnce.add(code);
      }
      const w: Warning = { code, message: clampText(message) };
      if (path !== undefined) w.path = path;
      warnings.push(w);
    },
    list() {
      return warnings.map((w) => ({ ...w }));
    },
    beginWalk() {
      inWalk = true;
      walkUsed = false;
    },
    endWalk() {
      inWalk = false;
      walkUsed = false;
    },
  };
}
