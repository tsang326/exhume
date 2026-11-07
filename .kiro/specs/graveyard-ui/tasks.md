# Implementation Plan: Graveyard UI

## Overview

The plan builds the web page of Exhume bottom-up, in the order the design lays out. It starts with build and configuration changes and a build smoke check (task 1), then the pure logic modules in `src/web/logic/` with their fast-check properties (tasks 2 to 7), then the source scans and test support (task 9), the worker handler and glue (task 11), the DOM modules (task 13), `index.html` and `style.css` (task 15), and final integration and robustness checks (task 17). A manual task for the user (task 19) and a blocked, optional group of DOM tests (task 20) close the plan. Checkpoints follow each major group.

All code is TypeScript under `strict`, with no UI framework. Tests use Vitest 3.2.4 and fast-check 4.3.0. Property callbacks return nothing or a boolean and never call `expect(...)`. Every property is tagged `// Feature: graveyard-ui, Property N: <title>` and runs at least 100 times, using the `FC_RUNS_MULTIPLIER` convention from `src/test-support/runs.ts`. Imports from the core use only `src/core/fat12/index` and `src/core/formats/index`.

Checkpoint tasks are the explicit gates. Each one runs `npm run typecheck`, `npm test`, `npm run test:fuzz` and `npm run build`, and `git diff --stat 4d7f5e7 -- src/core`, which must print nothing.

## Tasks

- [x] 1. Build and configuration groundwork
  - [x] 1.1 Apply the build and configuration changes with placeholders for the smoke check
    - Design: "Build and script changes", "CSP, Vite output and the network rule", "Module layout"
    - Create `vite.config.ts`: `defineConfig({ build: { modulePreload: { polyfill: false }, assetsInlineLimit: 0 }, worker: { format: 'es' } })`. Set no `base` (it stays `'/'`).
    - Create `src/web/logic/tsconfig.json`: a copy of the options in `src/core/tsconfig.json` with `lib: ["ES2022"]` (no DOM), `types: []`, strict, `include: ["./**/*.ts"]`, `exclude: ["./**/*.test.ts"]`
    - Create `src/web/worker/tsconfig.json`: same options with `lib: ["ES2022", "WebWorker"]`, `types: []`, `include: ["./**/*.ts"]`, `exclude: ["./**/*.test.ts"]`
    - Root `tsconfig.json`: add `"exclude": ["src/web/worker/disk.worker.ts"]` and change nothing else
    - `package.json`: change only the `typecheck` script to `tsc --noEmit && tsc -p src/core/tsconfig.json --noEmit && tsc -p src/web/logic/tsconfig.json --noEmit && tsc -p src/web/worker/tsconfig.json --noEmit`. Do not touch `dependencies` or `devDependencies`, and do not install anything.
    - `vitest.config.ts`: add `'**/*.dom.test.ts'` to `exclude` (it stays until a DOM library is approved)
    - Create `src/web/logic/limits.ts` with every constant from the design (it imports `MAX_IMAGE_BYTES`, `MAX_TOTAL_ENTRIES`, `MAX_FILE_OUTPUT_BYTES` from `../../core/fat12/index` and re-exports them). This is the first real logic module and keeps the logic project non-empty.
    - Create a stub worker entry `src/web/worker/disk.worker.ts` that only posts a fixed marker string `'graveyard-ui-stub-worker-marker'` from `self.onmessage`. Task 11.2 replaces it.
    - Replace the placeholder `src/main.ts` with a stub that imports `./style.css` and creates `new Worker(new URL('./web/worker/disk.worker.ts', import.meta.url), { type: 'module' })` (the literal pattern the design requires)
    - Replace `index.html` with a minimal placeholder: `<meta charset>`, then the exact CSP meta tag from the design as the next element, a title, `lang="en"`, one `h1`, and the module script for `/src/main.ts`. Task 15.1 writes the full page.
    - _Requirements: 2.1, 2.2, 2.3, 2.5, 14.8, 15.7, 15.8, 15.10, 15.11, 15.12_

  - [x] 1.2 Run the build smoke check
    - Design: "Vite constraints (checked against the placeholder build)", "Research notes"
    - Run `npm run build` and require exit code 0
    - Worker is a separate chunk: `ls dist/assets | grep -E '^disk\.worker-.*\.js$'` prints exactly one file; `grep -l 'graveyard-ui-stub-worker-marker' dist/assets/*.js` lists only that `disk.worker-*.js` file (the marker is not inside the entry chunk); `grep -l 'disk.worker' dist/assets/index-*.js` shows the entry chunk references the worker file by name
    - No inline script: `grep -nEi '<script' dist/index.html` shows only tags that carry `src=`, and `grep -nEi '<script[^>]*>[[:space:]]*[^[:space:]<]' dist/index.html` prints nothing
    - No inline style or handler: `grep -nEi '<style|[[:space:]]style=|[[:space:]]on[a-z]+=' dist/index.html` prints nothing
    - No `data:` in the HTML or the CSP: `grep -n 'data:' dist/index.html` prints nothing, and `grep -c 'Content-Security-Policy' dist/index.html` prints `1`
    - No `unsafe-` in the CSP: `grep -n 'unsafe-' dist/index.html` prints nothing
    - No `data:` URL in emitted CSS or JS: `grep -rnE "url\(['\"]?data:|data:[a-z]+/[a-z0-9.+-]+[;,]" dist/assets` prints nothing. Also run `grep -rnoE '.{0,20}data:.{0,20}' dist/assets` and review every hit; a hit that is not a URL (for example an object key) is noted in the task result, any real `data:` URL fails the check
    - If a check fails, fix the configuration in 1.1 and repeat; record the final outcome of each check
    - _Requirements: 2.2, 2.3, 2.5, 11.1, 14.8, 15.12_

- [x] 2. Worker protocol, validation and request ids
  - [x] 2.1 Create `logic/protocol.ts` and `logic/validate.ts`
    - Design: "Worker_Protocol: `logic/protocol.ts`", "Validation and request ids"
    - `protocol.ts`: `RequestKind`, `OpenRequest`, `ExhumeRequest`, `WorkerRequest`, `ExhumeResult`, `OpenedResponse`, `ExhumedResponse`, `FailureCause`, `FailedResponse`, `WorkerResponse`, `OUTPUT_BY_KIND`. Plain data only (objects, arrays, strings, numbers, booleans, `null`, `Uint8Array`).
    - `validate.ts`: `Parsed<T>`, `isRequestId` (non-negative safe integer), total `parseResponse` and `parseRequest` that check the full shape including every `Grave` field and enum value, bound the grave count by `MAX_TOTAL_ENTRIES` and the warning count, require finite numbers, and never throw (including objects with throwing getters)
    - Reserved id `0` is accepted by `parseResponse` for `failed` / `invalid-request`
    - _Requirements: 3.3, 3.4, 3.7, 3.17, 3.18_

  - [x]* 2.2 Write property tests for validation
    - **Property 7: Response validation is total**
    - **Property 8: Valid messages survive validation and structured cloning**
    - In `src/web/logic/validate.test.ts`; Property 8 compares `structuredClone` output and `parse*` of the clone with the original
    - **Validates: Requirements 3.3, 3.4, 3.7, 3.18**

  - [x] 2.3 Create `logic/requests.ts`
    - Design: "Validation and request ids", "Main-thread bytes, transfer and recovery"
    - `createRequestTracker()` with `begin`, `accept`, `latest`, `supersedeAll` (the counter keeps growing; ids start at 1), plus `kindOfResponse` and `isCurrent`
    - `buildOpenMessage(held, id)`: copy with `held.slice()` and list that copy's buffer for transfer; `held` stays unchanged
    - `transferablesOf(response)`: distinct whole buffers behind every `Uint8Array` in a response
    - _Requirements: 3.5, 3.6, 3.8, 3.15, 3.17_

  - [x]* 2.4 Write property tests for request ids and transfer
    - **Property 9: Request ids only grow and only the latest response is accepted**
    - **Property 10: Open messages copy before they transfer**
    - In `src/web/logic/requests.test.ts`
    - **Validates: Requirements 3.5, 3.6, 3.8, 3.15**

- [x] 3. Size and text helpers
  - [x] 3.1 Create `logic/size.ts` and `logic/text.ts`
    - Design: "Size and text helpers"
    - `size.ts`: `checkImageSize(bytes, cap?)` with messages exactly as in Requirements 4.3 and 4.4; `formatBytes` (divisor 1,024, unit chosen by the rounded value, no unit above MB, never throws)
    - `text.ts`: `toLabel` (prefix cut at `LABEL_CAP`, drop a trailing lone high surrogate, markup characters unchanged), `lastSegment`, `segmentCount`, `formatDate` (length 19, digits and ranges checked, no `Date`, `'no date'` otherwise)
    - _Requirements: 1.8, 4.3, 4.4, 4.10, 4.11, 6.5, 6.6, 6.7, 6.8, 6.9, 6.19_

  - [x]* 3.2 Write property tests for size checks and formatting
    - **Property 13: The size check accepts exactly 1 through the cap**
    - **Property 14: Size formatting has the stated shape**
    - In `src/web/logic/size.test.ts`; include the boundary examples `1`, `MAX_IMAGE_BYTES`, `MAX_IMAGE_BYTES + 1` and `1_048_575`
    - **Validates: Requirements 4.3, 4.4, 4.10, 4.11, 4.13, 6.6**

  - [x]* 3.3 Write property tests for labels and dates
    - **Property 1: Visible labels are bounded and unchanged**
    - **Property 16: Date formatting is total and time-zone free**
    - In `src/web/logic/text.test.ts`; add examples for `lastSegment`, `segmentCount` and surrogate-pair cuts
    - **Validates: Requirements 1.8, 6.7, 6.8, 6.9, 6.19**

- [x] 4. View model and paging
  - [x] 4.1 Create `logic/viewmodel.ts` and `logic/paging.ts`
    - Design: "View model and paging"
    - `ItemViewModel`, `VolumeSummary`, `toItemViewModels`, `summarize`, `warningLines`; `visual` is `tombstone` only for alive; `action: 'exhume'` only for kind file and state other than lost; `(unnamed)` and `(no label)` placeholders; core `reason` carried unchanged
    - `paging.ts`: `visibleCount`, `hasMore`, `progressText` ("X of Y")
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.10, 6.11, 6.12, 6.13, 6.14, 6.15, 6.16, 6.17, 6.18, 7.1, 7.2, 7.3, 7.4, 7.7, 7.9, 9.16_

  - [x]* 4.2 Write property tests for the view model
    - **Property 17: The view-model mapping preserves every grave**
    - **Property 18: The summary and warning lines match the report**
    - In `src/web/logic/viewmodel.test.ts`; build reports with the existing `src/test-support/fat12` arbitraries where helpful; include the size 4,294,967,295, a `null` date and an unparseable date
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.10, 6.11, 6.12, 6.13, 6.14, 6.15, 6.17, 6.18, 6.19, 9.16**

  - [x]* 4.3 Write property test for paging
    - **Property 19: Paging shows `min(total, pages x 200)` and grows by at most one page**
    - In `src/web/logic/paging.test.ts`; add the 4,096-entry example (21 pages, 20 activations)
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.7, 7.9**

- [x] 5. Markdown, CSV, hex, file names, contrast and the preview model
  - [x] 5.1 Create `logic/markdown.ts`
    - Design: "Safe_Markdown_Subset re-verification", "Markdown: `logic/markdown.ts`"
    - `parseMarkdown`, `truncateForPreview`, `plainText`, the node types and `MarkdownModel` with `dropped`
    - Iterative and linear: lines, blocks, then inline events with the two-slot marker stack (so `***x***` closes in the right order), then pairing that turns unclosed markers back into literal text; escapes as listed in the design; a spaces-only line is ordinary text; a line exactly `---` is a thematic break
    - Conservation law: `sum(text value lengths) + dropped == input.length`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.9, 5.10_

  - [x]* 5.2 Write the Markdown emitter and property tests
    - **Property 20: The Markdown parser is total and only produces safe nodes**
    - **Property 21: No input character is lost or invented**
    - **Property 22: Converter-shaped Markdown parses back to its plain text and structure**
    - **Property 23: Preview truncation keeps the head and flags it**
    - Create `src/test-support/web/md-emitter.ts` (converter-shaped generator with known plain text, paragraph count and node positions), then `src/web/logic/markdown.test.ts`; add the doubling-time example (best of three runs, skipped with a note when the base time is under 5 ms)
    - **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.6, 5.7, 5.8, 5.9, 5.10**

  - [x] 5.3 Create `logic/csv-display.ts`
    - Design: "CSV display parser: `logic/csv-display.ts`"
    - `CsvTable` and `parseCsv(text, maxRows?, maxCols?)`: one-pass RFC 4180 state machine; `""` input yields zero rows; a trailing terminator adds no extra record; an unterminated quote takes the rest of the input; counting continues past the display limits so `totalRows` and `totalCols` are real
    - _Requirements: 9.8, 9.9_

  - [x]* 5.4 Write the CSV reference writer and property tests
    - **Property 24: CSV display parsing round-trips what the reference writer writes**
    - **Property 25: CSV display limits report real sizes**
    - Create `src/test-support/web/csv-writer.ts` (own RFC 4180 writer; the core's `csvCell` and `csvRow` are not exported, so the core file is not imported), then `src/web/logic/csv-display.test.ts`; add the RFC 4180 examples from the design
    - **Validates: Requirements 9.8, 9.9**

  - [x] 5.5 Create `logic/hex.ts`
    - Design: "Hex view: `logic/hex.ts`"
    - `HexRow` and `hexRows(bytes, limit?)`: 8-digit offsets, hex column padded to 47 characters, text column maps `0x20`..`0x7E` to itself and everything else to `.`
    - _Requirements: 9.12, 9.19_

  - [x]* 5.6 Write property test for the hex view
    - **Property 26: The hex view has the stated shape**
    - In `src/web/logic/hex.test.ts`
    - **Validates: Requirements 9.12, 9.19**

  - [x] 5.7 Create `logic/filename.ts`
    - Design: "File name sanitizer: `logic/filename.ts`"
    - `sanitizeFileName(diskName, extension)` implementing steps (a) to (h) of Requirement 10.4 with plain loops (no regex over input); stem falls back to `grave`; reserved stems such as `CON` pass through
    - _Requirements: 9.10, 10.4, 10.5, 10.6, 10.7_

  - [x]* 5.8 Write property test for the sanitizer
    - **Property 27: The file name sanitizer always yields a safe name**
    - In `src/web/logic/filename.test.ts` with a step-by-step reference implementation; examples `a.exe`, `CON.md`, `...` and 300-character names
    - **Validates: Requirements 10.4, 10.5, 10.6, 10.7, 9.10**

  - [x] 5.9 Create `logic/contrast.ts`
    - Design: "Small pure helpers: `focus-order.ts`, `effects-math.ts`, `contrast.ts`"
    - `Rgb`, `parseHexColor` (`#rgb` and `#rrggbb` only), `relativeLuminance`, `contrastRatio` (WCAG 2.x, symmetric, 1 to 21), `compositeOver`
    - _Requirements: 11.4, 12.15_

  - [x]* 5.10 Write property test for contrast
    - **Property 34: The contrast function is a pure WCAG ratio**
    - In `src/web/logic/contrast.test.ts`
    - **Validates: Requirements 11.4, 12.15**

  - [x] 5.11 Create `logic/preview-model.ts`
    - Design: "Preview model: `logic/preview-model.ts`"
    - `DownloadSpec`, `PreviewBody`, `PreviewModel`, `ExhumeOutcome`, `buildPreviewModel(item, outcome)`: warnings are read warnings then conversion warnings (all, in order); `partialNote` is the core reason only for partial items; PNG `alt` is `sanitizeFileName(name, '.png')`; always a raw `.bin` download of the full bytes with `application/octet-stream` when the read worked; converted download from `OUTPUT_BY_KIND`; read failure gives body `none`, the core error text and no downloads
    - _Requirements: 5.10, 9.7, 9.8, 9.10, 9.12, 9.13, 9.14, 9.15, 9.17, 9.18, 10.1, 10.2, 10.3_

  - [x]* 5.12 Write property test for the preview model
    - **Property 28: The preview model matches the worker result**
    - In `src/web/logic/preview-model.test.ts`
    - **Validates: Requirements 9.7, 9.10, 9.12, 9.13, 9.14, 9.15, 9.17, 9.18, 10.1, 10.2, 10.3**

- [x] 6. Demo validation and the demo registry
  - [x] 6.1 Create `logic/demo-validate.ts`
    - Design: "Demo validation: `logic/demo-validate.ts`, `demos.ts`"
    - `DemoEntryShape`, `DemoCheck`, `validateDemoDisk` (pure, total, plain loops; id 1 to 64, title 1 to 80, description 1 to 200 without `\r` or `\n`, URL rules for `/disks/`, `//`, scheme, backslash, `..` segment, `%2e` and `%2f` in any case, non-empty file part), `selectValidDemos` (drops invalid entries and later duplicate ids, keeps order). It does not import `demos.ts`.
    - _Requirements: 8.3, 8.4, 8.5, 8.6_

  - [x]* 6.2 Write property test for demo validation
    - **Property 30: Demo entries are validated and de-duplicated**
    - In `src/web/logic/demo-validate.test.ts`
    - **Validates: Requirements 8.3, 8.4, 8.5, 8.6**

  - [x] 6.3 Create `src/web/demos.ts`
    - Design: "Demo validation: `logic/demo-validate.ts`, `demos.ts`", "CSP, Vite output and the network rule"
    - `DemoDisk`, `DEMO_REGISTRY` (empty, documented as the extension point for spec 5), `DemoLoad`, `loadDemoBytes(demo, fetchImpl?, timeoutMs?)`: revalidate first (`invalid`, no request); `fetch` with `credentials: 'omit'`, `redirect: 'error'`, `referrerPolicy: 'no-referrer'`, `cache: 'no-store'` and an `AbortController` (10 s, `timeout`); `http` for non-2xx; `Content-Length` over the cap is `too-large` before reading; stream with a running byte count; `arrayBuffer()` fallback when `body` is null; zero bytes is `empty`
    - This is the only file in the Web_Sources that may name `fetch`; it uses no other network API
    - _Requirements: 8.1, 8.2, 8.10, 8.12, 8.13, 8.14, 13.2, 13.8_

  - [x] 6.4 Write example tests for `demos.ts`
    - In `src/web/demos.test.ts` with a fake `fetch` returning `ReadableStream` bodies and fake timers: `credentials: 'omit'` and the validated URL are passed; the 10 s abort gives `timeout`; non-2xx gives `http`; a header over the cap gives `too-large` without reading; a null body uses the fallback; an invalid entry sends no request
    - _Requirements: 8.12, 8.14, 13.8_

  - [x]* 6.5 Write property test for demo loading
    - **Property 31: Demo loading never accumulates more than the cap**
    - In `src/web/demos.props.test.ts`; chunk sequences with and without `Content-Length`, including a lying header
    - **Validates: Requirements 8.12, 8.14**

- [x] 7. Drop, rising gate, focus order and effects math
  - [x] 7.1 Create `logic/drop.ts`
    - Design: "Drop classification: `logic/drop.ts`"
    - `DropInfo`, `DropDecision`, `classifyDrop`: no file or a directory first item is a `reject` with the "please drop a disk image file" message; more than one file is `use-first` with `ignoredOthers: true`
    - _Requirements: 4.5, 4.6, 4.9_

  - [x]* 7.2 Write property test for drop classification
    - **Property 15: Drops are classified by what they carry**
    - In `src/web/logic/drop.test.ts`
    - **Validates: Requirements 4.5, 4.6, 4.9**

  - [x] 7.3 Create `logic/rise-gate.ts`
    - Design: "Rising gate: `logic/rise-gate.ts`", "Exhume sequence"
    - `RiseEvent`, `RiseState`, `RiseStep`, `startRise(reduced)`, `stepRise(state, event)`: `show` at most once; `error` shows at once and stops the animation; `result` shows when the animation is done or reduced, else waits for `animation-end`; `cancel` stops and never shows
    - _Requirements: 9.3, 9.4, 9.5, 9.6_

  - [x]* 7.4 Write property test for the rising gate
    - **Property 32: The rising gate shows once, in time, and never waits needlessly**
    - In `src/web/logic/rise-gate.test.ts`
    - **Validates: Requirements 9.3, 9.4, 9.5, 9.6**

  - [x] 7.5 Create `logic/focus-order.ts`
    - Design: "Small pure helpers"
    - `nextFocusIndex(count, current, backwards)`: wraps; `-1` current means outside the list; count 0 gives `-1`
    - _Requirements: 12.8_

  - [x]* 7.6 Write property test for focus order
    - **Property 33: Tab focus wraps inside the dialog**
    - In `src/web/logic/focus-order.test.ts`
    - **Validates: Requirements 12.8**

  - [x] 7.7 Create `logic/effects-math.ts`
    - Design: "Small pure helpers", "Canvas fog and lantern"
    - `canvasBacking(cssWidth, cssHeight, dpr)` (integers, 1 to 1920 by 1 to 1080, aspect ratio kept when scaled, safe for zero, huge and fractional input) and `frameDue(lastMs, nowMs)` (true when `now - last >= 1000 / FX_MAX_FPS`)
    - _Requirements: 11.6_

  - [x]* 7.8 Write property test for canvas size and frame rate
    - **Property 35: Canvas size and frame rate stay within budget**
    - In `src/web/logic/effects-math.test.ts`
    - **Validates: Requirements 11.6**

- [x] 8. Checkpoint - Pure logic complete
  - Run `npm run typecheck`, `npm test`, `npm run test:fuzz` and `npm run build`. All must exit 0.
  - Run `git diff --stat 4d7f5e7 -- src/core`. It must print nothing (empty).
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Source scans and test support
  - [x] 9.1 Create `src/test-support/web/scan.ts`
    - Design: "Phrase scan helper: comment-aware tokenizer", Testing Strategy (`sources.scan.test.ts`)
    - Scanners that return `{ file, line, name }` violations: HTML sink names (the sink names live only in this file, never in a Web_Source; the scan does not skip comments or strings); network API names with the allow-list rule (accepts `fetch` only in `src/web/demos.ts` when the allow-list is exactly that one file; rejects a network name in any other file, an allow-list of two or more files, and any network name other than `fetch` in `demos.ts`); storage and cookie names in every file; forbidden phrases in string and template literals via `extractLiterals(source)` (hand-written single-pass tokenizer: code, line comment, block comment, single, double and template states, a brace-depth stack for `${}`, escapes, 1-based line numbers; regex literals are a documented limitation) and in the visible text of `index.html` (tags, comments, `script` and `style` contents stripped); `src` and `alt` assignments outside `setSrcBlob` in `dom/h.ts` (`.alt`, `.src`, `'alt'`, `'src'`, `setAttribute`); `.style.`, `cssText`, `createElement('style')` and `setAttribute('style'`; import-specifier resolver (relative, extension, directory form, `import type`, dynamic `import()`, `new URL()`) that allows only `src/core/fat12/index` and `src/core/formats/index`; main-thread files importing `openDisk`, `readDisk`, `convertAuto`, `convertWordStar`, `convertDBase`, `convertPcx` or `encodePng`; DOM global names in `logic/` files; `expect(` inside a `fc.property` callback in web tests
    - Violation messages print the file path, the 1-based line number and the name
    - _Requirements: 1.1, 1.3, 1.5, 1.6, 1.7, 2.4, 3.1, 3.2, 13.2, 13.4, 13.5, 13.6, 13.7, 15.1, 15.2, 15.3, 15.4_

  - [x] 9.2 Create `html-scan.ts`, `csp.ts` and `css-scan.ts` in `src/test-support/web/`
    - Design: Testing Strategy (`page.static.test.ts`), "Layers and z-index plan", "Accessibility and responsive layout"
    - `html-scan.ts`: parse a static HTML string into the facts the page test needs (CSP meta count and position, script, link and style elements, `on*` and `style` attributes, `lang`, title, `h1` count, text of notes, visible text for the phrase scan)
    - `csp.ts`: parse a CSP string into directives and check the exact set, `unsafe-*`, `data:`, `*` and remote hosts
    - `css-scan.ts`: read `--pair-*-fg` and `--pair-*-bg` custom properties and check them with `contrastRatio` (3:1 for names ending `-large` or `-ui`, 4.5:1 otherwise); check `.fx-*` rules for `pointer-events: none`, z-index below `.content` and opacity at most 0.6; composite an over-text layer with `compositeOver`; layout rules (no fixed width over 100% on page-level elements, `overflow-wrap` or truncation on file-name elements); reduced-motion block; no external or `data:` `url(`; no `.style.` use
    - _Requirements: 2.1, 2.2, 2.3, 11.1, 11.2, 11.3, 11.4, 11.7, 12.12, 12.14, 12.15, 12.16, 12.17_

  - [x] 9.3 Write `sources.scan.test.ts` with the real scans and self-tests
    - In `src/web/sources.scan.test.ts`
    - Self-tests: a fixture with every sink name reports one violation per name and a clean fixture reports none; the network scan accepts `fetch` in `src/web/demos.ts` and fails for another file, for an allow-list of two files and for another network API in `demos.ts`; a forbidden phrase in a string literal, in a template text part, after a comment marker inside a string, and inside a `${}` expression string is reported; the same phrase only in a `//` or `/* */` comment is not; an escaped quote does not end a literal; a stray `img.alt = x` is flagged
    - Real scans over every Web_Source file: sinks, network and storage names, forbidden phrases (literals and `index.html` text), `src` and `alt` only through `setSrcBlob`, core import rule (including test files under `src/web/`), main-thread files do not import the converter or reader functions, `logic/` files reference no DOM global, no `.style.` / `cssText` / `createElement('style')`, no `expect(` inside `fc.property` callbacks
    - On a violation, print the file path, line number and name
    - _Requirements: 1.5, 1.6, 1.7, 2.4, 3.1, 3.2, 13.2, 13.4, 13.5, 13.6, 13.7, 15.1, 15.2, 15.3, 15.4_

  - [x]* 9.4 Write property tests for the scans
    - **Property 2: The sink scan finds every sink and reports where**
    - **Property 3: The sink scan accepts clean text**
    - **Property 4: Network API names are confined to one allow-listed file**
    - **Property 5: Forbidden phrases are found in literals in any letter case, and ignored in comments**
    - **Property 6: Core imports are limited to the two index files**
    - In `src/web/sources.scan.props.test.ts` (a separate file from 9.3 so the two tasks never write the same file)
    - **Validates: Requirements 1.1, 1.5, 1.6, 1.7, 3.2, 13.2, 13.4, 13.5, 13.6, 13.7, 15.3, 15.4**

- [x] 10. Checkpoint - Scans and test support in place
  - Run `npm run typecheck`, `npm test`, `npm run test:fuzz` and `npm run build`. All must exit 0.
  - Run `git diff --stat 4d7f5e7 -- src/core`. It must print nothing (empty).
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Worker handler and glue
  - [~] 11.1 Create `worker/disk-handler.ts`
    - Design: "Worker design", "Worker handler: `worker/disk-handler.ts`, `worker/disk.worker.ts`"
    - `WorkerSession { handle: DiskHandle | null }`, `createSession()`, total `handleRequest(session, raw)` that never throws and mutates only `session.handle`, and only on a successful `open`
    - `open`: `parseRequest`, `openDisk(image)`, install the new handle (this releases the old one); a report with geometry source `none` is a success; a throw becomes `failed` / `internal` and leaves the handle alone
    - `exhume`: no handle gives `failed` / `no-disk`; a `graveId` that is not an integer in `0..files.length-1` gives `failed` / `not-found`; look the grave up in `handle.report.files` (never use a grave from the message); `handle.readBytes(grave)`; a not-ok read gives `failed` / `read` with the core error; bound `raw` with `subarray` to `MAX_FILE_OUTPUT_BYTES`; `convertAuto(raw, lastSegment(grave.path))`; map markdown, csv and png (copy so the array owns its whole buffer) and map `ok: false` to `{ kind: 'raw', error }`
    - Unparseable requests answer `failed` with id `0` and cause `invalid-request`; fixed messages never include disk text
    - Imports from the core only `../../core/fat12/index` and `../../core/formats/index`
    - _Requirements: 3.1, 3.2, 3.9, 3.10, 3.11, 9.12, 9.13, 9.14, 9.15, 14.3, 14.4, 14.6_

  - [~] 11.2 Replace the stub with the real `worker/disk.worker.ts` glue
    - Design: "Worker handler: `worker/disk.worker.ts`"
    - `self.onmessage = (e) => { const res = handleRequest(session, e.data); self.postMessage(res, transferablesOf(res)); }` and nothing else; no logic in the glue
    - Remove the stub marker; confirm the worker tsconfig and the root exclusion still typecheck
    - _Requirements: 3.1, 3.8, 3.10, 14.6_

  - [ ]* 11.3 Write property tests for the worker handler
    - **Property 11: The worker keeps one handle and always answers once**
    - **Property 12: Exhume is bounded and safe for every id**
    - In `src/web/worker/disk-handler.test.ts`; generated disks from `src/test-support/fat12` with WordStar, dBase, PCX and unknown files; random, empty, truncated and over-cap images
    - **Validates: Requirements 3.9, 3.10, 3.11, 14.3, 14.4, 14.6**

- [~] 12. Checkpoint - Worker handler complete
  - Run `npm run typecheck`, `npm test`, `npm run test:fuzz` and `npm run build`. All must exit 0.
  - Run `git diff --stat 4d7f5e7 -- src/core`. It must print nothing (empty).
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 13. DOM modules
  - [~] 13.1 Create `dom/h.ts`
    - Design: "DOM helper: `dom/h.ts`"
    - `AttrName`, closed `AllowedTag` union, `h(tag, attrs?, ...children)` (string children become `Text` nodes), `clear(node)` (removeChild loop), `setDownloadHref(a, blobUrl, safeFileName)`, and `setSrcBlob(img, blobUrl, safeName)`, the only place that sets `src` and `alt`; it throws when `safeName` does not match `[A-Za-z0-9._-]{1,64}`
    - No HTML sink anywhere; `style`, `srcdoc`, `on*` and `alt` are not in `AttrName`
    - _Requirements: 1.2, 1.3, 1.4, 9.10_

  - [~] 13.2 Create `dom/status.ts` and `dom/errors.ts`
    - Design: "Status, errors, effects, rising"
    - `StatusRegion` with `set` and `clear` (`textContent` on the `role="status"` element); `installGlobalErrorHandlers(status)` for window `error` and `unhandledrejection`: fixed message (at most 300 characters, no page text echoed), touches neither the graveyard nor the preview
    - _Requirements: 4.12, 12.11, 14.1_

  - [~] 13.3 Create `dom/blob-urls.ts`
    - Design: "Blob URLs, downloads"
    - `BlobUrlApi`, `BlobUrlManager` (`create`, `isOwned`, `revokeAll`, `liveCount`), `createBlobUrlManager(api?)` wrapping `URL.createObjectURL` and `revokeObjectURL`; revoking twice is harmless
    - _Requirements: 1.4, 9.11_

  - [ ]* 13.4 Write property test for the Blob URL manager
    - **Property 29: Every Blob URL is revoked and only owned URLs are linkable**
    - In `src/web/dom/blob-urls.test.ts` with a fake `BlobUrlApi` (no DOM needed)
    - **Validates: Requirements 1.4, 9.11**

  - [~] 13.5 Create `dom/download.ts`
    - Design: "Blob URLs, downloads"
    - `Downloader.start(spec)`: `Blob` with the spec MIME, URL through the manager, temporary `a[download][href]` via `setDownloadHref`, click, remove, schedule revoke after `DOWNLOAD_REVOKE_MS` (500 ms); any thrown error returns `{ ok: false, message }` and starts nothing
    - _Requirements: 10.1, 10.8, 10.9_

  - [~] 13.6 Write example tests for the downloader
    - In `src/web/dom/download.test.ts` with a fake URL api and scheduler: revoke delay is at most 1,000 ms; Blob creation failure starts nothing and returns the failure
    - _Requirements: 10.8, 10.9_

  - [~] 13.7 Create `dom/intake.ts`
    - Design: "Intake: `dom/intake.ts`"
    - `createIntake(deps)` with `attach` and `detach`: document-level `dragenter`/`dragover`/`drop` with `preventDefault`; picker button and hidden `input[type=file]`; `classifyDrop`; `checkImageSize(file.size)` before any read; `await file.arrayBuffer()` guarded by a monotonically increasing token (the newest choice wins); length check after the read (1..cap) with "changed while being read"; "could not be read" on failure; `input.value` cleared after each pick; messages containing a file name use `toLabel` and `textContent` only
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.12, 4.13, 4.14, 12.1_

  - [~] 13.8 Create `dom/graveyard.ts`
    - Design: "Graveyard renderer: `dom/graveyard.ts`"
    - `createGraveyardView(root, onActivate)` with `show`, `showMore`, `setActionsEnabled`, `itemElement`, `headingElement`
    - Item markup exactly as designed: `button.grave-action` only for exhumable files; directories and lost graves are plain `div.grave-body` with no button and no `tabindex`; state word, reason and markers as text; summary, "(no label)", empty-disk and unreadable-disk messages, collapsed `<details>` warnings list; paging appends only new `li` nodes, shows "X of Y" and the "Show more" button, hides it at the end, and moves focus to the first new item (programmatic `tabindex="-1"` on its `li` when it has no control)
    - All text through `h`
    - _Requirements: 1.2, 6.1, 6.2, 6.3, 6.4, 6.5, 6.10, 6.11, 6.12, 6.13, 6.14, 6.15, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.8, 7.9, 9.16, 12.2, 12.10_

  - [~] 13.9 Create `dom/preview-content.ts` and `dom/focus-trap.ts`
    - Design: "Preview dialog: `dom/preview.ts`, `dom/preview-content.ts`, `dom/focus-trap.ts`"
    - `buildMarkdown(model)` creates only `p`, `br`, `strong`, `em`, `hr` and text nodes; `buildCsvTable(table)` (wrapper div with own scroll, first stored row as `th`, the rest `td`, "truncated" note with real row and column counts); `buildHexView(rows)` (own scroll)
    - `trapTab(root, e)` wraps focus with `nextFocusIndex` over visible focusable elements
    - Never creates `a`, `img`, `iframe`, `object`, `embed`, `form`, `script` or `link`
    - _Requirements: 5.5, 5.11, 9.8, 9.12, 12.8_

  - [~] 13.10 Create `dom/preview.ts`
    - Design: "Preview dialog: `dom/preview.ts`, `dom/preview-content.ts`, `dom/focus-trap.ts`"
    - `createPreviewPanel(deps)` with `open`, `close`, `isOpen`: `div.preview-backdrop` > `div.preview[role=dialog][aria-modal=true][aria-labelledby]`; header with `h2[tabindex=-1]` and close button; partial note, error, warnings list, body, shortened-note, download buttons footer; background wrapper gets `inert`; Escape closes; focus to the heading on open and back to the opener on close, or to the graveyard heading when the opener is gone; Blob URLs revoked on close and when another preview opens; the PNG `img` comes from `setSrcBlob` only
    - _Requirements: 5.10, 9.7, 9.8, 9.10, 9.11, 9.12, 9.13, 9.14, 9.15, 9.17, 9.18, 9.20, 10.1, 12.5, 12.6, 12.7, 12.8, 12.9_

  - [~] 13.11 Create `dom/demo-slot.ts`
    - Design: "Demo validation: `logic/demo-validate.ts`, `demos.ts`", Requirement 8
    - Labelled container ("Demo disks" plus an accessible name) built from `selectValidDemos(DEMO_REGISTRY)`; hidden entirely with zero valid entries and no error; native buttons showing title and description as text; buttons disabled with a loading message while a demo loads, re-enabled with a cause message on failure; bytes go to the same `onBytes` pipeline as a dropped file
    - _Requirements: 8.6, 8.7, 8.8, 8.9, 8.10, 8.11, 8.12_

  - [~] 13.12 Create `dom/effects.ts` and `dom/rising.ts`
    - Design: "Rendering and effects", "Rising animation"
    - `createEffects(host)`: one `canvas.fx-canvas[aria-hidden]` with at most `FX_MAX_SHAPES` blobs per frame, `canvasBacking` sizing, `requestAnimationFrame` gated by `frameDue`, `visibilitychange` stop and resume, `matchMedia` reduced-motion change applied immediately (one static frame when on), `getContext('2d') === null` removes the canvas silently; class toggles only, no `style.*`
    - `playRise(item, reduced)`: `.is-rising` and `span.rise-ghost[aria-hidden]` added synchronously, `RISE_MS` timer, cleanup in `finally` so no animated element remains, instant resolve when reduced, `cancel()`
    - _Requirements: 11.1, 11.2, 11.5, 11.6, 11.7, 11.8, 11.9, 11.10, 9.1, 9.5_

  - [~] 13.13 Create `dom/worker-client.ts`
    - Design: "Worker client: `dom/worker-client.ts`", "Main-thread bytes, transfer and recovery"
    - `Settled<T>`, `WorkerClient` with `open`, `exhume`, `cancel`, `supersedeAll`, `hasPending`, `dispose`, and `createWorkerClient(factory?)` with an injectable worker factory
    - The client owns the request id source so ids keep growing across worker replacements; `message` events go through `parseResponse` then `tracker.accept`; `error`, `messageerror`, the 15 s open timer, the 30 s exhume timer and `cancel` each terminate the worker, call `supersedeAll`, resolve pending promises as `lost`, and create a new worker on the next request; `open` sends `buildOpenMessage` with the transfer list
    - _Requirements: 3.5, 3.6, 3.7, 3.8, 3.12, 3.13, 3.14, 3.15, 3.16, 3.17_

  - [~] 13.14 Write example tests for the worker client
    - In `src/web/dom/worker-client.test.ts` with an injected fake worker and fake timers: ids keep growing across a replacement; stale and invalid messages change nothing; `error`, `messageerror`, the 15 s open timeout, the 30 s exhume timeout and `cancel` each end as `lost` and the next request uses a new worker; `supersedeAll` resolves pending requests as `superseded`; the open request transfers a copy of the bytes
    - _Requirements: 3.5, 3.6, 3.7, 3.12, 3.13, 3.14, 3.15, 3.16_

  - [~] 13.15 Create `app.ts` and wire `main.ts`
    - Design: "App wiring and session: `app.ts`", "Session states (main thread)", "Data kept and released", Error Handling table
    - `startApp()`: find the elements declared in `index.html`, install the error handlers, create the effects, worker client (worker created at boot), intake, demo slot, graveyard view and preview panel; `Session { phase, held, report, items }`
    - `openImage(bytes, name)`: the client transfers a copy; on `ok` revoke all Blob URLs, close the preview, `held = candidate`, render the new graveyard and reset paging (an unreadable disk with geometry `none` is a successful open); on `failed` keep the previous graveyard, preview and Blob URLs and name the failure kind; on `lost` set phase `lost`, keep the list, disable exhume controls and show **Reopen disk** (re-sends `held`)
    - `activate(item, opener)`: ignored unless phase is `open`; start `client.exhume`, `startRise`, `playRise` and the "rising" status text within 100 ms; apply `stepRise` on animation end, result, error and cancel; on `show` build the `PreviewModel` and open the preview; `lost` outcomes show the error and apply the lost-disk recovery
    - A busy message with a **Cancel** button while a request is pending; a new file supersedes pending requests
    - `src/main.ts`: `import './style.css'` and `startApp()` only
    - _Requirements: 3.12, 3.13, 3.14, 3.15, 3.16, 4.14, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.16, 9.20, 14.1, 14.2, 14.3, 14.5_

- [~] 14. Checkpoint - DOM modules complete
  - Run `npm run typecheck`, `npm test`, `npm run test:fuzz` and `npm run build`. All must exit 0.
  - Run `git diff --stat 4d7f5e7 -- src/core`. It must print nothing (empty).
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 15. Page markup and stylesheet
  - [~] 15.1 Write the full `index.html`
    - Design: "The policy", "Accessibility and responsive layout"
    - `<html lang="en">`, `<meta charset>`, then the single CSP meta tag with the exact policy from the design as the next element (before any `script`, `link` or `style`), non-empty `<title>`, module script for `/src/main.ts`
    - `header` with exactly one `h1` ("Exhume") and the privacy note "Your files stay in this browser. Nothing is uploaded."; `main` with the drop zone `section[aria-label]` ("Drop a floppy image here"), the visible **Choose a disk image** button and hidden file input, `p#status[role=status][aria-live=polite][aria-atomic=true]`, the demo slot container, the graveyard section; the preview root next to (not inside) the main wrapper that gets `inert`; `footer` with the honesty note naming "andete/disk-peek" as an existing browser tool for FAT12 images and deleted-entry recovery
    - No inline script, no `on*` attribute, no `style` attribute, no `<style>`; no forbidden phrase in the visible text
    - _Requirements: 2.1, 2.2, 2.3, 8.7, 8.8, 12.1, 12.9, 12.10, 12.14, 13.1, 13.3, 13.4_

  - [~] 15.2 Write `src/style.css`
    - Design: "Visual identity", "Layers and z-index plan", "Tombstone and open-grave art (CSS only)", "Rising animation", "Accessibility and responsive layout"
    - Design tokens as CSS custom properties; contrast pairs as literal hex values named `--pair-<id>-fg` and `--pair-<id>-bg` with the ids and values from the design table, and rules using `var(--pair-...)`
    - Layers: `.preview-backdrop` 100, `.content` 10, `.fx-glow` 1 (opacity 0.45), `.fx-canvas` 0 (opacity 0.5); every `.fx-*` rule has `pointer-events: none`; effective opacity at most 0.6
    - Tombstone and open-grave art in CSS only; `.is-rising` and `.rise-ghost` animate transform and opacity only (total at most 1,200 ms)
    - `:focus-visible` outlines with `--pair-focus-ui`; 320 px layout (`grid-template-columns: repeat(auto-fill, minmax(min(16rem, 100%), 1fr))`, `min-width: 0` on grid children, `overflow-wrap: anywhere` on `.grave-name`, `.grave-path` and `.preview-title`, `div.scroll-x { overflow-x: auto; max-width: 100% }`, no fixed pixel width on `html`, `body`, `#app`, `main` or `.content`)
    - `@media (prefers-reduced-motion: reduce)` sets animation and transition durations to 0
    - No `url(` to an external or `data:` resource, no external font, image or file
    - _Requirements: 2.4, 6.10, 11.1, 11.2, 11.3, 11.4, 11.7, 11.10, 12.4, 12.12, 12.13, 12.15, 12.16, 12.17_

  - [~] 15.3 Write `page.static.test.ts`
    - In `src/web/page.static.test.ts` using `html-scan.ts`, `csp.ts` and `css-scan.ts`
    - `index.html`: exactly one CSP meta before any `script`, `link` or `style` with the exact directive set and no `unsafe-*`, `data:`, `*` or remote host; no inline script content, `on*` attribute or `style` attribute; `lang`, title and exactly one `h1`; picker button; status region attributes; privacy note (1 to 140 characters) and honesty note (1 to 160 characters, contains `andete/disk-peek`); no forbidden phrase in the visible text
    - `style.css`: every `--pair-*` pair meets its minimum, with a self-test showing a failing pair is reported; layout rules; `.fx-*` rules; the over-text composite check; reduced-motion block; no external or `data:` `url(`
    - Self-tests for the helpers (a CSP with `unsafe-inline`, a second CSP meta, a low-contrast pair, an `.fx-*` rule without `pointer-events: none` are each reported)
    - _Requirements: 2.1, 2.2, 2.3, 11.1, 11.2, 11.3, 11.4, 11.7, 12.12, 12.14, 12.15, 12.16, 12.17, 13.1, 13.3, 13.4_

  - [~] 15.4 Write `dist.build.test.ts`
    - In `src/web/dist.build.test.ts` with `describe.skipIf` when `dist/index.html` does not exist
    - Checks on the built `dist/index.html`: the CSP meta with the exact directives, no inline script content, no `on*` or `style` attribute, no `<style>` element, no `data:`; `dist/assets` holds a `disk.worker-*.js` file; no `data:` URL in the emitted CSS or JS (same patterns as task 1.2)
    - _Requirements: 2.5, 14.8_

- [~] 16. Checkpoint - Page complete
  - Run `npm run typecheck`, `npm test`, `npm run test:fuzz` and `npm run build`. All must exit 0.
  - Run `git diff --stat 4d7f5e7 -- src/core`. It must print nothing (empty).
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 17. Final integration and robustness
  - [~] 17.1 Write hostile-file tests through the worker handler
    - In `src/web/worker/disk-handler.hostile.test.ts` (the `hostile` name makes `npm run test:fuzz` pick it up)
    - Through `handleRequest` in Node, with `timed()` from `src/test-support/timed.ts` and the `FC_RUNS_MULTIPLIER` convention: random bytes, empty, 1 byte, truncated generated disks, wrong-type files, an image of exactly `MAX_IMAGE_BYTES`, one byte over, and generated disks whose names, label and file contents hold markup and control characters
    - Each request gets exactly one response and never throws; random bytes give `opened` with geometry source `none` or `failed`, never a crash; hostile text stays plain data in the response; every `exhume` on a hostile disk answers once and `raw.length` never exceeds `MAX_FILE_OUTPUT_BYTES`; each open answers within 5 seconds
    - _Requirements: 3.9, 3.10, 3.11, 14.2, 14.3, 14.4, 14.6_

  - [~] 17.2 Run the final build check
    - Run `npm run build`, then repeat every smoke command of task 1.2 against the real page (worker chunk file, no inline script, no inline style or handler, no `data:` in HTML or CSP, no `unsafe-`, no `data:` URL in emitted CSS or JS)
    - Run `npm test` again so `dist.build.test.ts` runs against the fresh `dist/`
    - Run `git diff 4d7f5e7 -- package.json package-lock.json`: only the `typecheck` script line changes, with no change under `dependencies` or `devDependencies`; and confirm no `*.dom.test.ts` file exists
    - _Requirements: 2.5, 14.8, 15.5, 15.7, 15.8, 15.9, 15.12, 15.13_

- [~] 18. Final checkpoint - Ensure all tests pass
  - Run `npm run typecheck`, `npm test`, `npm run test:fuzz` and `npm run build`. All must exit 0.
  - Run `git diff --stat 4d7f5e7 -- src/core`. It must print nothing (empty).
  - Ensure all tests pass, ask the user if questions arise.

- [~] 19. MANUAL (for the user, not a coding-agent task): checks in a real browser
  - Run `npm run build`, then `npm run preview` yourself, and use the built page (never `vite dev`). The coding agent does not do this task; record the results in `docs/KIRO_LOG.md`.
  - CSP (Req 2.7, 14.8): load an image, open each preview kind (Markdown, CSV, PNG, hex), download, and read the console. Expect zero CSP violations. In the Network tab confirm `assets/disk.worker-*.js` loads from the page origin and no other request is made after the initial load.
  - CSSOM probe (Req 2.8): in the console with the CSP active, run `document.body.style.setProperty('--probe', '1')`, `document.body.style.color = 'red'` and `document.body.setAttribute('style', 'color:blue')`. Record all three outcomes with the browser name and version (the first two are expected to be allowed, the third blocked).
  - 320 px layout (Req 12.13, 12.18): at a 320 CSS pixel viewport there is no page-level horizontal scroll bar, long file names wrap, and the CSV table and hex view scroll inside their own containers.
  - Keyboard (Req 12.3, 12.5, 12.6, 12.8): Tab to an item; Enter and Space each open the preview; Tab and Shift+Tab stay inside the dialog; Escape closes it; focus returns to the item.
  - Reduced motion (Req 11.7, 11.8): with the system setting on, the rising animation is skipped and the fog is static; toggling the setting while the page is open applies within 500 ms.
  - Optional: search `dist/assets/index-*.js` for `openDisk` to confirm the core stayed out of the main bundle (the source scan is the enforced check).

- [ ] 20. BLOCKED: DOM tests (`*.dom.test.ts`) - requires the user's approval of a DOM library (happy-dom or jsdom); do not install, do not create these files until approved
  - Nothing in this group runs now. Until the user names a library, no `*.dom.test.ts` file is created, `vitest.config.ts` keeps `'**/*.dom.test.ts'` in `exclude`, and no dependency is added. Ask the user before any install (Requirements 15.8, 15.9).
  - [ ]* 20.1 BLOCKED: Set up the approved DOM library
    - Only after the user approves a library: add it as a dev dependency pinned to an exact version, remove `'**/*.dom.test.ts'` from the `exclude` list in `vitest.config.ts`, and start every DOM test file with `// @vitest-environment <jsdom|happy-dom>`. Keep script execution off in the test environment. Check current security advisories for the chosen package first.
    - _Requirements: 15.8, 15.9_

  - [ ]* 20.2 BLOCKED: Write `h.dom.test.ts`
    - Design: "DOM helper: `dom/h.ts`", Testing Strategy (DOM tests)
    - `setSrcBlob` sets `src` and `alt` together for a Safe_File_Name and throws for an unsafe name; `h` creates only allowed tags and attributes and puts string children in `Text` nodes; `setDownloadHref` accepts only an owned Blob URL; hostile attribute values derived from disk text are limited to `aria-label`, `title`, `data-*` and `download`
    - _Requirements: 1.2, 1.3, 1.4, 9.10_

  - [ ]* 20.3 BLOCKED: Write `markdown-dom.dom.test.ts`
    - Builder output uses only `p`, `br`, `strong`, `em`, `hr` and text nodes; the fixture `<img src=x onerror=alert(1)>` produces no `img` element, no `onerror` attribute and shows the text unchanged; the CSV and hex builders create no forbidden element types
    - _Requirements: 5.5, 5.11, 5.12, 9.8, 9.12_

  - [ ]* 20.4 BLOCKED: Write `graveyard.dom.test.ts`
    - Hostile names (`<img src=x onerror=alert(1)>`, 255+ character names, markup characters) render as text with no extra elements and no `on*` attribute; tombstone versus open-grave classes and visible state words; directories and lost graves have no `button` and no `tabindex`; the warnings `<details>` is collapsed; empty and unreadable disk messages; "Show more" renders 200 more, shows "X of Y", hides at the end, keeps earlier nodes and moves focus to the first new item
    - _Requirements: 1.2, 1.3, 6.3, 6.4, 6.10, 6.11, 6.13, 6.14, 6.15, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.8, 7.9, 9.16, 12.2_

  - [ ]* 20.5 BLOCKED: Write `preview.dom.test.ts`
    - `role="dialog"`, `aria-modal="true"` and a non-empty accessible name; focus moves to the heading; Escape closes; Tab and Shift+Tab wrap; focus returns to the opener, or to the graveyard heading when the opener is gone; Blob URLs revoked on close and when another preview opens; the PNG `img` has an owned Blob URL `src` and a sanitized `alt`; the shortened-note and the CSV truncated note
    - _Requirements: 5.10, 9.8, 9.10, 9.11, 9.20, 12.5, 12.6, 12.7, 12.8, 12.9_

  - [ ]* 20.6 BLOCKED: Write `keyboard.dom.test.ts`
    - Activating an item with Enter and with Space triggers the same action as a click (the library does not synthesize a click from a key press, so the test dispatches the events a browser would); Escape closes the Preview_Panel; focus returns to the opening item
    - _Requirements: 12.3, 12.5, 12.6, 12.19_

  - [ ]* 20.7 BLOCKED: Write `intake.dom.test.ts`
    - Oversize, empty, random-byte, truncated and wrong-type fixtures end in a graveyard or non-empty status text with the drop zone still in the body; `dragover` and `drop` call `preventDefault`; non-file, directory and multi-file drops; a too-large file is not read; the newest of two overlapping reads wins
    - _Requirements: 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.13, 4.14, 14.2, 14.7_

  - [ ]* 20.8 BLOCKED: Write `app.dom.test.ts`
    - With an injected fake worker client: a successful open replaces the graveyard, closes the preview and resets paging; a failed open keeps the old graveyard, preview and Blob URLs; the lost state disables items and shows **Reopen disk**; the busy text and **Cancel**; rising then preview sequencing for result-first, animation-first, error and reduced motion
    - _Requirements: 3.14, 3.16, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 14.3, 14.5_

  - [ ]* 20.9 BLOCKED: Write `demo-slot.dom.test.ts`
    - Hidden with zero valid entries (label included, no error); labelled container and native buttons with one or more; invalid and duplicate entries omitted; buttons disabled while loading and re-enabled with a cause message on failure
    - _Requirements: 8.6, 8.7, 8.8, 8.9, 8.11, 8.12_

  - [ ]* 20.10 BLOCKED: Write `effects.dom.test.ts`
    - A fake `matchMedia` change toggles reduced motion; `visibilitychange` stops and resumes the loop (fake `requestAnimationFrame`); a null 2D context removes the canvas without an error; no `.rise-ghost` or `.is-rising` is left after the animation
    - _Requirements: 11.5, 11.7, 11.8, 11.9, 11.10_

  - [ ]* 20.11 BLOCKED: Write `errors.dom.test.ts`
    - `error` and `unhandledrejection` events write a bounded fixed message (1 to 300 characters) and change nothing else; the drop zone stays enabled
    - _Requirements: 14.1_

## Notes

- Conventions for every task: no HTML sinks (no `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `DOMParser`, `createContextualFragment`, `srcdoc`, `setHTML`, `eval`, `new Function`, and no `setAttribute` with `on*`, `style` or `srcdoc`); no new dependency of any kind; no file under `src/core` touched; ask the user before any install.
- Tasks marked with `*` are optional and can be skipped for a faster MVP. The property tests are optional. The scan tests (9.3), the page and build tests (15.3, 15.4), the example tests for the downloader, worker client and `demos.ts` (6.4, 13.6, 13.14) and the hostile worker test (17.1) are not optional, because they are the only automated checks of Requirements 1, 2, 3, 8, 10 and 13 that need no DOM library.
- Task 1.1 only changes `package.json` scripts (`typecheck`). Dependencies are never changed. If a task ever needs a dev dependency, it stops and asks for explicit approval first. Task 20 is blocked on that approval.
- Task 19 is a manual task for the user. The coding agent must not attempt it.
- Some property groups are split across more test files than the design's file table lists (for example `sources.scan.props.test.ts` and `demos.props.test.ts`), so tasks in the same wave never write to the same file. The properties themselves are unchanged.
- Property callbacks return nothing or a boolean and never call `expect(...)`. Each property is tagged with `// Feature: graveyard-ui, Property N: <title>`.
- Checkpoints give incremental validation and always include the empty `git diff --stat 4d7f5e7 -- src/core` check.
- Each task references the requirements it satisfies and the design sections it follows.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2.1", "3.1", "5.1", "5.3", "5.5", "5.7", "5.9", "6.1", "7.1", "7.3", "7.5", "7.7"] },
    { "id": 3, "tasks": ["2.2", "2.3", "3.2", "3.3", "4.1", "5.2", "5.4", "5.6", "5.8", "5.10", "6.2", "6.3", "7.2", "7.4", "7.6", "7.8"] },
    { "id": 4, "tasks": ["2.4", "4.2", "4.3", "5.11", "6.4", "6.5"] },
    { "id": 5, "tasks": ["5.12", "9.1", "9.2"] },
    { "id": 6, "tasks": ["9.3", "9.4", "11.1", "13.1"] },
    { "id": 7, "tasks": ["11.2", "11.3", "13.2", "13.3", "13.8", "13.9", "13.12", "13.13"] },
    { "id": 8, "tasks": ["13.4", "13.5", "13.7", "13.11", "13.14"] },
    { "id": 9, "tasks": ["13.6", "13.10", "15.1", "15.2"] },
    { "id": 10, "tasks": ["13.15", "15.3", "15.4"] },
    { "id": 11, "tasks": ["17.1"] },
    { "id": 12, "tasks": ["17.2"] },
    { "id": 13, "tasks": ["20.1"] },
    { "id": 14, "tasks": ["20.2", "20.3", "20.4", "20.5", "20.6", "20.7", "20.8", "20.9", "20.10", "20.11"] }
  ]
}
```
