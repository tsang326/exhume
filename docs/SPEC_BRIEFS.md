# Spec briefs (paste into Kiro, one spec at a time)

Kiro writes requirements/design/tasks and the code. These briefs only state intent and constraints.
Steering (`product.md`, `tech.md`, `safety.md`) applies to all of them.

## Spec 1 — detector-core
Build `src/core/`: the pure detector engine.
- Input: a list of `{ path, bytes }` plus optional repo metadata; output: `Finding[]` (shape in `tech.md`) and a
  verdict (`clean | suspicious | possessed`).
- Detectors (one module each, a shared registry):
  1. **mismatched-bytes** — known binary extensions (fonts, images, archives, wasm) checked against their magic bytes;
     text/script content in a binary extension is high severity. Unknown extensions are ignored.
  2. **autorun-task** — editor task configs (VS Code tasks file under `.vscode/`, and similar) with a task set to run
     when the folder opens; severity high, higher if the command invokes a runtime on a non-code file.
     Must parse JSON-with-comments safely.
  3. **appended-config** — for build configs (`vite|webpack|rollup|next|nuxt|eslint|tailwind|postcss` config files),
     find the end of the last top-level statement; any non-whitespace, non-comment code after it is flagged.
     Use a small tokenizer that understands strings, template literals and comments; no full JS parser.
  4. **lifecycle-scripts** — package.json install lifecycle hooks; medium by default, high when they call a
     runtime on a non-code file, fetch from the network, or decode data.
  5. **obfuscation** — very long lines, high-entropy string literals, dynamic-code construction signals.
     Low/medium only, never high on its own.
- `src/core/tokens.ts` assembles sensitive tokens at runtime (see `safety.md`).
- PBT (fast-check) for each detector, both directions. Examples:
  real WOFF2/PNG/ZIP magic + random tail is never flagged; random printable text under a font extension is always
  flagged; any config with payload after the final statement is flagged, wherever comments/whitespace are inserted;
  clean configs with strings that *contain* `});` are not flagged; the engine never throws on random bytes.
- Acceptance: `npm test` green; a test that runs the engine over a snapshot of a real clean repo tree (stored as
  a small JSON of paths + hashes, no contents) yields zero high findings.

## Spec 2 — github-fetch
Build `src/fetch/`: read a public repo without cloning.
- Parse GitHub URLs (repo, branch, subpath, PR head). Get the tree (recursive) via the REST API, pick only the files
  detectors care about (by path rules from the detector registry), fetch them from raw.githubusercontent.com.
- Caps: file size, file count, request budget; partial results are marked partial. Handles 403/429 rate limits with
  a clear error carrying the reset time. Optional token held in memory only.
- `fetch` is injected; tests use a fake. PBT: URL parser round-trips; budget is never exceeded for random trees.

## Spec 3 — unmasking-ui (the costume)
Build `src/web/`: the haunted scanner page.
- Flow: URL input → "summoning" while fetching (progress per file) → result.
- Each finding is a "costume card": the file as it pretends to be (icon/name/claimed type), then an unmasking
  animation reveals the real bytes (hex/text view, offending lines highlighted). Clean result: calm, short.
- Effects code-drawn (CSS/canvas): flicker, fog, a mask peeling off. Translucent, never blocking the text.
  `prefers-reduced-motion` turns the theatre off. Keyboard accessible. Works on mobile width.
- Scanned text via `textContent` only (`safety.md`).
- Demo buttons: a known-clean repo and our inert bait repo (spec 5).

## Spec 4 — mcp-server + Kiro Power
Build `src/mcp/` and `power/`.
- stdio MCP server (official TypeScript SDK) with tools:
  - `scan_github_repo { url }` → verdict + findings (no file contents).
  - `scan_local_folder { path }` → same, read-only, refuses paths outside the given root, no symlink following.
  - `explain_finding { detector }` → fixed text from our catalogue (what it is, why it is dangerous, what to do).
- Output sanitised per `safety.md` (prompt-injection boundary). Tests drive the server in-process.
- `power/`: Kiro Power manifest + `mcp.json` + a skill doc ("before cloning or opening a repo from a stranger,
  call scan_github_repo"). Installable from the GitHub URL. Document install steps for judges in README.
- Also add a workspace `.kiro/settings/mcp.json` so this repo's own Kiro uses it.

## Spec 5 — bait repo (separate public repo, needs owner approval before creating)
An inert demo target: files that *look* like each disguise but do nothing (commands only echo a message, the fake
font is a short text file saying it is a demo). README and SECURITY.md say it is a harmless test fixture for
Possessed?. Built last, reviewed by hand before publishing.

## Hooks (create them in Kiro's hook UI, then commit `.kiro/hooks/`)
1. On save of `src/**/*.ts` → run `npm test`.
2. On save of `src/**` → run `npm run check:tokens` (a script that fails if any sensitive token from `tokens.ts`
   appears as a literal anywhere in `src/`, `docs/` or tests).
3. Agent stop → append a 2–3 line entry to `docs/KIRO_LOG.md` (what was done, which spec/steering helped,
   what was fixed by hand).
