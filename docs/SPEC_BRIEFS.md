# Spec briefs — paste each into Kiro (Spec mode) in order

Let Kiro generate `requirements.md` → `design.md` → `tasks.md` under `.kiro/specs/<name>/`, review each step,
then run the tasks. Write 2–3 lines in `docs/KIRO_LOG.md` after every session.

## 1. ghost-state-machine
Build the pure TypeScript game core in `src/game/`: a dialogue/game state machine for REVENANT.OS.
State: current beat (boot, explore, beat1..beat3, escalation, ending), trust and suspicion in [0,1],
a memory of facts the player revealed, flags for files unlocked/locked, and the ending reached.
Events: player message (with a classified intent from the ghost), file opened, puzzle solved/failed, timer tick.
Three endings: free / destroy / escape, decided by trust, suspicion and flags. Must be serialisable for save/restore.
Requirements: every possible event sequence reaches an ending within a bounded number of steps; trust/suspicion always
stay in [0,1]; no event throws; restoring a saved state continues identically. Verify these with fast-check property tests.

## 2. haunted-desktop
Build the UI in `src/ui/` and effects in `src/fx/`: CRT boot sequence, a retro desktop with draggable windows, a file
browser with corrupted files/logs/images that reveal the previous owner's story, and a chat window with the ghost.
The ghost can take visible actions driven by game state: glitch a window, lock a file, rename icons, move the cursor
target, open a fake message. Follow `.kiro/steering/fx-rules.md`. Keyboard accessible; reduced-motion mode.

## 3. ghost-llm
Build `api/ghost.ts` (Vercel serverless) and `src/ghost/` client. The function calls the Gemma model on Google AI Studio
with a system prompt built from `.kiro/steering/ghost-voice.md` plus current game state and remembered facts, returns the
validated JSON line. Add timeout (6s), per-IP rate limit, max output length, and a scripted fallback per game state in
`src/ghost/fallback/*.json` used whenever the API fails, times out, is rate-limited or returns invalid JSON.
The full game must be playable to every ending with the API disabled. Property test: the client always returns a valid line.

## Hooks to create in Kiro (Agent Hooks panel)
- On save of `src/**/*.ts`: run `npm test` and fix failures.
- On save of `src/ghost/fallback/*.json`: validate every game state has at least 3 fallback lines.
- On save of `.kiro/specs/**/tasks.md`: append a one-line summary of what changed to `docs/KIRO_LOG.md`.
