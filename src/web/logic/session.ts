// Session transitions on the main thread. Pure: no DOM, no timers, no worker.
// Phases: empty (no disk yet), open (a disk is shown and usable), lost (list kept, reader gone).
import type { DiskReport } from '../../core/fat12/index';
import type { ItemViewModel } from './viewmodel';

export type SessionPhase = 'empty' | 'open' | 'lost';

export interface Session {
  phase: SessionPhase;
  /** The bytes of the last disk that opened; used by Reopen disk. */
  held: Uint8Array | null;
  report: DiskReport | null;
  items: ItemViewModel[];
}

export const CANCELLED_MESSAGE = 'Cancelled. Reopen the disk to continue.';
export const OPENING_MESSAGE = 'Opening the disk.';
export const RISING_MESSAGE = 'Rising';

export function createSession(): Session {
  return { phase: 'empty', held: null, report: null, items: [] };
}

/** A new disk opened: it replaces the report, the items and the held bytes. */
export function applyOpened(
  _session: Session,
  candidate: Uint8Array,
  report: DiskReport,
  items: ItemViewModel[],
): Session {
  return { phase: 'open', held: candidate, report, items };
}

/**
 * The reader was lost (timeout, worker error, cancel). The list stays. Without a held disk there
 * is nothing to reopen, so the phase stays empty.
 */
export function applyLost(session: Session): Session {
  if (session.held === null) return session;
  if (session.phase === 'lost') return session;
  return { ...session, phase: 'lost' };
}

/** An open that failed with a worker error leaves the session as it was. */
export function applyOpenFailed(session: Session): Session {
  return session;
}

/** Exhume actions work only while a disk is open. */
export function canExhume(session: Session): boolean {
  return session.phase === 'open';
}

/** Reopen disk is offered only when the reader is lost and the bytes are still held. */
export function canReopen(session: Session): boolean {
  return session.phase === 'lost' && session.held !== null;
}

/** The bytes to send again for Reopen disk, or null. */
export function reopenBytes(session: Session): Uint8Array | null {
  return canReopen(session) ? session.held : null;
}

/** Exhume controls are enabled exactly when the phase is open. */
export function actionsEnabled(session: Session): boolean {
  return session.phase === 'open';
}
