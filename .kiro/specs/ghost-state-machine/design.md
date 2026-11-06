# Design: ghost-state-machine

## Files (`src/game/`)
- `types.ts`: unions, `GameState`, `GameEvent`.
- `config.ts`: tuning constants (beat rules, deltas, puzzle table, caps, `MAX_STEPS`).
- `engine.ts`: `createInitialState`, `reduce`, `resolveEnding`.
- `serialize.ts`: `serialize`, `deserialize` (strict validator, returns `null` on bad input).
- `index.ts`: public exports.
- `game.test.ts`: Vitest + fast-check property tests.

## Termination
Each beat has `{ need, limit }`. Every event adds at least 1 to `beatProgress` or `beatTicks` (events that do
nothing otherwise count as one tick). A beat advances when `beatProgress >= need` or `beatTicks >= limit`, so a
beat lasts at most `need + limit - 1` events. The sum over beats is 50, and a hard cap `MAX_STEPS = 60` forces
an ending regardless.

## Tick rate
A `tick` counts as one step toward `MAX_STEPS`, like any other event. The UI must therefore send ticks rarely
(about one every 30 seconds of idle time), never per frame or per second. Sending them faster would burn through
the step budget and force an ending before the player has had time to play.

## Determinism and save/restore
No randomness or time. State is plain JSON (arrays and primitives only, no maps keyed by user input).
Numbers are rounded to 4 decimals, so JSON round-trips exactly. `deserialize` rebuilds the object from validated
fields only.

## Defensive input
Events are treated as untrusted at runtime: unknown types, unknown intents and bad names degrade to a tick or a
`neutral` intent. Names are normalised (trim, lowercase, 1..40 chars).

## Intent vocabulary
The ghost classifies the player's message as `comfort | threaten | probe | deceive | neutral`. This is separate
from the ghost's own reply intent (`lie | plead | threaten | help`) in `ghost-voice.md`.
