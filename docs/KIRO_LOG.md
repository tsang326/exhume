# Kiro log

Raw notes for the "How we used Kiro" write-up. 2–3 lines per session: what Kiro did, which spec/hook/steering helped,
what had to be fixed by hand. Be honest — the write-up is built from this.

## 2026-11-07 — before Kiro
- Project skeleton prepared outside Kiro: `create-vite` vanilla-ts template, Vitest + fast-check, MIT license,
  `.gitignore`, a placeholder `main.ts`, steering docs and spec briefs. No game code yet. (Disclose in the write-up.)
## 2026-11-07 — ghost-state-machine
- Kiro wrote the spec (requirements/design/tasks) and the pure game core in `src/game/` guided by `tech.md` (pure TS, fast-check).
  Termination is guaranteed by per-beat counters plus a hard `MAX_STEPS` cap; malformed events degrade to a tick.
- One test bug fixed (property callback returned `expect(...)` instead of nothing). Intent vocabulary for player messages
  (`comfort|threaten|probe|deceive|neutral`) is my choice, distinct from the ghost reply intent in `ghost-voice.md`.
## 2026-11-07 — pivot to Possessed?
- Dropped the game after re-reading the rules (impact criterion). The game code Kiro wrote is kept on branch
  `archive/revenant-game`, not used. Steering (`product.md`, `tech.md`, `safety.md`) and `docs/SPEC_BRIEFS.md`
  rewritten by hand outside Kiro for the scanner; all scanner code is to be written in Kiro. (Disclose.)
