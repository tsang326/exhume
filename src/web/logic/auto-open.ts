// Gates for the quiet Auto_Open (pure, no DOM). The user always wins (7.5, 7.8, 8.14).
import type { SessionPhase } from './session';

/** Step 1: may the quietly loaded Writer_Disk be applied? Tokens are openToken values. */
export interface AutoOpenInput {
  phase: SessionPhase;
  intentSeen: boolean;
  tokenAtStart: number;
  tokenNow: number;
}

export function mayApplyAutoOpen(i: AutoOpenInput): boolean {
  return i.phase === 'empty' && !i.intentSeen && i.tokenNow === i.tokenAtStart;
}

/** Step 2: may the quiet CHAPTER1.WS preview be applied? */
export interface AutoPreviewInput {
  phase: SessionPhase;
  intentSeen: boolean;
  /** The displayed disk is the one step 1 applied (its openToken is unchanged). */
  shownDiskIsAuto: boolean;
  exhumeTokenAtStart: number;
  exhumeTokenNow: number;
}

export function mayApplyAutoPreview(i: AutoPreviewInput): boolean {
  return (
    i.phase === 'open' &&
    i.shownDiskIsAuto &&
    !i.intentSeen &&
    i.exhumeTokenNow === i.exhumeTokenAtStart
  );
}
