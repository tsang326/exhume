import type { Beat, PlayerIntent } from './types.ts'

/** Hard cap on events. Reaching it forces an ending. */
export const MAX_STEPS = 60

/** A beat ends when progress >= need or ticks >= limit. Every event adds at least 1 to one of them. */
export const BEAT_RULES: Record<Exclude<Beat, 'ending'>, { need: number; limit: number }> = {
  boot: { need: 1, limit: 1 },
  explore: { need: 3, limit: 6 },
  beat1: { need: 3, limit: 6 },
  beat2: { need: 4, limit: 8 },
  beat3: { need: 4, limit: 8 },
  escalation: { need: 4, limit: 8 },
}

export const MEMORY_CAP = 16
export const LIST_CAP = 32
export const FACTS_PER_MESSAGE = 4
export const NAME_MAX_LENGTH = 40

export const INITIAL_TRUST = 0.3
export const INITIAL_SUSPICION = 0.2

export const INITIAL_UNLOCKED: readonly string[] = ['readme.txt']
export const INITIAL_LOCKED: readonly string[] = ['diary.log', 'core.sys', 'purge.exe']

export const CORE_FILE = 'core.sys'
export const PURGE_PUZZLE = 'purge'

interface Delta {
  trust: number
  suspicion: number
}

export const INTENT_DELTAS: Record<PlayerIntent, Delta> = {
  comfort: { trust: 0.12, suspicion: -0.05 },
  threaten: { trust: -0.15, suspicion: 0.15 },
  probe: { trust: -0.02, suspicion: 0.08 },
  deceive: { trust: -0.05, suspicion: 0.1 },
  neutral: { trust: 0.01, suspicion: 0 },
}

export const NEW_FACT_DELTA: Delta = { trust: 0.02, suspicion: 0 }
export const OPEN_FILE_DELTA: Delta = { trust: 0.02, suspicion: 0 }
export const LOCKED_FILE_DELTA: Delta = { trust: -0.03, suspicion: 0.1 }
export const PUZZLE_FAILED_DELTA: Delta = { trust: -0.03, suspicion: 0.05 }
export const UNKNOWN_PUZZLE_DELTA: Delta = { trust: 0.03, suspicion: 0 }

/** Known puzzles: the file they unlock (or relock on failure) and the effect of solving them. */
export const PUZZLES: ReadonlyMap<string, { file: string } & Delta> = new Map([
  ['terminal', { file: 'diary.log', trust: 0.05, suspicion: 0 }],
  ['passcode', { file: CORE_FILE, trust: 0.05, suspicion: 0 }],
  [PURGE_PUZZLE, { file: 'purge.exe', trust: -0.2, suspicion: 0.2 }],
])

export const FREE_MIN_TRUST = 0.65
export const FREE_MAX_SUSPICION = 0.4
