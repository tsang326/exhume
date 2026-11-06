import {
  BEAT_RULES,
  CORE_FILE,
  FACTS_PER_MESSAGE,
  FREE_MAX_SUSPICION,
  FREE_MIN_TRUST,
  INITIAL_LOCKED,
  INITIAL_SUSPICION,
  INITIAL_TRUST,
  INITIAL_UNLOCKED,
  INTENT_DELTAS,
  LIST_CAP,
  LOCKED_FILE_DELTA,
  MAX_STEPS,
  MEMORY_CAP,
  NEW_FACT_DELTA,
  OPEN_FILE_DELTA,
  PUZZLES,
  PUZZLE_FAILED_DELTA,
  PURGE_PUZZLE,
  UNKNOWN_PUZZLE_DELTA,
} from './config.ts'
import { clamp01, normalizeName } from './normalize.ts'
import { BEATS, PLAYER_INTENTS } from './types.ts'
import type { Ending, GameEvent, GameState, PlayerIntent } from './types.ts'

export function createInitialState(): GameState {
  return {
    version: 1,
    step: 0,
    beat: 'boot',
    beatProgress: 0,
    beatTicks: 0,
    trust: INITIAL_TRUST,
    suspicion: INITIAL_SUSPICION,
    memory: [],
    unlocked: [...INITIAL_UNLOCKED],
    locked: [...INITIAL_LOCKED],
    opened: [],
    solved: [],
    ending: null,
  }
}

/** Decides the ending from trust, suspicion and flags. Total and deterministic. */
export function resolveEnding(state: GameState): Ending {
  if (
    state.trust >= FREE_MIN_TRUST &&
    state.suspicion <= FREE_MAX_SUSPICION &&
    state.unlocked.includes(CORE_FILE)
  ) {
    return 'free'
  }
  if (state.solved.includes(PURGE_PUZZLE)) return 'destroy'
  return 'escape'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function applyDelta(s: GameState, d: { trust: number; suspicion: number }): void {
  s.trust = clamp01(s.trust + d.trust)
  s.suspicion = clamp01(s.suspicion + d.suspicion)
}

function remember(s: GameState, rawFacts: unknown): void {
  if (!Array.isArray(rawFacts)) return
  for (const raw of rawFacts.slice(0, FACTS_PER_MESSAGE)) {
    const key = normalizeName(raw)
    if (key === null || s.memory.some((f) => f.key === key)) continue
    s.memory.push({ key, beat: s.beat, step: s.step })
    if (s.memory.length > MEMORY_CAP) s.memory.shift()
    applyDelta(s, NEW_FACT_DELTA)
  }
}

function pushCapped(list: string[], value: string): void {
  if (list.length < LIST_CAP && !list.includes(value)) list.push(value)
}

function remove(list: string[], value: string): void {
  const i = list.indexOf(value)
  if (i >= 0) list.splice(i, 1)
}

/**
 * Applies one event to a draft state. Returns the progress made (0 = none).
 * Tolerates malformed events: they simply make no progress and count as a tick.
 */
function applyEvent(s: GameState, event: unknown): { progress: number; ticks: number } {
  if (!isRecord(event)) return { progress: 0, ticks: 0 }
  switch (event.type) {
    case 'player_message': {
      const intent: PlayerIntent = (PLAYER_INTENTS as readonly unknown[]).includes(event.intent)
        ? (event.intent as PlayerIntent)
        : 'neutral'
      applyDelta(s, INTENT_DELTAS[intent])
      remember(s, event.facts)
      return { progress: 1, ticks: 0 }
    }
    case 'file_opened': {
      const file = normalizeName(event.file)
      if (file === null) return { progress: 0, ticks: 0 }
      if (s.locked.includes(file)) {
        applyDelta(s, LOCKED_FILE_DELTA)
        return { progress: 0, ticks: 0 }
      }
      if (s.unlocked.includes(file) && !s.opened.includes(file)) {
        pushCapped(s.opened, file)
        applyDelta(s, OPEN_FILE_DELTA)
        return { progress: 1, ticks: 0 }
      }
      return { progress: 0, ticks: 0 }
    }
    case 'puzzle_solved': {
      const puzzle = normalizeName(event.puzzle)
      if (puzzle === null || s.solved.includes(puzzle)) return { progress: 0, ticks: 0 }
      pushCapped(s.solved, puzzle)
      const known = PUZZLES.get(puzzle)
      if (known === undefined) {
        applyDelta(s, UNKNOWN_PUZZLE_DELTA)
      } else {
        remove(s.locked, known.file)
        pushCapped(s.unlocked, known.file)
        applyDelta(s, known)
      }
      return { progress: 2, ticks: 0 }
    }
    case 'puzzle_failed': {
      const puzzle = normalizeName(event.puzzle)
      if (puzzle === null) return { progress: 0, ticks: 0 }
      applyDelta(s, PUZZLE_FAILED_DELTA)
      const known = PUZZLES.get(puzzle)
      // The ghost re-locks the file, unless the puzzle was already solved.
      if (known !== undefined && !s.solved.includes(puzzle) && s.unlocked.includes(known.file)) {
        remove(s.unlocked, known.file)
        pushCapped(s.locked, known.file)
      }
      return { progress: 1, ticks: 0 }
    }
    case 'tick':
      return { progress: 0, ticks: 1 }
    default:
      return { progress: 0, ticks: 0 }
  }
}

/**
 * Pure transition function. Never throws and never mutates its input.
 * Events after the ending are ignored.
 */
export function reduce(state: GameState, event: GameEvent): GameState {
  if (state.ending !== null) return state

  const s: GameState = {
    ...state,
    memory: state.memory.map((f) => ({ ...f })),
    unlocked: [...state.unlocked],
    locked: [...state.locked],
    opened: [...state.opened],
    solved: [...state.solved],
  }
  s.step += 1

  const result = applyEvent(s, event)
  // Termination guarantee: every event moves at least one of the two counters.
  const ticks = result.progress === 0 && result.ticks === 0 ? 1 : result.ticks
  s.beatProgress += result.progress
  s.beatTicks += ticks

  if (s.beat === 'ending') return s // unreachable for valid states
  const rule = BEAT_RULES[s.beat]
  const exhausted = s.step >= MAX_STEPS
  if (exhausted || s.beatProgress >= rule.need || s.beatTicks >= rule.limit) {
    const next = BEATS[BEATS.indexOf(s.beat) + 1]
    s.beatProgress = 0
    s.beatTicks = 0
    if (exhausted || next === 'ending') {
      s.beat = 'ending'
      s.ending = resolveEnding(s)
    } else {
      s.beat = next
    }
  }
  return s
}
