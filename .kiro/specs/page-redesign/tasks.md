# Implementation Plan: page-redesign

## Overview

The Spec 9 page becomes the approved mockup (`docs/design/redesign/mockup.html`). Order: assets, pure logic, test support, DOM modules, page markup and CSS, `app.ts` wiring, then the rewritten and new tests, README, and the Verification_Suite. The owner's manual verification is last and is not a task for the agent.

Scope limits for every task: only `index.html`, `src/style.css`, `src/main.ts`, `src/web/`, `src/assets/`, `src/test-support/web/` and `README.md` change. Nothing under `src/core/`, `src/mcp/`, `power/`, `scripts/`, `src/demo-disks/`, `public/disks/` or the worker protocol is edited. `package.json` and `package-lock.json` are untouched (no new dependency). Nothing is placed under `public/fonts/`. The CSP meta in `index.html` stays byte for byte. Untrusted text enters the DOM only through `h()` text children or Text nodes. The agent never commits.

happy-dom has no layout engine. Rendered layout, overflow, clipping, console and CSP runtime behaviour cannot be verified by the suite; the rule-level checks are proxies and only the owner's final task measures them.

Commands: `npm test` (pure config), `npm run test:dom` (`*.dom.test.ts`, happy-dom), `npm run typecheck`, `npm run build`, `npm run make:demos -- --check`. Property tests use fast-check with `numRuns(100)` from `src/test-support/runs`, carry the tag comment `Feature: page-redesign, Property N: ...`, and their callbacks return nothing or a boolean, never `expect(...)`.

## Tasks

- [x] 1. Assets
  - [x] 1.1 Copy fonts, licences and images into `src/assets/`
    - Copy `hanken-grotesk-latin-wght-normal.woff2` and `instrument-serif-latin-400-normal.woff2` plus `OFL-hanken-grotesk.txt` and `OFL-instrument-serif.txt` from `docs/design/redesign/type/` to `src/assets/fonts/`. Do not copy the italic file. Do not create anything under `public/fonts/`.
    - Copy `disk35.jpg`, `disks-band.jpg` and `grain.png` from `docs/design/redesign/assets/` to `src/assets/img/`.
    - _Requirements: 1.4, 3.3, 3.4, 10.9_

  - [x] 1.2 Generate `src/assets/img/logo-pcx.png` from the converter
    - Use a one-off command (not committed, no change under `scripts/`) that opens `public/disks/office-disk.img` with `src/core`, converts `LOGO.PCX` with `convertAuto`, and writes the PNG bytes to `src/assets/img/logo-pcx.png`. Leave no temporary file behind.
    - _Requirements: 10.5, 10.6_

- [x] 2. Pure logic
  - [x] 2.1 Add `stateWord()` and `deletedCount` in `src/web/logic/viewmodel.ts`
    - Export `STATE_WORDS`, `StateWord` and `stateWord(state)` ("Alive", "Recovered", "Partly back", "Lost"). `ItemViewModel.stateLabel` becomes `stateWord(g.state)`. `summarize()` gains `deletedCount` (file entries whose state is not `alive`).
    - Update `src/web/logic/viewmodel.test.ts`: replace the `it.stateLabel === g.state` clause, add a table test of the four words and a `deletedCount` example.
    - Update `src/web/dom/graveyard.dom.test.ts` state text expectations (`'Alive'`, `'Recovered'`, `'Partly back'`) and drop the `stateText !== vm.state` clause of the hostile-state property. Cause: state text is now the State_Word.
    - _Requirements: 5.2, 8.2, 8.3, 8.5, 9.3, 9.4_

  - [ ]* 2.2 Write property test for panel summary counts
    - **Property 12: Panel summary counts are real**
    - In `src/web/logic/viewmodel.test.ts`: for any report, label (or "(no label)"), `fileCount`, `directoryCount` and `deletedCount` equal the counts over entries.
    - **Validates: Requirements 8.2**

  - [x] 2.3 Create `src/web/logic/layout.ts` and `layout.test.ts`
    - Export `NARROW_QUERY = '(max-width: 760px)'`, `MatchMediaLike` and `isNarrow(mm)`; `isNarrow` is false when `mm` is missing or throws.
    - Unit tests with missing, throwing, matching and non-matching doubles.
    - _Requirements: 8.17, 8.18, 13.6_

  - [x] 2.4 Create `src/web/logic/auto-open.ts` and `auto-open.test.ts`
    - Export `AutoOpenInput`, `mayApplyAutoOpen`, `AutoPreviewInput`, `mayApplyAutoPreview` exactly as in the design (pure, no DOM).
    - Truth-table unit tests: each condition (phase, intent, token change, shown-disk-is-auto) flips the result.
    - _Requirements: 7.5, 7.8, 8.14_

  - [x] 2.5 Add `kindLabel` to `src/web/logic/preview-model.ts`
    - Labels: "Read as Markdown", "Read as CSV", "Plain text", "Read as PNG", "Raw bytes", "Nothing to read"; append ", partly" for `partial` items.
    - Update `preview-model.test.ts`: item fixture uses `stateWord(r.state)`, add `kindLabel` cases.
    - _Requirements: 8.9, 8.10_

  - [ ]* 2.6 Write property test for downloads
    - **Property 11: Downloads use fixed types and sanitized names**
    - In `src/web/logic/preview-model.test.ts`: any name and outcome gives MIME in the fixed set, names matching `^[A-Za-z0-9._-]{1,64}$`, first download labelled `Download <ext>` when convertible, last `Download raw bytes`.
    - **Validates: Requirements 8.11**

- [x] 3. Test support
  - [x] 3.1 Create `src/test-support/web/demo-facts.ts` and `png-read.ts`
    - `demo-facts.ts` (imports only the core index files): `byteTotals`, `loadDemo`, `demoByteTotals`, `checkBar`, `checkExcerpts`, `checkHeadstones` as in the design.
    - `png-read.ts`: decode an 8-bit non-interlaced PNG with `node:zlib` (about 50 lines) to expose pixel alpha for the grain measurement.
    - _Requirements: 5.7, 6.8, 9.7, 10.6_

  - [x] 3.2 Update `src/test-support/web/css-scan.ts` and its self-tests
    - Replace `checkBackground` and `checkFxLayers` with `checkStrata(css, html)`; replace `checkNarrowDemoLayout` with a check for the one-column card list.
    - Add checks: no gradient, filter, blur or shadow constructs; animated and transitioned properties only `opacity`, `transform`, `clip-path`; hidden start states only in keyframe `from` or under `.js`; `font-family` rules (serif only on h1-h3 and `.buried`, mono only in preview text and hex); no `display: none` on `.hs`; `min-height >= 40px` list; `NARROW_QUERY` width equals the CSS narrow block.
    - Update `css-background.test.ts`, `css-check.test.ts`, `css-narrow-demo.test.ts`, `helpers.test.ts` for the new helpers with good and bad samples.
    - _Requirements: 3.1, 3.2, 6.1, 6.3, 6.4, 12.4, 12.5, 13.4_

- [x] 4. DOM modules
  - [x] 4.1 Update the `h()` attribute allow-list in `src/web/dom/h.ts`
    - Add `aria-pressed` and `aria-current`; remove `aria-modal` and `inert`. Update `h.test.ts` and `h.dom.test.ts`.
    - _Requirements: 8.7, 8.12_

  - [x] 4.2 Demo slot, svg art and demo registry
    - Create `src/web/dom/svg-art.ts` with `demoArt(id)` (fixed id-to-symbol map, `createElementNS`, `null` for unknown ids).
    - In `src/web/dom/demo-slot.ts`: cards contain `span.demo-art[aria-hidden]`, title, description; options `labelledBy` and `onIntent`; `openDemo(id, { quiet, accept })` and `has(id)`; `DemoRunDeps` gains `quiet` and `accept`.
    - Shorten `DEMO_REGISTRY` descriptions in `src/web/demos.ts` and update `demos.registry.test.ts`.
    - Update `demo-slot.dom.test.ts`: art present, labelled group, `openDemo` quiet and rejected by `accept`, `onIntent` fires before load.
    - _Requirements: 7.1, 7.2, 7.4, 7.5, 7.7_

  - [ ]* 4.3 Write property test for pressed demo cards
    - **Property 9: Exactly one demo card is pressed, and every card has known art**
    - In `src/web/dom/demo-slot.dom.test.ts`: for any registry and any id, only the matching card is pressed; every shipped registry id maps to a symbol in the `index.html` sprite.
    - **Validates: Requirements 7.1, 7.2, 7.4**

  - [x] 4.4 Graveyard changes in `src/web/dom/graveyard.ts`
    - `h3#graveyard-heading` shows the volume label, `aria-describedby` summary with deleted count; always-visible warnings banner (`role="group"`, "Warnings (n)") instead of `details`; `.grave-state` text from `stateWord`; `setCurrent(id | null)` sets `aria-current` on the row button; `rowButton(id)`; `show()` clears the current marker; keep `reveal`, guidance and Show more.
    - Update `graveyard.dom.test.ts` for the heading, banner and `setCurrent`.
    - _Requirements: 8.2, 8.3, 8.4, 8.5, 8.7, 13.8_

  - [x] 4.5 Write property tests for the graveyard view
    - **Property 7: The open row tracks the preview**
    - **Property 8: Every row carries its state, size and date as text**
    - **Property 1 (graveyard part): Disk text never becomes elements**
    - In `src/web/dom/graveyard.dom.test.ts`: `aria-current` count and id after show, clear and new-disk sequences; each row text contains State_Word, size, date, reason, and the underscore hint exactly when expected; hostile strings give the same element counts and tag set as plain `x` strings.
    - **Validates: Requirements 1.6, 1.7, 8.3, 8.4, 8.7, 13.8, 14.3**

  - [x] 4.6 Rewrite `src/web/dom/preview.ts` as the inline panel
    - Implement `PreviewPanel` (`show`, `clear`, `isShowing`, `focusHeading`, `reveal`, `headingElement`) and `createPreviewPanel(root, deps)`; empty state; `div.paper` body via the existing `buildBody`/`buildDownload`; partial note and cut line; one Blob URL only for PNG; `show`/`clear` never move focus or scroll.
    - Rewrite `preview.dom.test.ts`: remove dialog, inert, Escape, Close, Tab-wrap and opener tests; port body-kind, notes, downloads, hostile text and Blob tests to the panel.
    - _Requirements: 8.6, 8.9, 8.10, 8.11, 8.12, 8.14, 8.16_

  - [x] 4.7 Write property tests for the preview panel
    - **Property 1 (preview part): Disk text never becomes elements**
    - **Property 6: Live Blob URLs match the shown preview**
    - In `src/web/dom/preview.dom.test.ts`: hostile bodies add no elements beyond the fixed tag set; after any sequence of shows and clears `blobs.liveCount()` is 1 for a PNG and 0 otherwise.
    - **Validates: Requirements 1.7, 8.14, 8.15, 14.3**

  - [x] 4.8 Create `src/web/dom/headstones.ts` and `headstones.dom.test.ts`
    - `bindHeadstones(root, onOpen)` binds `button.hs[data-path]`; missing root is a no-op; it reads nothing from the disk.
    - _Requirements: 5.5_

  - [x] 4.9 Create `src/web/dom/motion.ts` and `motion.dom.test.ts`
    - `initMotion(env)` adds `js` to `<html>`, then adds `in` at once (reduced motion or no observer) or on first intersection; `classList` only.
    - Tests: reduced motion, no observer, fake observer.
    - _Requirements: 9.6, 12.2, 12.3_

- [x] 5. Page markup and styles
  - [x] 5.1 Rewrite `index.html`
    - Keep the CSP meta byte for byte. Add the sprite, nav, hero (`h1` with `img alt=""`), six headstone buttons, yard, workspace sections, bar, band, formats with static excerpts and `img` for the logo, footer, `noscript`. No `<style>`, `style` attribute, inline script or `on*`; `#file-input` has no `accept`.
    - Rewrite the element contract comment (Retained, Added, Retired ids). Static text for headstones, bar figures (from `formatBytes`) and excerpts must match the demo-facts checks.
    - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3, 2.4, 2.8, 4.1-4.13, 5.1, 5.2, 5.6, 7.1-7.3, 9.1-9.5, 9.8, 10.1-10.5, 10.8, 11.1-11.5, 11.7, 13.1_

  - [x] 5.2 Rewrite `src/style.css`: tokens, fonts, contrast pairs, grain, strata
    - Pair table and Palette_Tokens, `@font-face` (two faces, `font-display: swap`), base rules, `--grain-opacity` (start at 0.22 and set to the value the grain test selects in 7.6), `body::after` grain, `.edge`/`.stratum`/`.soil`, decorative selectors with `pointer-events: none`. Declare every pair in the design table; fix the lost-stone border and paper-field focus ring. No gradient, filter, blur or shadow.
    - _Requirements: 3.1-3.8, 6.1-6.5, 6.8, 13.2_

  - [x] 5.3 `src/style.css`: nav, hero, headstones, yard, panels, bar, band, formats, footer
    - Wrapping flex headstone row with per-stone size, tilt and sink; dashed sunk partial stone; two-column `.workspace` with sticky preview; Grave_Row and preview classes (keep existing class names); literal `flex` bar values 10600, 3468, 2048, 1024 without `min-width`; logo at 448px with pixelated rendering; `min-height: 40px` targets; `.buried` centred.
    - _Requirements: 5.3, 5.4, 5.8, 6.7, 8.1, 8.5, 8.9, 9.2, 9.3, 10.5, 11.6, 13.4, 13.5_

  - [x] 5.4 `src/style.css`: motion, narrow block, reduced motion
    - Keyframes using only `opacity`, `transform`, `clip-path` with hidden states in `from` or under `.js`; preview fade; `@media (max-width: 760px)` block (nav keeps only `#repo-link`, stacked layout, logo at 256px); `prefers-reduced-motion` block that removes animation and shows everything.
    - _Requirements: 5.4, 5.8, 9.6, 12.1-12.5, 13.6_

- [x] 6. `app.ts` wiring
  - [x] 6.1 Base wiring in `src/web/app.ts` and `src/main.ts`
    - Remove effects, `fx-host`, dialog, `inert` and opener plumbing. Look up `#preview`, `#headstones`, `#pick-button-footer` (detached fallbacks and `MISSING_ELEMENTS_MESSAGE`). Add `options.matchMedia`. On every successful open: `preview.clear()`, `blobs.revokeAll()`, `graveyard.show(...)`. Footer button clicks `input.click()`. Wrap intake status so failures scroll into view. `main.ts` calls `initMotion` in a `try`, then `startApp()`.
    - _Requirements: 2.5, 2.6, 2.7, 4.5, 6.6, 8.12, 8.14, 11.1_

  - [x] 6.2 Intent tracking, headstone and activation by origin
    - `intentSeen` set only by pick/footer click, `#file-input` change, document drop, `onIntent`, headstone and row handlers. `activate(item, origin)`: show model, `setCurrent`, status "Opened NAME."; headstone always `preview.reveal`; row reveals only when `isNarrow`. Headstone opens the Writer_Disk with `pending.after` when not already open; failure clears `pending`; missing path sets a status line. Open with `after` reveals the graveyard then the preview.
    - _Requirements: 5.5, 7.6, 8.6, 8.8, 8.17, 8.18, 8.19_

  - [x] 6.3 Auto_Open and quiet auto-preview
    - After `refreshControls()`, call `slot.openDemo('writers-disk', { quiet: true, accept })` gated by `mayApplyAutoOpen`; on success run `previewQuiet` for `CHAPTER1.WS`, gated by `mayApplyAutoPreview`, with `setCurrent` and no status, focus or scroll call. Quiet open clears status instead of announcing.
    - _Requirements: 7.5, 7.7, 7.8, 7.9, 8.8, 8.14_

  - [x] 6.4 Delete retired files and constants
    - Delete `dom/effects.ts`, `effects.test.ts`, `effects.dom.test.ts`, `logic/effects-math.ts`, `effects-math.test.ts`, `dom/focus-trap.ts`, `focus-trap.test.ts`, `logic/focus-order.ts`, `focus-order.test.ts`. Remove `FX_*` from `logic/limits.ts` and any remaining `checkFxLayers` reference. Confirm no remaining import with `npm run typecheck`.
    - _Requirements: 2.9, 6.6, 8.12_

- [x] 7. Tests
  - [x] 7.1 Rewrite `src/web/page.static.test.ts`
    - CSP equals the captured string and passes `checkCsp`; no inline style, script or `on*`; `checkUrls`; same-origin or allowed hosts only; `public/fonts` absent; `package.json` dependency keys unchanged; contract ids once each and contract comment lists them; hero, nav, footer, title, meta description, privacy note; Contrast_Pairs all declared and passing; font files, OFL texts and two `@font-face` with swap and no italic; Palette_Tokens; `checkStrata`; font-family and motion checks; headstone CSS; `NARROW_QUERY` equals the CSS narrow width; source scans (no sinks, `fetch` only in `demos.ts`, no `role="dialog"`, `aria-modal`, `inert`); digits in hero and meta found in the README.
    - _Requirements: 1.1-1.9, 2.1-2.4, 3.1-3.8, 4.1-4.13, 6.1-6.6, 11.1-11.7, 12.1-12.5, 13.1-13.6_

  - [x] 7.2 Create `src/test-support/web/demo-facts.test.ts`
    - Example tests against the committed disks: headstones match the Writer_Disk report, bar totals (10,600, 3,468, 2,048, 1,024) match `aria-label`, figures and CSS `flex` values, excerpts match converter output, `logo-pcx.png` equals converter output with IHDR 64x40 matching `width`/`height`, captions name disk and file.
    - _Requirements: 5.1, 5.2, 5.7, 9.2, 9.4, 9.7, 10.3-10.8_

  - [ ]* 7.3 Write property test for the headstone checker
    - **Property 2: Headstone checker accepts the real report and rejects every mutation**
    - In `src/test-support/web/headstones.facts.test.ts`.
    - **Validates: Requirements 5.1, 5.2, 5.7**

  - [ ]* 7.4 Write property test for byte totals and the bar
    - **Property 3: Byte totals partition the declared sizes, and the bar shows them**
    - In `src/test-support/web/bar.facts.test.ts`.
    - **Validates: Requirements 9.2, 9.4, 9.5, 9.7**

  - [ ]* 7.5 Write property test for shown excerpts
    - **Property 4: Shown excerpts are prefixes or row subsets of converter output**
    - In `src/test-support/web/excerpts.facts.test.ts`.
    - **Validates: Requirements 10.3, 10.4, 10.6**

  - [x] 7.6 Create `src/web/grain-opacity.test.ts`
    - Using `png-read.ts`, try 22, 20, ..., 10 (integers) and pick the highest step where every text pair passes over the real grain. Require `--grain-opacity` in the CSS to equal it, or the documented section-background fallback when none passes. With `EXHUME_REPORT=1`, print `grain-opacity: 0.NN` (or `fallback-section-backgrounds`) and the worst pair and ratio. Then set the CSS value in `src/style.css` accordingly.
    - _Requirements: 6.8_

  - [x] 7.7 Rewrite `src/web/app.dom.test.ts`
    - Build the page from the real `index.html` body; call `startApp` with a `matchMedia` double. Dialog tests become inline-preview tests; opening clears the preview; Auto_Open loads the Writer_Disk and shows `CHAPTER1.WS` with `aria-current`, no focus change, no `focus`/`scrollIntoView` call, empty `#status`; a user action during either step wins; failed Auto_Open message and usable cards; headstone focus and scroll at wide and narrow; row focus stays wide, moves to `#preview-title` narrow, with "Opened NAME."; footer button; pressed card behaviour; tab order groups.
    - _Requirements: 2.5-2.7, 4.5, 5.5, 7.4-7.9, 8.6, 8.8, 8.12-8.14, 8.17-8.19, 11.1, 14.1_

  - [x] 7.8 Rewrite `src/web/dom/keyboard.dom.test.ts`
    - Replace Escape/focus-return and focus-trap groups with: no trap, Tab leaves the panel; wide Enter on a row keeps focus on the row; narrow Enter moves to the preview heading; Enter on a headstone always moves to the preview heading. Keep Show more and activation groups.
    - _Requirements: 8.13, 8.17, 8.18, 8.19, 13.3_

  - [x] 7.9 Write property tests for request ordering
    - **Property 5: A superseded request never shows a preview**
    - In `src/web/app.requests.dom.test.ts` with a scripted worker that answers in any order.
    - **Validates: Requirements 8.6, 8.14, 14.4**

  - [x] 7.10 Write property test for Auto_Open
    - **Property 10: Auto_Open never overrides the user, in either step**
    - In `src/web/app.auto-open.dom.test.ts`: interleavings of auto-open load, auto-preview answer, user opens, row activations and answers.
    - **Validates: Requirements 7.5, 7.8, 8.8, 8.14**

  - [x] 7.11 Extend `src/web/dist.build.test.ts`
    - Every `img src` in `dist/index.html` resolves in `dist/`; no `/src/` path remains; exactly two `.woff2` files; `grain`, `disk35`, `disks-band`, `logo-pcx` emitted; no `data:` URLs.
    - _Requirements: 1.3, 3.3, 10.9_

- [x] 8. README
  - [x] 8.1 Update `README.md`
    - Add the short paragraph from the design (1980s-era DOS floppy images, extensions, accepted size range, page layout). Keep the prior-art credit and demo disk text.
    - _Requirements: 4.12, 14.7_

- [x] 9. Checkpoint - Verification_Suite and grain report
  - Run `npm run typecheck`, `npm test`, `npm run test:dom`, `npm run build` and `npm run make:demos -- --check`. All must pass and the Demo_Check must report the committed disks unchanged.
  - Run `EXHUME_REPORT=1 npx vitest --run src/web/grain-opacity.test.ts` and show the `grain-opacity:` line as text in the reply, for the owner's log (`docs/KIRO_LOG.md` or the commit message). Do not write it to any file and do not commit.
  - Run `git diff --stat` and confirm no edits under `src/core/`, `src/mcp/`, `power/`, `scripts/`, `src/demo-disks/`, `public/disks/`, no file under `public/fonts/`, and no change to `package.json` or `package-lock.json`.
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10. Restore the grain overlay and darken the failing pair
  - Restore the `body::after` overlay and `--grain-opacity` in `src/style.css`; drop the section `background-image` grain fallback. The only failing pair is `field-accent-proof` (`#8a4b12` on `#d5d6d0`, 4.44:1 at 0.10). Darken `--pair-field-accent-fg` and every use of that colour (`--pair-field-accent-proof-fg`, `--pair-focus-ui-field-fg`, `--field-focus`, and any literal) until `src/web/grain-opacity.test.ts` passes at 0.16 or higher; keep the highest passing step and set `--grain-opacity` to it.
  - Update `grain-opacity.test.ts` and `checkStrata` expectations so the overlay (not the fallback) is the shipped form; keep the fallback branch in the test only as the documented failure path.
  - Run `EXHUME_REPORT=1 npx vitest --run src/web/grain-opacity.test.ts` and show the new `grain-opacity:` line as text in the reply. Do not write it to any file.
  - _Requirements: 6.1, 6.3, 6.8_

- [x] 11. Headstone row, 761 to 1180 px
  - In `src/style.css`, make all six stones sit in one row on the ground line in this range: size them with `vw` or `clamp` so six fit with the gap; keep tilt and sink. At 768 px no stone wraps or overlaps another and the row does not float above the soil.
  - Add a static check to `css-scan.ts` and `page.static.test.ts` (sum of six widths plus gaps at 761 px fits the content width, using the declared `vw`/`clamp` values).
  - _Requirements: 5.3, 5.4, 13.6_

- [x] 12. Headstone row, 760 px and below: two rows with depth
  - In the narrow block keep two rows of three. Back row (stones 1-3, `.stone-0` to `.stone-2`) sits behind the front row: negative row gap so the lower part of each back stone is hidden behind the front row, back row at about 85% size, darker stone fill. Front row (stones 4-6) sits on the soil edge. No stone covers another stone's name or state label. All six stay visible, focusable buttons.
  - Add the back-row label pair to the contrast table (`--pair-hs-back-fg` / `--pair-hs-back-bg`, 4.5:1, plus the recovered and partial variants if their fill changes) and cover it in `page.static.test.ts`.
  - _Requirements: 5.3, 5.4, 6.1, 13.6_

- [x] 13. Fix the alive segment text and guard it in checkBar
  - In `index.html` the alive segment line says "Three files read exactly as written." The Writer_Disk has four alive files (CHAPTER1.WS, CHAPTER2.WS, CHAPTER3.WS, README.TXT). Fix the text.
  - Make `checkBar` in `src/test-support/web/demo-facts.ts` fail when a number word (one to twelve, or digits) in a segment line does not equal the count of files in that state on the committed disk. Add a negative example in `demo-facts.test.ts`.
  - _Requirements: 9.2, 9.4, 9.7_

- [x] 14. Favicon
  - Add a small SVG favicon `src/assets/img/favicon.svg` (the nav disk mark, same shapes as `#d-mark`) and `<link rel="icon" type="image/svg+xml" href="/src/assets/img/favicon.svg">` in `index.html`, bundled by Vite. Keep the CSP unchanged. Update the element contract comment if needed and `page.static.test.ts` (same-origin href).
  - Extend `src/web/dist.build.test.ts`: the icon href in `dist/index.html` resolves to a file in `dist/`.
  - _Requirements: 1.3, 10.9_

- [x] 15. Checkpoint - rerun the Verification_Suite after tasks 10-14
  - Run `npm run typecheck`, `npm test`, `npm run test:dom`, `npm run build` and `npm run make:demos -- --check`. All must pass; show each result and the `grain-opacity:` line from `EXHUME_REPORT=1 npx vitest --run src/web/grain-opacity.test.ts`. Confirm with `git status` that nothing changed under `src/core/`, `src/mcp/`, `power/`, `scripts/`, `src/demo-disks/`, `public/disks/`, and that `package.json` and `package-lock.json` are unchanged. Do not commit.

## Owner only - not for the agent to run

### Manual verification and tuning (Requirement 14.6, 14.8)

This section has no checkboxes on purpose. The agent must not run it, tick it or claim it passed. The project owner records the result in `docs/KIRO_LOG.md` or the commit message, together with the `grain-opacity` line from task 9.

Use a locally installed headless Chrome or Chromium against `npm run dev` or `npm run preview` (no dependency added), at 1440x900, 768x1024 and 390x844:

- Load the page, open each demo disk and one dropped file. Record `document.documentElement.scrollWidth <= window.innerWidth`.
- Take viewport screenshots at top, middle and bottom scroll positions. Check no flat band, six headstones visible and wrapped at 390 px, buried name centred, formats rows not clipped.
- Record console errors and `securitypolicyviolation` events during load and use.
- Tab through the page once and compare with the order: nav, Open button, demo link, headstones, demo cards, grave rows, preview controls, footer.
- With the OS reduce-motion setting on, confirm nothing animates and everything is visible.
- Tune the headstone row wrap (tilt, sink, sizes) from the 390 px screenshot.
- At 1440 px check the disk bar: segments proportional, captions beside the bar, figures match 10.4 KB, 3.4 KB, 2.0 KB, 1.0 KB.
- Check the Auto_Open on load: filled preview, no focus ring, no scroll jump.

## Notes

- Tasks marked with `*` are optional property-test sub-tasks; all other tasks are required.
- Tasks that edit the same file sit in different waves.
- Existing tests that change are rewritten for the replacement behaviour, never deleted without a successor (Requirement 2.9).
- The manual section and the checkpoint are not in the dependency graph.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "2.3", "2.4", "3.2", "4.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "2.5", "3.1", "4.2", "4.8", "4.9"] },
    { "id": 2, "tasks": ["2.6", "4.3", "4.4", "4.6", "5.1"] },
    { "id": 3, "tasks": ["4.5", "4.7", "5.2", "6.1"] },
    { "id": 4, "tasks": ["5.3", "6.2"] },
    { "id": 5, "tasks": ["5.4", "6.3"] },
    { "id": 6, "tasks": ["6.4", "7.1", "7.2", "7.6", "7.11", "8.1"] },
    { "id": 7, "tasks": ["7.3", "7.4", "7.5", "7.7", "7.8", "7.9", "7.10"] },
    { "id": 8, "tasks": ["10", "13"] },
    { "id": 9, "tasks": ["11", "14"] },
    { "id": 10, "tasks": ["12"] },
    { "id": 11, "tasks": ["15"] }
  ]
}
```
