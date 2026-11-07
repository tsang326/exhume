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
## 2026-11-07 — pivot to Exhume
- Possessed? dropped before any code (overlapped an earlier project of mine). New topic: Exhume (FAT12 floppy
  graveyard + undelete + WordStar/dBase/PCX resurrection, MCP/Power, Crew app). Steering and briefs rewritten by hand
  outside Kiro; all application code is to be written in Kiro. (Disclose.)
## 2026-11-07 — fat12-core (spec 1)
- Kiro wrote requirements/design/tasks and all of `src/core/fat12/` plus the test-only image writer in Spec mode, task by
  task with review between phases. 18 task groups, 323 tests, hostile-input suite under `test:fuzz`.
- Review changes requested by hand: named limits, warnings instead of throws, explicit-stack directory walk.
## 2026-11-07/08 — format-resurrection (spec 2)
- Kiro wrote WordStar→Markdown, dBase→CSV (formula guard), PCX→PNG (own stored-deflate encoder, CRC/Adler) and the
  test-only writers/oracles. 803 tests + fuzz suite. Kiro ran parallel sub-agents per task wave.
- By hand: tightened image memory limits in requirements before design (4 Mpx, 16 MiB decoded, exact max PNG size);
  denied two shell commands I could not read in full; sub-agents sometimes wrote files via heredoc despite instructions.
