import { LIST_CAP, MAX_STEPS, MEMORY_CAP } from './config.ts'
import { normalizeName } from './normalize.ts'
import { BEATS, ENDINGS } from './types.ts'
import type { Beat, Ending, Fact, GameState } from './types.ts'

export function serialize(state: GameState): string {
  return JSON.stringify(state)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCount(value: unknown, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max
}

function isUnit(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1
}

function isBeat(value: unknown): value is Beat {
  return (BEATS as readonly unknown[]).includes(value)
}

function isEnding(value: unknown): value is Ending {
  return (ENDINGS as readonly unknown[]).includes(value)
}

/** A list of unique, already-normalised names within the cap, or null. */
function nameList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > LIST_CAP) return null
  const out: string[] = []
  for (const item of value) {
    const name = normalizeName(item)
    if (name === null || name !== item || out.includes(name)) return null
    out.push(name)
  }
  return out
}

function factList(value: unknown): Fact[] | null {
  if (!Array.isArray(value) || value.length > MEMORY_CAP) return null
  const out: Fact[] = []
  for (const item of value) {
    if (!isRecord(item)) return null
    const key = normalizeName(item.key)
    if (key === null || key !== item.key || !isBeat(item.beat) || !isCount(item.step, MAX_STEPS)) return null
    if (out.some((f) => f.key === key)) return null
    out.push({ key, beat: item.beat, step: item.step })
  }
  return out
}

/** Parses and validates a saved game. Never throws; returns null if the save is invalid. */
export function deserialize(json: string): GameState | null {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return null
  }
  if (!isRecord(raw) || raw.version !== 1) return null

  const { step, beat, beatProgress, beatTicks, trust, suspicion, ending } = raw
  const memory = factList(raw.memory)
  const unlocked = nameList(raw.unlocked)
  const locked = nameList(raw.locked)
  const opened = nameList(raw.opened)
  const solved = nameList(raw.solved)

  if (!isCount(step, MAX_STEPS) || !isBeat(beat)) return null
  if (!isCount(beatProgress, 1000) || !isCount(beatTicks, 1000)) return null
  if (!isUnit(trust) || !isUnit(suspicion)) return null
  if (memory === null || unlocked === null || locked === null || opened === null || solved === null) return null
  if (unlocked.some((f) => locked.includes(f))) return null
  if (ending !== null && !isEnding(ending)) return null
  if ((beat === 'ending') !== (ending !== null)) return null

  return {
    version: 1,
    step,
    beat,
    beatProgress,
    beatTicks,
    trust,
    suspicion,
    memory,
    unlocked,
    locked,
    opened,
    solved,
    ending: ending as Ending | null,
  }
}
