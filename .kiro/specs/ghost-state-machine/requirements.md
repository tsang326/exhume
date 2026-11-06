# Requirements: ghost-state-machine

Pure, framework-free TypeScript game core in `src/game/` (no DOM, no randomness, no clocks).

## R1. State
The `GameState` holds: the current beat (`boot`, `explore`, `beat1`, `beat2`, `beat3`, `escalation`, `ending`),
`trust` and `suspicion` (both in [0,1]), a memory of facts the player revealed, file flags (unlocked / locked),
opened files, solved puzzles, and the ending reached (`free` | `destroy` | `escape` | `null`).

## R2. Events
The reducer `reduce(state, event)` accepts:
- `player_message` with an intent classified by the ghost (`comfort`, `threaten`, `probe`, `deceive`, `neutral`)
  and optional revealed facts.
- `file_opened`, `puzzle_solved`, `puzzle_failed`, `tick`.

## R3. Endings
Exactly three endings, decided deterministically from trust, suspicion and flags:
- `free`: trust high, suspicion low, and `core.sys` unlocked.
- `destroy`: the `purge` puzzle was solved (and not `free`).
- `escape`: everything else.

## R4. Invariants (property-tested with fast-check)
1. Termination: every event sequence reaches an ending within `MAX_STEPS` events.
2. Trust and suspicion always stay in [0,1].
3. No event throws, including malformed events from untrusted input (e.g. LLM output).
4. Serialisable: `deserialize(serialize(s))` equals `s`, and restoring a saved state continues identically.
5. `reduce` is pure (never mutates its input) and an ended game ignores further events.
6. Memory is bounded; file lists stay disjoint; `beat === 'ending'` iff `ending !== null`.

## R5. Robustness
`deserialize` never throws; it returns `null` for invalid or inconsistent saves.
