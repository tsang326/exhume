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
## 2026-11-07 — mcp-server, manual check in Kiro
- I verified by hand in Kiro: the committed workspace `.kiro/settings/mcp.json` connects `exhume` with 4 tools (reload window
  if added while open). The Power does not work yet: Kiro copies only POWER.md, mcp.json and steering/, not `server/`, so
  "Connection Failed". Agent Plugins format copies `server/`, but runs it with the install folder as working directory.
- Kiro then updated README, POWER.md and this log; a sub-agent also edited the spec's requirements.md (verified Kiro results,
  decision 8, Requirement 14/15/17 wording) and the tasks.md status was updated; no source code or tests changed. Steering use in chat is unverified.
## 2026-11-07 — demo-disks (spec 5)
- Kiro wrote requirements/design/tasks and the generator: pure core in `src/demo-disks/`, a Node shell in
  `scripts/make-demo-disks.ts`, shared checks that run on the images in memory before any file is written. Three disks:
  WRITER DEMO, OFFICE DEMO, DAMAGE DEMO (1430 tests). Est. ~129 credits.
- By hand: I ran `npm run make:demos` once and committed `public/disks/`; picked "DAMAGE DEMO" because the 12-char label
  did not fit FAT's 11 bytes. Denied a python heredoc edit (Kiro redid it with its edit tool).
- Lost once: I sent a chat message while a "Review changes" box was open and requirements.md vanished; restored it from the
  transcript. Since then: accept or reject pending changes before sending anything.
## 2026-11-07 — plain-text (spec 6, small follow-up)
- Reason: README.TXT on every demo disk opened as "no converter" plus a hex dump, the first thing a judge would click.
- Kiro wrote the spec (7 requirements, 17 properties) and a fourth converter: CP437 text to `.txt`, detected by extension
  or as an all-printable sample, wired through the web preview, the worker protocol, MCP `read_grave`/`exhume` and the
  demo-disk checks. 1537 tests, 156 DOM tests. Est. ~140 credits.
- By hand: I ran `npm run build:mcp` after checking the config hash; denied four shell edits (`sed -i`, python) and Kiro
  redid them with its edit tool. The text sink was extended in place (WordStar output proven unchanged by its old tests).
## 2026-11-07 — agent hooks
- Kiro created three hooks in `.kiro/hooks/`: related tests on save (`PostFileSave`), fuzz after core task (`PostTaskExec`,
  only when `src/core` changed) and this session log (`Stop`, agent prompt). Nothing was run; JSON was only read back.
- Helped: the `createHook` schema (trigger names checked, `PostTaskExec` exists so no file-save fallback); no spec or steering file.
- By hand: nothing yet. The self-trigger guard of the log hook is prompt-only and still unverified.
## 2026-11-09 — real-disk-hardening (spec 7)
- Reason: on 35 real DOS disks (24 FreeDOS 1.3, 11 PCjs) the reader matched independent references on all 942 files,
  but 197 files rose as fake WordStar, 641 never-used directory slots showed as graves and zero dates raised warnings.
- Kiro wrote the spec (11 requirements, 12 properties, 10 task groups) and the fixes: WordStar gate (MZ veto, NUL and
  odd-byte budgets) plus a known-binary-extension veto, never-used `E5 F6…`/`E5 00…` slots skipped, zero date = no
  date, soft hyphen join and soft space padding; writer `slots`, a golden test, `realdisks.test.ts` on three committed
  FreeDOS fixtures graded against a macOS-mount manifest, an opt-in local corpus test. 1626 tests.
- Afterwards on the 35 disks: WordStar detections 197 → 11 (10 real WordStar documents and one Intel HEX text file),
  phantom graves 641 → 0, `date-invalid` warnings → 0.
- By hand: the fixtures and their manifest, measuring the WordStar thresholds on the 35 disks before implementation,
  approving `build:mcp` after the config-hash check. Optional property tasks and item 5 (deleted long names) were skipped.
