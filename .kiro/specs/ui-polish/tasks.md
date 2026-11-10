# Implementation Plan: ui-polish

## Overview

Items 1 to 8 come first, each with its tests beside it. Item 9 (spooky layer) is optional and comes last. Every change stays in `index.html`, `src/style.css`, `src/web/` and the test helpers in `src/test-support/web/`. Nothing under `src/core/`, `src/mcp/`, `power/`, `scripts/` or `public/disks/` is edited, `package.json` is untouched, and no task edits `src/web/logic/markdown.ts` or `src/web/dom/preview-content.ts`.

happy-dom has no layout engine, so rendered pixels, horizontal overflow and card height cannot be checked by the automated suite. The rule-level checks in tasks 2 and 6 are proxies only. The real measurements are the owner-run task 10.1.

Test commands: `npm test` (pure config) and `npm run test:dom` (`*.dom.test.ts`, happy-dom). Property callbacks return nothing or a boolean and never call `expect`. Use `numRuns(100)` from `src/test-support/runs`.

## Tasks

- [x] 1. Static page: intro, title, meta description, repo link
  - [x] 1.1 Edit `index.html` and the stylesheet header
    - Set `<title>` to "Exhume - read old floppy disks in your browser".
    - Add `<meta name="description">` after the CSP meta (at most 160 characters, no digits). Do not edit the CSP meta.
    - Replace the `header` content with `h1` plus `section#intro.intro` (lead sentence, five-item `ul.intro-list`, `p#privacy-note.note`), as in the design.
    - Add `a#repo-link.repo-link` to the footer (`href="https://github.com/tsang326/exhume"`, `rel="noopener noreferrer"`, `aria-label="Exhume on GitHub"`), keeping `#honesty-note`.
    - Add `#intro` and `#repo-link` to the element contract comment; keep every existing id.
    - In `src/style.css`, rewrite the line 2 comment "REVENANT.OS / Exhume: ..." to "Exhume: ..." and add styles for `.intro`, `.intro-lead`, `.intro-list`, `.repo-link`.
    - Grep `src/web/` and `src/main.ts` for "REVENANT.OS" and remove any non-test occurrence.
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 1.2 Update and extend `src/web/page.static.test.ts` for the static page
    - Update any assertion on the old title "Exhume - REVENANT.OS". Cause: the title changes (item 2).
    - Add: intro precedes `#drop-zone` in document order; lead sentence; five `li` with the keywords; `#privacy-note` inside the intro; `#repo-link` href and `aria-label` containing "GitHub"; intro and meta description contain no digit; each keyword (WordStar, Markdown, dBase, CSV, PCX, PNG) appears in `README.md`; `#honesty-note` kept; contract ids kept.
    - Add: exact title; exactly one meta description of 1 to 160 characters; no "REVENANT.OS" in `index.html`, `src/main.ts`, `src/style.css` or non-test files under `src/web/`; CSP equals `EXPECTED_CSP`.
    - _Requirements: 1.1 to 1.9, 2.1 to 2.5, 10.1, 10.2_

- [x] 2. Background covers the whole page
  - [x] 2.1 Add `checkBackground(css: string): CssProblem[]` to `src/test-support/web/css-scan.ts`
    - Use `parseCss`. Fail unless: `html` has the solid ground background; `body` has `position: relative` and `min-height` of `100vh` or `100dvh`; `body::before` has `position: absolute`, `inset: 0`, `pointer-events: none` and an integer `z-index` below `.content`; every `radial-gradient(` in `body::before` uses an explicit two-length ellipse size and ends in `transparent`; no `#fx-host`, `#fx-host::before`, `#fx-host::after` or `.fx-glow` rule has a gradient background; no `.content`, `#app`, `main`, `header` or `footer` rule paints an opaque background.
    - This is a rule-level proxy and does not prove rendering.
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 2.2 Rewrite the background rules in `src/style.css`
    - Move the solid ground colour to `html`. Make `body` `position: relative`, `min-height: 100vh` then `100dvh`, transparent background, `overflow-x: hidden`.
    - Add `body::before, .fx-glow` with `position: absolute; inset: 0; z-index: 0; opacity: 0.45; pointer-events: none` and three fixed-size ellipse gradients ending in `transparent`.
    - Reduce `#fx-host` to `position: fixed; inset: 0; z-index: 0; pointer-events: none; overflow: hidden`. Delete `#fx-host::before` and `#fx-host::after`.
    - Keep `html, body` free of horizontal scroll. Do not change any `--pair-*` value.
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 9.1, 9.3_

  - [x] 2.3 Wire the background checks into `src/web/page.static.test.ts`
    - Assert `checkBackground(css)` returns `[]`.
    - Assert `checkFxLayers`, `checkLayout`, `checkPairs` and the URL check still return `[]`.
    - Add self-tests that `checkBackground` reports a problem for a bad sample (viewport-tall gradient on `#fx-host`, missing `html` background).
    - _Requirements: 3.1 to 3.6, 10.1_

- [x] 3. Graveyard guidance, reveal and focus
  - [x] 3.1 Update `src/web/dom/graveyard.ts`
    - Add `p.graveyard-guidance` "Open a disk to see its files." shown until the first `show()`.
    - Start `#graveyard-heading` and `div.graveyard-stats` with `hidden`; keep `tabindex="-1"` on the heading and add `aria-describedby="graveyard-summary"`; give the summary id `graveyard-summary`.
    - Move the progress element into `.graveyard-stats` directly under the summary; keep `renderUpTo()` rewriting its text.
    - First `show()` hides the guidance and unhides heading and stats; later calls keep that state.
    - Add `reveal(reducedMotion: boolean)` to the `GraveyardView` interface and implementation: `heading.focus({ preventScroll: true })`, then `scrollIntoView({ behavior: reducedMotion ? 'instant' : 'smooth', block: 'start' })` guarded by `typeof heading.scrollIntoView === 'function'`.
    - Keep `ul[aria-labelledby=graveyard-heading]`. Use `h()` and Text nodes only; no `innerHTML`.
    - _Requirements: 4.1, 4.2, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4, 5.9, 8.1_

  - [x] 3.2 Style the new graveyard elements in `src/style.css`
    - Add `.graveyard-guidance` and `.graveyard-stats` (every class created with `h()` needs a rule, per the existing static test).
    - _Requirements: 4.1, 8.1_

  - [x] 3.3 Call `reveal` from `src/web/app.ts` on a successful open
    - In the `ok` branch capture `const previewWasOpen = preview.isOpen()` before `preview.close()`, then after `graveyard.show(...)` and the status update call `graveyard.reveal(prefersReducedMotion())` unless `previewWasOpen`.
    - Failed, lost and superseded opens must not call `reveal`.
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 3.4 Write property test for guidance until a disk is shown
    - **Property 1: Guidance until a disk is shown**
    - In `src/web/dom/graveyard.dom.test.ts`: for any report and item list, a fresh view shows the guidance and hides heading, stats and "Show more"; after `show` the guidance is hidden and the heading shown; a second `show` keeps that.
    - **Validates: Requirements 4.1, 4.2**

  - [x] 3.5 Update and extend `src/web/dom/graveyard.dom.test.ts`
    - Update tests that expect the heading visible, or the progress after the list, before any disk. Cause: heading hidden until first `show()` (item 4) and progress moved into the stats block (item 8).
    - Update tests that compare whole view models so they include `nameHint`. Cause: new `ItemViewModel` field (item 7).
    - Add examples: heading `hidden` while guidance shows; `aria-labelledby` target exists; heading `tabindex="-1"` and `aria-describedby` equals the summary id; `reveal()` focuses the heading and calls the `scrollIntoView` spy once with `{ behavior: 'smooth', block: 'start' }`, or `'instant'` when `reducedMotion` is true; stats block holds summary then progress.
    - _Requirements: 4.1, 4.2, 4.5, 4.6, 5.1 to 5.4, 5.9, 8.1, 10.2_

  - [x] 3.6 Add open-flow tests in `src/web/app.dom.test.ts` and `src/web/dom/keyboard.dom.test.ts`
    - After a good open: `document.activeElement` is the heading; `scrollIntoView` called with smooth (matchMedia false) and instant (matchMedia true).
    - Failed open with no earlier disk: guidance still shown, focus and spy untouched. Failed open with an earlier disk: earlier disk kept, guidance hidden.
    - Preview open during an open: focus unchanged, no `reveal`.
    - Keyboard: the heading is not in the tabbable list; existing order assertions still pass, with the repo link allowed as the only added last stop.
    - _Requirements: 4.3, 4.4, 5.1 to 5.6, 10.1_

- [x] 4. Markdown preview spacing (CSS only)
  - [x] 4.1 Update the `.preview-markdown` rules in `src/style.css`
    - Set `.preview-markdown { line-height: 1.5; overflow-wrap: anywhere; }` and `.preview-markdown p { margin: 0 0 0.75em; }`.
    - Do not edit `src/web/logic/markdown.ts`, `src/web/dom/preview-content.ts` or `src/core/`. The converter's missing paragraph breaks belong to the bugfix spec `mcp-root-and-flaky`.
    - _Requirements: 6.2, 6.3, 6.7_

  - [x] 4.2 Add CSS checks to `src/web/page.static.test.ts`
    - Parsed CSS: `.preview-markdown p` margin-bottom is `0.75em` or more; `.preview-markdown` line-height is `1.4` or more.
    - _Requirements: 6.2, 6.3, 10.1_

  - [x] 4.3 Write property test for Markdown paragraph mapping
    - **Property 6: Markdown paragraphs map one to one, line breaks map to one br, and text is preserved**
    - In `src/web/dom/markdown-dom.dom.test.ts`, using the existing rendering code unchanged: N groups of safe lines joined by blank lines give N `p`; one `br` per single-newline break; `textContent` equals the concatenated text; no elements other than `p`, `br`, `strong`, `em`, `hr`.
    - **Validates: Requirements 6.1, 6.4, 6.6**

- [x] 5. Distinct, explained deleted graves
  - [x] 5.1 Add `nameHint` to `src/web/logic/viewmodel.ts`
    - Export `UNDERSCORE_HINT` ("When the file was deleted, DOS overwrote this name’s first letter."; reworded during implementation because the forbidden-phrase scan rejects "the first") and `underscoreHint(state, name)` returning the hint when `state !== 'alive'` and `name.startsWith('_')`, else `null`.
    - Add `nameHint: string | null` to `ItemViewModel`; `toItemViewModels` sets it from the displayed name. Keep all existing fields.
    - _Requirements: 7.5, 7.6, 7.7, 7.9_

  - [x] 5.2 Render the hint in `src/web/dom/graveyard.ts`
    - In `buildItem`, when `item.nameHint !== null`, add `h('span', { class: 'grave-hint' }, item.nameHint)` after the name. Keep `grave-art`, `grave-state` and `grave--<state>`. Text nodes only.
    - _Requirements: 7.2, 7.3, 7.5, 7.7, 7.8_

  - [x] 5.3 Style the graveyard cues in `src/style.css`
    - Open-grave icon: 5rem by 3.5rem, lighter `var(--raised)` fill, dashed top edge in `var(--pair-grave-art-ui-fg)`.
    - Add `--pair-grave-art-ui-fg: #8fa5aa` and `--pair-grave-art-ui-bg: #141c1e`.
    - `.grave-state::before` glyphs: recovered `\25CF`, partial `\25D0`, lost `\2715`, alive `\25A0`, each followed by a non-breaking space. Icon shapes differ by state (solid, half-filled by hard-stop gradient, outline only).
    - Add `.grave-hint` (`color: var(--pair-muted-fg)`, `font-size: 0.875rem`).
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.10_

  - [x] 5.4 Write property test for the underscore hint
    - **Property 3: Underscore hint if and only if a deleted entry's name starts with `_`**
    - In `src/web/logic/viewmodel.test.ts`: `underscoreHint(state, name)` equals the hint exactly when `state !== 'alive'` and the name starts with `_`, else `null`.
    - In `src/web/dom/graveyard.dom.test.ts`: a rendered item has `.grave-hint` exactly when its `nameHint` is non-null.
    - **Validates: Requirements 7.5, 7.6, 7.7**

  - [x] 5.5 Write property test for state text and safe text rendering
    - **Property 2: Every item shows its state as text with a state class, and disk text stays text**
    - In `src/web/dom/graveyard.dom.test.ts`: arbitrary names, paths and reasons, including `<`, `>`, `&` and quotes; each `li.grave` has non-empty `.grave-state` text equal to the state word, class `grave--<state>`, only expected elements, and a name equal to the view model name.
    - **Validates: Requirements 7.2, 7.3, 7.8**

  - [x] 5.6 Update `src/web/logic/viewmodel.test.ts`
    - Update expectations that compare whole view models to include `nameHint`. Cause: new field (item 7).
    - Add examples for `_`-prefixed deleted names, an `alive` name with `_`, and a deleted name without `_`.
    - _Requirements: 7.5, 7.7, 7.9, 10.2_

  - [x] 5.7 Add CSS checks to `src/web/page.static.test.ts`
    - Three different glyph rules for recovered, partial and lost.
    - Open-grave icon width at least 5rem and height at least 3.5rem.
    - The new `--pair-grave-art-ui` pair passes `checkPairs`.
    - Every class created with `h()` (including `graveyard-guidance`, `graveyard-stats`, `grave-hint`) has a rule.
    - _Requirements: 7.1, 7.2, 7.4, 7.10, 10.1_

- [x] 6. Progress line, pressed demo card, narrow layout
  - [x] 6.1 Change `progressText` in `src/web/logic/paging.ts`
    - Return `Showing ${visible} of ${total} items`.
    - Update the `progressText` expectations in `src/web/logic/paging.test.ts`. Cause: the progress text gains context (item 8).
    - _Requirements: 8.2, 8.3, 10.2_

  - [x] 6.2 Write property test for the progress line
    - **Property 4: Progress line reports real counts after every render**
    - In `src/web/dom/graveyard.dom.test.ts` (and `paging.test.ts` for `visibleCount`): for totals from 0 past `PAGE_SIZE` and any number of "Show more" activations, the progress text equals `Showing ${visibleCount(total, pages)} of ${total} items`; it reads `Showing ${total} of ${total} items` when all are shown; it changes after each activation that rendered more.
    - **Validates: Requirements 8.2, 8.3, 8.4**

  - [x] 6.3 Add `setPressed` to `src/web/dom/demo-slot.ts`
    - Create cards with `aria-pressed="false"`; add `setPressed(id: string | null)` to the `DemoSlot` interface: `"true"` on the matching card, `"false"` on all others, all `"false"` for `null` or an unknown id. Do not touch `disabled`. Keep native buttons with `strong` title and `span` description.
    - _Requirements: 8.5, 8.6, 8.9_

  - [x] 6.4 Wire `setPressed` in `src/web/app.ts`
    - Make `slot` an outer `let slot: DemoSlot | null`. In the demo callback set `pendingSource = demo.id` around the synchronous `intakeBytes ?? onBytes` call and clear it in `finally`.
    - `openBytes` reads `pendingSource` first; in the `ok` branch call `slot?.setPressed(source)` (`null` for dropped or chosen files). Failed, lost and superseded opens do not call it.
    - _Requirements: 8.5, 8.6, 8.8_

  - [x] 6.5 Add pressed-card and narrow-layout CSS to `src/style.css`
    - `.demo-slot-button[aria-pressed='true']` uses `border-width: 3px; border-style: double`, and `.demo-slot-title::after` adds " - open now" (en dash as in the design).
    - Add the `@media (max-width: 600px)` block: smaller `.demo-slot` padding, `.demo-slot-list` with `grid-template-columns: 1fr` and a small gap, `.demo-slot-button` padding at most `0.75rem`, `.demo-slot-description` at `0.8125rem` with `-webkit-line-clamp: 2` and `line-clamp: 2`. Never hide the cards.
    - _Requirements: 5.7, 5.8, 8.7_

  - [x] 6.6 Add `checkNarrowDemoLayout(css: string): CssProblem[]` to `src/test-support/web/css-scan.ts`
    - Inside the `@media (max-width: 600px)` block fail unless `.demo-slot-list` has `grid-template-columns: 1fr`, `.demo-slot-description` has `-webkit-line-clamp` and `line-clamp` of 2 or less, `.demo-slot-button` padding is `0.75rem` or less, and no demo rule uses `display: none` or `visibility: hidden`.
    - This is a rule check, not a height measurement.
    - _Requirements: 5.7, 5.8_

  - [x] 6.7 Update `src/web/dom/demo-slot.dom.test.ts` for the new attribute
    - Update expectations on card attributes. Cause: cards now carry `aria-pressed="false"` at creation (item 8).
    - _Requirements: 8.9, 10.2_

  - [x] 6.8 Write property test for the pressed card
    - **Property 5: Exactly one demo card is pressed**
    - In `src/web/dom/demo-slot.dom.test.ts`: for any registry of one or more entries and any id (registry id, `null`, unknown string), exactly the matching card has `aria-pressed="true"` (none for `null` or unknown) and all others `"false"`.
    - **Validates: Requirements 8.5, 8.6**

  - [x] 6.9 Add pressed-state tests in `src/web/app.dom.test.ts`
    - A demo click followed by a good open sets pressed on that card only.
    - A dropped file after a demo clears every card.
    - A failed demo load leaves the previous values unchanged.
    - A size-rejected demo does not leak its id into a later open.
    - _Requirements: 8.5, 8.6, 8.8, 10.1_

  - [x] 6.10 Add CSS checks to `src/web/page.static.test.ts`
    - `checkNarrowDemoLayout(css)` returns `[]`, with a self-test that a bad sample is reported.
    - The pressed rule uses a border style and added words, not colour alone.
    - _Requirements: 5.7, 5.8, 8.7, 10.1_

- [x] 7. Guard tests for scope and safety
  - [x] 7.1 Add source scans to `src/web/page.static.test.ts`
    - No `innerHTML`, `outerHTML` or `insertAdjacentHTML` in non-test files under `src/web/`.
    - `fetch` appears only in `src/web/demos.ts`.
    - `package.json` has the same `dependencies` and `devDependencies` keys as before this spec (compare against a fixed list in the test).
    - _Requirements: 6.4, 7.8, 10.6, 10.7_

- [x] 8. Checkpoint - Items 1 to 8 complete
  - Run `npm test` and `npm run test:dom`. Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Spooky layer (optional, last)
  - [ ]* 9.1 Verify the spooky layer against its limits
    - Add checks to `src/web/page.static.test.ts`: the glow and fog use only CSS gradients and the existing canvas; no `url(` or remote reference in the glow rules; `body::before` and `#fx-host` keep `pointer-events: none` and a `z-index` below `.content`; reduced-motion still stops animation; `FX_MAX_FPS` and `FX_MAX_SHAPES` are unchanged; `checkPairs` returns `[]`.
    - If the glow lowers readability in the manual review (task 10.1), lower `body::before` opacity or remove the middle gradient in `src/style.css`; items 1 to 8 do not depend on it.
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8_

- [x] 10. Manual verification (owner-run, not a coding task)
  - [x] 10.1 Run the headless Chromium checks and record the result (owner ran it 2026-11-10: all pass except the phone reveal offset, fixed by task 12)
    - The owner runs these with a locally installed Chrome or Chromium against `npm run dev` (no dependency is added). Record the outcome in the commit message or `docs/KIRO_LOG.md`.
    - Background edge (3.2): at 1440x900 and 390x844 open the writers disk and the damaged disk; take viewport screenshots at top, middle and bottom scroll positions; confirm no flat band or hard edge and a visible glow at the top and bottom.
    - Horizontal scroll (3.5): at both sizes check `document.documentElement.scrollWidth <= window.innerWidth` after opening each demo disk.
    - Narrow demo height (5.8): at 390x844 compare `.demo-slot` height on the previous commit and now; it must be lower. This is the only check of that claim.
    - Phone behaviour (5.1 to 5.4): tap a demo card; the page scrolls to the Graveyard heading, and jumps without animation when the OS reduce-motion setting is on.
    - Glow readability (9.7): confirm text stays readable over the glow.
    - _Requirements: 3.2, 3.5, 5.1, 5.2, 5.3, 5.4, 5.8, 9.7_

- [x] 11. Final checkpoint - Verify the whole change
  - Run `npm test` and `npm run test:dom`; both must pass.
  - Run the typecheck (`npm run typecheck`) and `npm run build`; both must pass.
  - Run `npm run make:demos -- --check`; it must report the committed demo disks unchanged.
  - Run `git diff --stat` and confirm no edits under `src/core/`, `src/mcp/`, `power/`, `scripts/` or `public/disks/`, and none to `src/web/logic/markdown.ts` or `src/web/dom/preview-content.ts`.
  - Confirm `package.json` and `package-lock.json` show no new dependency.
  - Grep for "REVENANT.OS" (only the absence test may match) and for `innerHTML`, `outerHTML`, `insertAdjacentHTML` in `src/web/` non-test files (no matches).
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Fix: reveal runs before the Cancel button hides (found by the owner in 10.1)
  - Owner finding (headless Chrome, 390x844, both reduced-motion settings, writers and damaged disks): after a demo card opens a disk, `#graveyard-heading` ends at `getBoundingClientRect().top = -66` (writers) and `-42` (damaged), above the viewport. Requirement 5.1 needs the heading in view.
  - Cause: in `openBytes` in `src/web/app.ts`, the `'ok'` case calls `graveyard.reveal(...)` while the Cancel button is still visible (`client.hasPending()` was true during the open). The `refreshControls()` after the `switch` then hides it, and the content above the heading shrinks after the scroll.
  - Fix: make the reveal happen after the controls are refreshed. For example, run `refreshControls()` before `graveyard.reveal(...)` in the `'ok'` case, or record a flag and reveal after the `refreshControls()` that follows the `switch`. Keep the existing rule that a reveal is skipped when the preview was open. Change nothing else.
  - Test: add a DOM test in `src/web/app.dom.test.ts`. When `reveal` (or `scrollIntoView` on the heading) runs after a successful open, the Cancel button must already be hidden. It must fail on the current order and pass after the fix.
  - Run `npm test`, `npm run test:dom` and `npm run typecheck`; all must pass. Same scope limits as task 11: only `src/web/app.ts` and `src/web/app.dom.test.ts` change.
  - _Requirements: 5.1, 5.2_

## Notes

- Only task 9.1 (spooky layer) is optional, marked with `*`. All other tasks, including the property tests for Properties 1 to 6, are required.
- Tests that must be updated, with cause: `page.static.test.ts` old title (item 2); `paging.test.ts` progress text (item 8); `graveyard.dom.test.ts` heading visibility and progress placement (items 4, 8) and whole view-model comparisons (item 7); `viewmodel.test.ts` whole view-model comparisons (item 7); `demo-slot.dom.test.ts` card attributes (item 8). `markdown-dom.dom.test.ts` needs no change because `preview-content.ts` is not edited.
- Automated checks for 3.2, 3.5 and 5.8 are rule-level proxies. Only task 10.1 measures them.
- Tasks that touch the same file sit in different waves to avoid conflicts.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3.1", "4.3", "5.1", "6.1", "6.3"] },
    { "id": 1, "tasks": ["1.2", "2.2", "3.3", "5.2", "5.6", "6.6", "6.7"] },
    { "id": 2, "tasks": ["2.3", "3.2", "3.4", "6.4", "6.8"] },
    { "id": 3, "tasks": ["3.5", "3.6", "4.1"] },
    { "id": 4, "tasks": ["4.2", "5.3", "5.5", "6.9"] },
    { "id": 5, "tasks": ["5.4", "5.7", "6.5"] },
    { "id": 6, "tasks": ["6.2", "6.10"] },
    { "id": 7, "tasks": ["7.1"] },
    { "id": 8, "tasks": ["9.1"] },
    { "id": 9, "tasks": ["10.1"] }
  ]
}
```
