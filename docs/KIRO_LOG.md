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

## 2026-11-09 — power-workspace (spec 8)
- Reason: the hand checks of 2026-11-07 showed the Power could not work: a legacy install leaves out `server/`, and
  a plugin install runs in its own folder and cannot see the workspace (no `${workspaceFolder}`, no `roots/list`).
- Kiro wrote the spec (Home_Ancestor rule added on review; design researched the Kiro and Agent Plugins docs) and ran
  all tasks: `--workspace-from-agent` launch flag, a per-call `workspace` argument validated in nine steps (segment-wise
  home-ancestor test plus a device/inode identity test for case variants), a `ModeStrategy` in `server.ts` with the
  default tool list kept byte-identical (snapshot test), `plugin.json` + `${PLUGIN_ROOT}` `mcp.json` + a skill, docs.
  1751 tests.
- By hand: restoring `design.md` and `requirements.md` from Kiro's session snapshot after they were reverted mid-review,
  starting the tasks from the task list (the chat session had no file-edit tool), approving `build:mcp` after the
  config-hash check.

## 2026-11-10 — power-exhume tool check
- Kiro used the installed Exhume Power: listed `public/disks/writers-disk.img` and exhumed `/CHAPTER1.WS` to `exhumed/CHAPTER1.md` (2686 bytes). I did not open that file to check its content.
- Safety test: `open_disk` with workspace `/Users/os` returned `PATH_REJECTED`, but the message names the image path, so it is unproven that the home-folder check fired. Earlier, the FreeDOS 720k disk had no text file, so nothing was exhumed from it.
- Helped: the Power's tool docs; no spec or steering file. By hand: nothing.
- Added by hand afterwards: a direct run of the bundle shows the rejection comes from the `workspace` check (with a
  missing image, `/` or the home folder gives `PATH_REJECTED`, an allowed folder gives `IMAGE_NOT_FOUND`). The Power
  installed as an Agent Plugin and shows as `power-exhume`, Connected, 4 tools. `CHAPTER1.md` is readable Markdown.
  Autopilot was on and no approval prompt appeared, so the prompt wording is unverified. README and `POWER.md` record
  the result.

## 2026-11-10 — mcp-root-and-flaky
- I ran the spec's tasks through sub-agents. Blank `--root` is now a start failure, the markdown linear-time test uses a step counter instead of a clock, and WordStar hard returns now give paragraph breaks. I rebuilt the MCP bundle once, with your approval.
- The spec's tasks.md, its design and bugfix docs, and the property-test and mutation-check plan helped. The mutation check caught a gap in my first linear-time test, so I added two input shapes.
- I fixed two unrelated flaky test generators (`exhume.props`, `read-grave.props`) and moved the CHAPTER1 preview test to `src/test/`. Nothing was done by hand.
- Added by hand afterwards: the log hook had no append tool, so this entry was pasted in. By hand during the run:
  stopping two mutation-check drivers that hung for hours (real quadratic loops on a 2M-character input; task 7 now
  asks for counter increments and a `spawnSync` timeout), answering two questions (fix the flaky generator in this
  spec, approve `build:mcp` after re-running the config-hash check). Re-checked after Kiro finished: typecheck,
  `npm test` 1828 passed / 1 skipped, `test:dom` 156/156, `make:demos --check` all match.

## 2026-11-10 — ui-polish
- Kiro ran all the ui-polish tasks through sub-agents: intro, title and repo link, page-tall background, graveyard guidance and reveal, grave state cues, progress line, pressed demo cards, plus their tests.
- The ui-polish spec (requirements, design, tasks) drove the work; the existing contrast, CSP and source-scan tests caught two problems along the way. The sub-agents reworded the underscore hint after the forbidden-phrase scan rejected it.
- Done by hand: task 10.1 (headless Chrome at 1440x900 and 390x844 against the built page). Background, no horizontal
  scroll, pressed card, focus, reduced-motion jump and glow readability passed; the phone demo block went from 562px
  (previous commit) to 339px. One failure: on the phone the Graveyard heading ended 66px above the viewport, because
  the reveal ran before the Cancel button was hidden. I added task 12 for it; Kiro's fix moved `refreshControls()`
  before the reveal and added a DOM test. Kiro's shell returned nothing in that run, so I verified it: the new test
  fails with the old order, the full suite passes (1870 + 181 DOM), and the heading now lands at top 0.

## 2026-11-10 — page-redesign (spec 11, requirements)
- Kiro wrote requirements.md for the page-redesign spec from the Spec 11 brief and the reviewed mockup in `docs/design/redesign/`.
- Helped: the brief's hard rules (CSP, element-contract ids, retired ids) came through as numbered requirements, including removing the canvas effects and the preview dialog.
- By hand: reviewed the requirements and sent seven corrections back (decorative alt on the heading photo, headstones limited to the writer's six files, byte totals that split a partial file 2,048 / 1,024, plain-text event name, a testable motion rule, explicit Tab order, italic font only if used). Kiro is revising and writing design.md next.

## 2026-11-11 — page-redesign (spec 11, design)
- Kiro applied the seven requirement corrections and wrote design.md: static markup for the demo-disk facts (stones, bar figures, excerpts, logo) checked by tests against the committed disks, an inline preview replacing the dialog, CSS-only strata, and twelve correctness properties.
- Helped: the design listed fourteen open questions with trade-offs, which made the review quick; it also caught two mockup colours that fail contrast.
- By hand: answered the open questions and asked for two changes: the auto-opened writer's disk previews CHAPTER1.WS quietly so the first view is not empty, and focus stays on the row on wide layouts. The screenshot pass at three widths stays a manual task for me.

## 2026-11-11 — page-redesign (spec 11, run all tasks)
- Kiro ran the 42 required tasks through sub-agents: new page markup and stylesheet, inline preview replacing the dialog, headstones, auto-open, motion module, demo-facts checks against the committed disks, and the rewritten tests. Effects and focus-trap code were deleted.
- Helped: the property test for superseded requests (task 7.9) failed during the run and Kiro fixed the race before finishing.
- By hand: made four property tests required before the run (disk text never becomes elements, Blob URL count, superseded requests, auto-open). Re-ran the suite myself: typecheck clean, `npm test` 1890 passed / 1 skipped, `test:dom` 222/222, build ok, `make:demos --check` all match, IOC scan clean. Headless Chrome at 1440x900, 768x1024 and 390x844: auto-open shows CHAPTER1.WS with no focus move or scroll, no horizontal scroll. Found five visual problems (grain fell back to section backgrounds over one 4.44:1 pair, headstones overlap at 768 px, back row reads as broken on phones, "Three files" should be four, favicon 404) and sent them back as tasks 10-14.

## 2026-11-11 — page-redesign (spec 11, owner fixes 10-14)
- Kiro fixed the five problems from my screenshot pass: grain overlay restored at 0.22 after darkening the paper accent (worst pair 4.54:1), six stones in one row from 761 to 1180 px, a back row and a front row on phones, "Four files" with a checkBar guard, and an SVG favicon.
- By hand: re-ran everything (typecheck, `npm test` 1899 passed / 1 skipped, `test:dom` 222/222, build, `make:demos --check`, IOC scan clean) and the owner checks in headless Chrome at 1440x900, 768x1024 and 390x844: no horizontal scroll, no console errors, auto-open shows CHAPTER1.WS without focus or scroll, Tab order nav → Open → demo link → six stones → cards → rows → preview → footer, and with reduced motion no animation runs and nothing stays hidden.
