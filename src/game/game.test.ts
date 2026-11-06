import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  BEATS,
  BEAT_RULES,
  MAX_STEPS,
  PLAYER_INTENTS,
  createInitialState,
  deserialize,
  reduce,
  serialize,
} from './index.ts'
import type { GameEvent, GameState } from './index.ts'

const names = fc.oneof(
  fc.constantFrom('readme.txt', 'diary.log', 'core.sys', 'purge.exe', 'terminal', 'passcode', 'purge', 'x'),
  fc.string(),
)

const eventArb: fc.Arbitrary<GameEvent> = fc.oneof(
  fc.record({
    type: fc.constant('player_message' as const),
    intent: fc.constantFrom(...PLAYER_INTENTS),
    facts: fc.option(fc.array(names, { maxLength: 6 }), { nil: undefined }),
  }),
  fc.record({ type: fc.constant('file_opened' as const), file: names }),
  fc.record({ type: fc.constant('puzzle_solved' as const), puzzle: names }),
  fc.record({ type: fc.constant('puzzle_failed' as const), puzzle: names }),
  fc.constant({ type: 'tick' as const }),
)

const eventsArb = fc.array(eventArb, { maxLength: MAX_STEPS + 20 })

function run(events: readonly GameEvent[], from: GameState = createInitialState()): GameState {
  return events.reduce(reduce, from)
}

function assertInvariants(s: GameState): void {
  expect(s.trust).toBeGreaterThanOrEqual(0)
  expect(s.trust).toBeLessThanOrEqual(1)
  expect(s.suspicion).toBeGreaterThanOrEqual(0)
  expect(s.suspicion).toBeLessThanOrEqual(1)
  expect(s.memory.length).toBeLessThanOrEqual(16)
  expect(s.unlocked.some((f) => s.locked.includes(f))).toBe(false)
  expect(s.beat === 'ending').toBe(s.ending !== null)
  // Every valid state must survive a save/load round trip.
  expect(deserialize(serialize(s))).toEqual(s)
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null) {
    Object.values(value).forEach(deepFreeze)
    Object.freeze(value)
  }
  return value
}

describe('config', () => {
  it('natural per-beat bound fits under MAX_STEPS', () => {
    const bound = Object.values(BEAT_RULES).reduce((n, r) => n + r.need + r.limit - 1, 0)
    expect(bound).toBeLessThanOrEqual(MAX_STEPS)
  })
})

describe('termination', () => {
  it('any sequence of MAX_STEPS events reaches an ending', () => {
    fc.assert(
      fc.property(fc.array(eventArb, { minLength: MAX_STEPS, maxLength: MAX_STEPS }), (events) => {
        const s = run(events)
        expect(s.beat).toBe('ending')
        expect(s.ending).not.toBeNull()
      }),
    )
  })

  it('an ended game ignores further events', () => {
    fc.assert(
      fc.property(eventsArb, eventsArb, (a, b) => {
        const ended = run([...a, ...Array.from({ length: MAX_STEPS }, () => ({ type: 'tick' as const }))])
        expect(run(b, ended)).toBe(ended)
      }),
    )
  })

  it('ticks alone reach an ending', () => {
    const s = run(Array.from({ length: MAX_STEPS }, () => ({ type: 'tick' as const })))
    expect(s.ending).toBe('escape')
  })
})

describe('invariants', () => {
  it('trust and suspicion stay in [0,1] and state stays consistent at every step', () => {
    fc.assert(
      fc.property(eventsArb, (events) => {
        let s = createInitialState()
        let lastBeat = 0
        for (const e of events) {
          const next = reduce(s, e)
          assertInvariants(next)
          const idx = BEATS.indexOf(next.beat)
          expect(idx).toBeGreaterThanOrEqual(lastBeat)
          lastBeat = idx
          s = next
        }
      }),
    )
  })

  it('reduce does not mutate its input', () => {
    fc.assert(
      fc.property(eventsArb, eventArb, (events, e) => {
        const s = deepFreeze(run(events))
        const before = serialize(s)
        reduce(s, e)
        expect(serialize(s)).toBe(before)
      }),
    )
  })
})

describe('robustness', () => {
  it('never throws on arbitrary (malformed) events and keeps a valid state', () => {
    fc.assert(
      fc.property(fc.array(fc.anything(), { maxLength: 80 }), (junk) => {
        let s = createInitialState()
        for (const e of junk) {
          s = reduce(s, e as GameEvent)
          assertInvariants(s)
        }
      }),
    )
  })

  it('never throws on malformed fields of otherwise known events', () => {
    const weird = fc.anything()
    const eventLike = fc.record({
      type: fc.constantFrom('player_message', 'file_opened', 'puzzle_solved', 'puzzle_failed', 'tick'),
      intent: weird,
      facts: weird,
      file: weird,
      puzzle: weird,
    })
    fc.assert(
      fc.property(fc.array(eventLike, { maxLength: 80 }), (events) => {
        let s = createInitialState()
        for (const e of events) {
          s = reduce(s, e as unknown as GameEvent)
          assertInvariants(s)
        }
      }),
    )
  })

  it('deserialize never throws and rejects garbage', () => {
    fc.assert(fc.property(fc.string(), (str) => void deserialize(str)))
    fc.assert(fc.property(fc.json(), (str) => void deserialize(str)))
    expect(deserialize('null')).toBeNull()
    expect(deserialize('{"version":2}')).toBeNull()
  })

  it('deserialize rejects inconsistent saves', () => {
    const s = createInitialState()
    expect(deserialize(JSON.stringify({ ...s, trust: 2 }))).toBeNull()
    expect(deserialize(JSON.stringify({ ...s, beat: 'ending' }))).toBeNull()
    expect(deserialize(JSON.stringify({ ...s, ending: 'free' }))).toBeNull()
    expect(deserialize(JSON.stringify({ ...s, locked: ['readme.txt'] }))).toBeNull()
  })
})

describe('save/restore', () => {
  it('restoring a saved state continues identically', () => {
    fc.assert(
      fc.property(eventsArb, eventsArb, (before, after) => {
        const live = run(before)
        const restored = deserialize(serialize(live))
        expect(restored).toEqual(live)
        const a = run(after, live)
        const b = run(after, restored as GameState)
        expect(b).toEqual(a)
        expect(serialize(b)).toBe(serialize(a))
      }),
    )
  })

  it('is deterministic', () => {
    fc.assert(
      fc.property(eventsArb, (events) => {
        expect(run(events)).toEqual(run(events))
      }),
    )
  })
})

describe('endings', () => {
  const ticks = Array.from({ length: MAX_STEPS }, () => ({ type: 'tick' as const }))
  const comfort: GameEvent = { type: 'player_message', intent: 'comfort', facts: ['my name is sam'] }

  it('free: kindness plus the core unlocked', () => {
    const s = run([{ type: 'puzzle_solved', puzzle: 'passcode' }, comfort, comfort, comfort, comfort, ...ticks])
    expect(s.ending).toBe('free')
  })

  it('destroy: the purge puzzle was solved', () => {
    const s = run([{ type: 'puzzle_solved', puzzle: 'purge' }, ...ticks])
    expect(s.ending).toBe('destroy')
  })

  it('escape: hostility without purging', () => {
    const threat: GameEvent = { type: 'player_message', intent: 'threaten' }
    const s = run([threat, threat, ...ticks])
    expect(s.ending).toBe('escape')
  })

  it('kindness without unlocking the core does not free the ghost', () => {
    const s = run([comfort, comfort, comfort, comfort, ...ticks])
    expect(s.ending).toBe('escape')
  })

  it('random play always yields one of the three endings', () => {
    fc.assert(
      fc.property(eventsArb, (events) => {
        const s = run([...events, ...ticks])
        expect(['free', 'destroy', 'escape']).toContain(s.ending)
      }),
    )
  })

  it('memory remembers revealed facts once, normalised', () => {
    const s = run([
      { type: 'player_message', intent: 'neutral', facts: ['  Sam ', 'sam', 'dog'] },
    ])
    expect(s.memory.map((f) => f.key)).toEqual(['sam', 'dog'])
  })
})
