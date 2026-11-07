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
## 2026-11-08/09 — graveyard-ui (spec 3)
- Kiro wrote requirements/design/tasks and the whole web page: pure logic in `src/web/logic/`, the worker handler,
  DOM modules built only through a checked `h()` helper (attribute allow-list, owned `blob:` URLs only), strict CSP,
  page shell and styles. 1120 tests + 43 fuzz properties; task 20 added 153 DOM tests under happy-dom (`test:dom`).
- By hand: denied a prettier run, shell edits via sed/python, and a load test that spawned busy loops (asked for a
  median of 5 runs instead); one npx slip that installed nothing. I approved happy-dom 21.0.4 (pinned, dev only).
  Review fixes: blob URL ownership check in `h.ts`, Markdown preview limits written into design as known limitations.
- Kiro found and removed `innerHTML` uses in its own DOM tests (source scans skip test files). Manual browser check
  (task 19: CSP console, 320px layout, keyboard, reduced motion) is still open.
## 2026-11-07 — mcp-server (spec 4)
- Kiro wrote requirements/design/tasks and the whole MCP server in `src/mcp/` (hand-written JSON-RPC 2.0 over stdio,
  no SDK), the Power files in `power/`, the test helpers in `src/test-support/mcp/` and the tests (1324 tests total,
  stdio, stale-build and source-scan tests included). Est. 141 credits for implementation.
- By hand in review: optional `id` in `read_grave`, protocol version negotiation, CSV CR/LF sanitising, Windows refused
  (no `O_NOFOLLOW`), `O_NONBLOCK` reads, in-memory stale-build test, package rename, all property tests required.
- Build: the Vite SSR build dropped `output.banner` (esbuild renderChunk strips comments); I picked Kiro's option of a
  small inline `generateBundle` plugin. Every `build:mcp` run was approved only after checking the config hash.
- Denied: a `sed -i` edit and a heredoc that wrote an unreviewed file to /tmp (Kiro redid both with its edit tool).
  Allowed web fetches of public docs during spec writing. Kiro's permission rule blocked it from writing
  `.kiro/settings/mcp.json`; I created that file by hand with the content from the design (no autoApprove).
