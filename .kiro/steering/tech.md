---
inclusion: always
---
# Tech rules

- Vanilla TypeScript + Vite, DOM + canvas. No UI framework. Strict TypeScript, no `any`.
- Game logic (dialogue state machine, trust/suspicion, beats, endings) is pure, framework-free TypeScript in `src/game/`,
  with no DOM access, so it can be unit- and property-tested.
- UI in `src/ui/`, effects in `src/fx/`, LLM client in `src/ghost/`. One serverless function `api/ghost.ts` on Vercel
  calls the Gemma model (Google AI Studio) with the key from `GEMINI_API_KEY`. The key never reaches the browser.
- Every LLM call has: a timeout, per-IP rate limit, output length cap, and a fallback to scripted lines from
  `src/ghost/fallback/*.json` keyed by game state. With the API off, the whole game must still be playable to an ending.
- Tests: Vitest + fast-check in `src/**/*.test.ts`. State-machine invariants are property-based tests.
- No new runtime dependencies without a reason written in the PR/commit message.
- All audio and art are made in code or are CC0 with the source noted in `docs/CREDITS.md`. No copyrighted music.
