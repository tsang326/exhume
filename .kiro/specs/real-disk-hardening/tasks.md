# Implementation Plan: Real Disk Hardening

## Overview

Fix the four bugs found on 35 real DOS disks, keep three real FreeDOS images as regression input, and record the result in the README. Work follows this order: baseline run; FAT12 fixes (never-used slots, zero dates) with the writer `slots` extension; detection (WordStar gate, extension veto, oracle and the existing-test updates the design lists); the WordStar converter (soft hyphen, soft space); the manifest-driven `realdisks.test.ts` with its SHA-256 helper and the local `extra-corpus.test.ts`; the README paragraph; the user-approved MCP bundle rebuild; and last, the OPTIONAL deleted long names (item 5). The language is TypeScript (strict, no `any`, zero runtime dependencies in `core`).

## Hard rules for every task

These rules apply to the agent that executes this plan. No task below may violate them.

- Do NOT modify, rename, reformat or regenerate anything under `fixtures/`. That includes the three `.img` files, `manifest.json` and `NOTICE.md`. They are read-only test input.
- No new runtime dependency and no `package.json` change. Do not run `npm install`.
- No git commits unless the user asks.
- `npm run build:mcp` is run only in task 8, and only after the user approves it (task 8.1 stops and asks). Never run it earlier or unapproved.
- Never run `npm run make:demos` without `--check`. Never write into `public/disks/`. Never run `npm run build`, `npm run dev`, `npm run preview`, `npm run test:watch` or any watch mode.
- Every task ends with `npm test` and `npm run typecheck` green. Any task that touches the writer (`src/test-support/fat12/`), detection (`detect.ts`, `oracles.ts`) or the converter also runs `npm run make:demos -- --check`, and all three images must match. The one allowed exception: `src/mcp/build.test.ts` (stale committed bundle) fails from the first change in `src/core/` until task 8 is done by the approved build. It is expected, is not a reason to run the build early, and is the only failure tolerated before task 8. After task 8 everything must be fully green.
- Existing tests may be edited only where the design lists them (`detect.test.ts` filler byte and content-beats-name cases, `oracles.ts`, `wordstar.text.test.ts` and `wordstar.styles.test.ts` high-bit-space cases, `hostile.ts` widening). Each such edit is justified in its task by Requirement 2.4: the expectation changes because Requirement 1, 3, 4 or 5 explicitly changes the behavior. No other expected value may change.
- The WordStar rule thresholds stay as designed (MZ/ZM veto, NUL budget `n >> 6`, odd-byte budget `n >> 4` on the low 7 bits, plus the extension veto). The owner measured them outside the repo: 186 of 197 old detections dropped, 0 on the fixtures, no real WordStar document lost. `DATETEST.H86` stays detected; it is harmless, leave it. If `realdisks.test.ts` finds a fixture file still detected as WordStar, STOP and report it to the user; do not change a threshold on your own.
- Property tests carry the comment `Feature: real-disk-hardening, Property N: <title>` and `**Validates: Requirements ...**`, use `numRuns(100)` from `src/test-support/runs`, and a fast-check callback returns nothing or a boolean, never `expect(...)`.
- Only `realdisks.test.ts` and `extra-corpus.test.ts` read files (Requirement 11.5). `realdisks.test.ts` reads only from `fixtures/real-disks/freedos13/`; its check that no fixture sits under `public/` compares directory listing names only and reads no bytes.
- Run tests as single runs (`npx vitest run <paths>` for targeted runs, `npm test` for the full run). Typecheck with `npm run typecheck`.
- Property tests are optional (`*`), except Property 6 (task 2.5), which is required because the brief asks for it explicitly. Example tests the requirements demand, edits that keep existing tests green, and the hostile-input tests are required.

## Tasks

- [x] 1. Baseline
  - [x] 1.1 Record the baseline, with no code changes
    - Run `npm test`, `npm run typecheck` and `npm run make:demos -- --check`; note in the task result the test counts, failures if any, and whether all three demo images match
    - Run `git status --short` and note the working tree state (the fixtures and `.kiro/specs/real-disk-hardening/` are expected to be untracked or already committed); change no file
    - _Requirements: 2.3, 2.4, 7.1_

- [x] 2. FAT12 fixes and the writer `slots` extension
  - [x] 2.1 Add `slots` to the test-only image writer
    - `src/test-support/fat12/types.ts`: add `NeverUsedSlot { beforeChild: number; fill: 'f6' | 'zero' }` and the optional `slots?: NeverUsedSlot[]` on `FileTree` and `DirNode`
    - `measure.ts`: root entry count and directory record count add `slots.length`, so `FitError('root-entry-count')` still fires before any byte is written
    - `layout.ts`: a directory's cluster need adds `slots.length`; in the record-writing loop write each slot (byte 0 `DELETED_MARK`, bytes 1 to 31 the fill) before the child it names and after the last child; a long-name group is never split by a slot
    - Validation throws `RangeError` for a non-integer or out-of-range `beforeChild` or an unknown fill, like the other writer validators
    - With `slots` absent the layout must be byte-for-byte unchanged
    - Finish: `npm test`, `npm run typecheck` and `npm run make:demos -- --check` green
    - _Requirements: 3.6, 3.9_

  - [x] 2.2 Write example tests for the writer change
    - `src/test-support/fat12/layout.test.ts`: slot bytes at known offsets for both fills in the root and in a subdirectory; a subdirectory that needs an extra cluster because of slots; bad `beforeChild` and bad fill throw `RangeError`
    - `src/test-support/fat12/measure.test.ts`: `FitError('root-entry-count')` when slots overflow the root
    - Build every image with the writer; no bytes copied from PCjs disks
    - Finish: `npm test`, `npm run typecheck` and `npm run make:demos -- --check` green
    - _Requirements: 3.6, 3.9_

  - [x] 2.3 Implement never-used slots and zero dates in the reader
    - `src/core/fat12/dates.ts`: add `export function isZeroDosDateTime(dateWord: number, timeWord: number): boolean`; leave `decodeDosDateTime` unchanged
    - `src/core/fat12/directory.ts`: add `isNeverUsedSlot(rec)` (`0xE5` then 31 bytes all `0xF6` or all `0x00`, one pass over at most 31 bytes); in `walkDirectories`, right after `const deleted = first === DELETED_MARK;` add `if (deleted && isNeverUsedSlot(rec)) continue;` before the long-name branch (the slot still consumes one read of the record budget; long-name state is untouched)
    - Zero date: when the date word and the time word are both zero, set `date` to `null` and add no warning; every other pair goes through `decodeDosDateTime` and the existing `date-invalid` warning exactly as before
    - Only loops with hard caps; no recursion, no regular expression, no new dependency, no `src/core` I/O
    - Finish: `npm test` and `npm run typecheck` green (see the `build.test.ts` exception in the hard rules)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3, 4.4, 11.1, 11.2, 11.4_

  - [x] 2.4 Write example tests for slots and zero dates
    - `src/core/fat12/directory.unit.test.ts`: `E5` plus 31 `F6` in the root; `E5` plus 31 `00`; a slot mixing both fills is a deleted grave; slots in a subdirectory; slots before, between and after real entries are skipped and later entries still appear; the record budget still stops the scan; zero date and time gives `date: null` with no warning; zero date only and zero time only keep the existing rules; an invalid month still gives `date-invalid`
    - `src/core/fat12/dates.test.ts`: examples for `isZeroDosDateTime`
    - Edit no existing expected value
    - Finish: `npm test` and `npm run typecheck` green
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 4.1, 4.2, 4.3, 4.4_

  - [x] 2.5 Write property test for never-used slots
    - **Property 6: Never-used slots are invisible**
    - New file `src/core/fat12/reader.slots.test.ts`: file trees with slots of either fill at any position in the root or any subdirectory; compare the `(path, size, date, state, kind)` list and the warning `(code, path)` list with the same tree without slots (live nodes only)
    - **Validates: Requirements 3.1, 3.2, 3.5, 3.7**
    - Finish: `npm test` and `npm run typecheck` green

  - [ ]* 2.6 Write property test for other `0xE5` slots
    - **Property 7: Other `0xE5` slots are still graves**
    - New file `src/core/fat12/reader.deleted-slot.test.ts`: a 31-byte tail that is neither all `0xF6` nor all `0x00` yields exactly one more Grave, graded and named as a deleted entry
    - **Validates: Requirements 3.3**
    - Finish: `npm test` and `npm run typecheck` green

  - [ ]* 2.7 Write property test for date and time word pairs
    - **Property 8: Date and time word pairs**
    - New file `src/core/fat12/reader.dates.test.ts`: patch the two words of one writer entry (the technique of `reader.examples.test.ts`); both zero gives `date: null` and no warning; otherwise the result equals `decodeDosDateTime` with `date-invalid` naming the path exactly when it returns `null`
    - **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.5**
    - Finish: `npm test` and `npm run typecheck` green

  - [x] 2.8 Extend the hostile reader test with the new fill families
    - Property 12 (reader part). In `src/core/fat12/reader.hostile.test.ts` (keep `hostile` in the name so `test:fuzz` picks it up): directory regions filled with `E5 F6...` and `E5 00...` patterns, mixed with real entries and with noise; `openDisk` never throws, hangs or allocates without bound, and leaves the input unchanged
    - Property tag: **Property 12: Totality on hostile input**; **Validates: Requirements 3.8, 11.4**
    - Finish: `npm test` and `npm run typecheck` green
    - _Requirements: 3.8, 11.4_

- [x] 3. Detection: WordStar gate, extension veto, oracle
  - [x] 3.1 Implement the gate and the veto with the independent oracle and the listed existing-test edits
    - `src/core/formats/detect.ts`: constants `ODD_BYTE_SHIFT = 4`, `NUL_BYTE_SHIFT = 6`, MZ/ZM veto, text-like set on the low 7 bits (`0x20..0x7E`, TAB, LF, FF, CR, `0x1A`, `0x02`, `0x13`, `0x19`, `0x1F`), one pass with early exit; keep the three existing traits verbatim; add `hasKnownBinaryExtension` (closed list `COM EXE SYS OVR BIN DLL DRV BGI CHR FON CPI NDX NTX MDX DBF ZIP ARC LZH` and all-digit extensions, ASCII case folded) and apply it only to the WordStar content rule; PCX and dBase III content rules still run first; `formatFromExtension` is unchanged
    - `src/test-support/formats/oracles.ts`: rewrite `detectOracle` as an independent model (array methods over the low-7 view, then the line-based traits) and add the veto, with its own copy of the closed list, to `detectFullOracle`
    - Existing-test edits, each justified by Requirement 2.4 because Requirement 1 explicitly changes the behavior: in `src/core/formats/detect.test.ts` the window tests (`never detects WordStar from a marker placed only after the window`, `does not see a dot command that starts at index 4096...`, `does not see a two-byte marker that straddles the window edge`, `detects the same markers when they sit fully inside the window`) change their filler from `0x01` (an odd byte the gate now rejects) to `0xC1` with the same expectations; `lets content win over any file name...` and `Strong content rules beat every extension` restrict the WordStar-content generator to names without a binary extension (PCX and dBase content keep any name)
    - Change no other expected value; Fixture_Writer and demo documents must still be detected as `wordstar`
    - Finish: `npm test`, `npm run typecheck` and `npm run make:demos -- --check` green
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 1.13, 2.1, 2.2, 2.3, 2.4, 11.1, 11.2, 11.3_

  - [x] 3.2 Widen the hostile grammar and add oracle examples
    - `src/test-support/formats/hostile.ts`: add `[0xa0]`, `[0x1f, 0x8d, 0x0a]` and an `MZ` prefix token to `WS_TOKENS` (a widening, no expectation changes; justified by Requirement 2.4 as it only reaches the new paths)
    - `src/test-support/formats/oracles.test.ts`: examples for the new `detectOracle` and the veto in `detectFullOracle`; `A 8D 0A` and `.PA\r\nhi` expectations still hold
    - Finish: `npm test`, `npm run typecheck` and `npm run make:demos -- --check` green
    - _Requirements: 1.2, 1.5, 1.7, 2.4_

  - [x] 3.3 Write example tests for the detector
    - `src/core/formats/detect.examples.test.ts`: `MZ` prefix with a trait; a COM-named WordStar document; a TXT-named and a no-extension WordStar document detected by content; `.DBF` with dBase III content (still `dbase`); `.DBF` with a dBase II header (not `wordstar`; extension rule); `FREEDOS.001` with random bytes; a 15-byte file with one odd byte; the 2-byte soft return; the `EXAMPLE.TXT`-like case with a synthetic document; empty input
    - Finish: `npm test`, `npm run typecheck` and `npm run make:demos -- --check` green
    - _Requirements: 1.2, 1.3, 1.5, 1.6, 1.7, 1.11, 1.12, 1.13_

  - [ ]* 3.4 Write property test for detection against the oracle
    - **Property 1: Detection equals the independent oracle**
    - New file `src/core/formats/detect.oracle.props.test.ts`; any bytes and any name value (string of any length or non-string); `detectFormat` never throws
    - **Validates: Requirements 1.4, 1.6, 1.10, 1.13**
    - Finish: `npm test`, `npm run typecheck` and `npm run make:demos -- --check` green

  - [ ]* 3.5 Write property test for the gate
    - **Property 2: The gate rejects binary-looking samples**
    - New file `src/core/formats/detect.gate.props.test.ts`: MZ/ZM prefix, NUL count above `floor(n/64)` or odd-byte count above `floor(n/16)`, with any trait and any name, never `wordstar`; the high bit of non-trait bytes does not change the verdict
    - **Validates: Requirements 1.2, 1.3, 1.4**
    - Finish: `npm test`, `npm run typecheck` and `npm run make:demos -- --check` green

  - [ ]* 3.6 Write property test for the extension veto
    - **Property 3: Known binary extensions are never WordStar**
    - New file `src/core/formats/detect.veto.props.test.ts`: any bytes, including WordStar documents, with a listed or all-digit extension in any ASCII case mix are never `wordstar`; dBase III content with such a name (including `.DBF`) is still `dbase` by content
    - **Validates: Requirements 1.5, 1.12, 1.13**
    - Finish: `npm test`, `npm run typecheck` and `npm run make:demos -- --check` green

  - [ ]* 3.7 Write property test for WordStar documents with text names
    - **Property 4: WordStar documents are still detected, whatever the text extension**
    - New file `src/core/formats/detect.textname.props.test.ts`: `writeWordStar` documents and hand-built text-like documents with a trait (including `0xA0` and `0x1F`), with no name, no extension, `TXT`, `DOC` or `WS`, are `wordstar`; `content` source for the first three name classes
    - **Validates: Requirements 1.7, 1.11, 2.1**
    - Finish: `npm test`, `npm run typecheck` and `npm run make:demos -- --check` green

  - [ ]* 3.8 Write property test for the sample window
    - **Property 5: Detection reads only the sample window**
    - New file `src/core/formats/detect.window.props.test.ts`: edits at or after `DETECT_SAMPLE_BYTES` change nothing; a marker straddling the window edge is not seen; the same marker fully inside the window is seen when the sample passes the gate
    - **Validates: Requirements 1.8**
    - Finish: `npm test`, `npm run typecheck` and `npm run make:demos -- --check` green

- [x] 4. WordStar converter: soft hyphen and soft space
  - [x] 4.1 Record the golden Markdown before the converter changes
    - New file `src/core/formats/wordstar.golden.test.ts`: the Markdown of the demo WordStar documents (built in memory from the same definitions the demo-disk tests use; read no files) and of ten fixed `writeWordStar` documents, with the expected strings recorded from the current converter; choose documents that contain no `0x1F`/`0x9F` and no `0xA0` next to an ordinary space, so they must stay identical after task 4.2
    - This task changes no source file and must pass on the unchanged converter
    - Finish: `npm test`, `npm run typecheck` and `npm run make:demos -- --check` green
    - _Requirements: 2.5, 5.6_

  - [x] 4.2 Implement soft hyphen joining and soft space runs
    - `src/core/formats/wordstar.ts`: local state `prevHyphen`, `runOrdinary`, `runSoft`; `readToken` records whether a single-byte token is a raw `0xA0`; a soft hyphen (`0x1F`, and `0x9F` because the converter masks the high bit) immediately before a soft return joins the text with no character between; elsewhere it is dropped silently as before; a soft space next to an ordinary space in the same pending run emits nothing, a run of only soft spaces keeps one space each; `writeChar` and `writeHard` reset the run counters; loops consume at least one input byte per step, no new warning code
    - Existing-test edits, each justified by Requirement 2.4 because Requirement 5.3 explicitly changes the behavior of a soft space next to an ordinary space: `src/core/formats/wordstar.text.test.ts`, `gives the same output when the high bit is set on non-return characters`, applies the random high bit to every byte except `0x20`; `src/core/formats/wordstar.styles.test.ts`, `Property 14: un-escaping recovers the 7-bit text of the input`, stops setting the high bit on `0x20` in `plainTextArb` and updates the model comment about spaces
    - Change no other expected value; the golden test from 4.1 must still pass unedited
    - Finish: `npm test`, `npm run typecheck` and `npm run make:demos -- --check` green
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 2.4, 2.5, 11.2_

  - [x] 4.3 Write example tests for the converter
    - `src/core/formats/wordstar.examples.test.ts` (create or extend): every row of the design's interaction table, including `cor` `1F` `8D 0A` `rected` giving `corrected`, the `9F` form, `cor` `1F` `20` `8D 0A` `rected`, a hyphen at the start of the document, `a` `20` `A0` `b`, `a` `A0` `20` `b`, `a` `A0` `A0` `b`, `a` `A0` `8D 0A` `b`, `a` `8D 0A` `A0` `b`, and trailing spaces before a hard return
    - Finish: `npm test`, `npm run typecheck` and `npm run make:demos -- --check` green
    - _Requirements: 5.1, 5.2, 5.3, 5.6_

  - [ ]* 4.4 Write property test for soft hyphens
    - **Property 9: Soft hyphen joins at a soft return and is dropped elsewhere**
    - New file `src/core/formats/wordstar.hyphen.props.test.ts`
    - **Validates: Requirements 5.1, 5.2**
    - Finish: `npm test`, `npm run typecheck` and `npm run make:demos -- --check` green

  - [ ]* 4.5 Write property test for soft spaces
    - **Property 10: Soft spaces are justification padding**
    - New file `src/core/formats/wordstar.softspace.props.test.ts`
    - **Validates: Requirements 5.3**
    - Finish: `npm test`, `npm run typecheck` and `npm run make:demos -- --check` green

  - [x] 4.6 Extend the formats hostile test
    - Property 12 (formats part). In the existing formats hostile test file (its name contains `hostile`; locate it with `file_search`): the widened `WS_TOKENS` grammar with `0x1F`, `0xA0` and `MZ` prefixes; `detectFormat`, `convertWordStar` and `convertAuto` return results that satisfy the existing contracts, never throw, stay inside the time budget and leave the input unchanged
    - Property tag: **Property 12: Totality on hostile input**; **Validates: Requirements 1.10, 5.5, 11.4**
    - Finish: `npm test`, `npm run typecheck` and `npm run make:demos -- --check` green
    - _Requirements: 1.10, 5.5, 11.4_

- [x] 5. Real-disk regression tests
  - [x] 5.1 Add the test-only SHA-256 helper
    - `src/test-support/sha256.ts`: `sha256Hex(bytes)` using `createHash` from `node:crypto`; imports nothing from the project; not under `src/core`
    - `src/test-support/sha256.test.ts`: NIST vectors for the empty input and `abc`
    - Finish: `npm test` and `npm run typecheck` green
    - _Requirements: 6.2, 11.1_

  - [x] 5.2 Write `src/core/realdisks.test.ts`
    - Hand-written `parseManifest(json: unknown)` (no `any`, no schema library) that throws a plain `Error` naming the first bad field and ignores note fields; pure `gradeImage(entry, image): string[]` returning problems
    - `describe.each` over the manifest images, reading from `fixtures/real-disks/freedos13/` only; `gradeImage` checks, in order: image length and SHA-256 equal the manifest before reading (6.2); `openDisk` and zero warnings (6.7); alive files equal the manifest as Case_Folded_Paths (only `A` to `Z` folded), same size, same SHA-256 of `readGraveBytes`/`readBytes` (6.3, 6.4, 6.5, 6.10); directories equal the manifest (6.6); `detectFormat(bytes, baseName).format !== 'wordstar'` for every alive file (6.8); deleted entries equal `deletedEntries` as folded `(path, size)` pairs, also accepting the long-name forms `/freedos.012` and `/freedos.020` for `/_REEDOS.012` and `/_REEDOS.020` through a table local to the test (6.9, 10.5)
    - Expected values come only from the manifest; the test writes nothing, uses no network and no secrets (6.11, 6.12); it runs under `npm test` (6.13)
    - If any fixture file is still detected as `wordstar`, STOP and report to the user; do not change a threshold
    - Do not touch anything under `fixtures/`
    - Finish: `npm test` and `npm run typecheck` green
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12, 6.13, 10.5, 11.5_

  - [x] 5.3 Add negative controls and fixture handling checks to `realdisks.test.ts`
    - On in-memory copies only: change one expected hash, one size, drop one expected file, add one unexpected `deletedEntries` row, flip one image byte; each must make `gradeImage` return at least one problem (guards against a vacuous test)
    - `foldAscii` examples; `NOTICE.md` exists next to the images (7.2); no file under `public/` has the name of a fixture image, checked from a directory listing only (7.3); no bytes are read from `public/`
    - Do not touch anything under `fixtures/`
    - Finish: `npm test` and `npm run typecheck` green
    - _Requirements: 6.10, 6.11, 7.1, 7.2, 7.3, 7.4, 7.6_

  - [x] 5.4 Write `src/core/extra-corpus.test.ts`
    - `describe.skipIf` the environment variable `EXHUME_EXTRA_DISKS` is unset or empty; list the folder non-recursively, `.img` names only (ASCII case-insensitive), sorted; `lstatSync` each entry and skip non-regular files and files larger than `MAX_IMAGE_BYTES` (imported from the FAT12 limits, not repeated) with a printed note; wrap each read in `try/catch` and continue; per image print files, graves, warnings and detections by format, then totals
    - Pure `summarise(rows)` over `CorpusRow` (`image` or `note`) with unit tests on fabricated rows that always run, including a note row
    - The only assertion is that the body completed; image content never fails the test; nothing is written, copied or fetched
    - Finish: `npm test` and `npm run typecheck` green
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 11.5_

- [x] 6. README
  - [x] 6.1 Add the "Tested on real disks" section to `README.md`
    - Insert the heading and the single paragraph from the design after the demo-disks section and before `## MCP server and Kiro Power`; edit no existing line
    - The paragraph states: 35 real disks (24 FreeDOS 1.3 floppy images, 11 PCjs disks); the FreeDOS files checked against the macOS msdos driver (read-only mount) and the PCjs files against the per-file MD5 table PCjs publishes; all 942 files matched byte for byte; 63 of 63 PCX images that Pillow could open matched pixel for pixel and Pillow refused the other 25, which Exhume renders; 39 of 39 dBase III tables matched `dbfread` after normalising ISO dates and TRUE/FALSE; the page does not offer these disks; three unmodified FreeDOS images are kept in `fixtures/real-disks/freedos13/` as read-only test input with their own notice; no claim that FreeDOS or PCjs files are part of Exhume
    - Finish: `npm test` and `npm run typecheck` green
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8_

  - [x] 6.2 Add README examples to `src/demo-disks/readme.test.ts`
    - Examples for the heading, the five numbers (35, 24, 11, 942, 63 of 63, 25, 39 of 39), the names FreeDOS and PCjs with their reference methods, the absence of any "part of Exhume" or "offered by the page" claim, and that the existing demo-disks text is unchanged
    - Finish: `npm test` and `npm run typecheck` green
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8_

- [x] 7. Checkpoint - all source changes
  - Run `npm test`, `npm run typecheck` and `npm run make:demos -- --check`. The only tolerated failure is the stale-bundle test in `src/mcp/build.test.ts`; do not run `npm run build:mcp` here.
  - Confirm `git status --short` shows nothing under `fixtures/` modified, and that `package.json`, `package-lock.json`, `power/mcp.json` and `.kiro/settings/mcp.json` are unchanged.
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. MCP bundle rebuild (needs the user's approval)
  - [x] 8.1 Check the build configuration, then STOP and ask for approval
    - Do NOT run `npm run build:mcp` in this sub-task. Compute `shasum -a 256 vite.mcp.config.ts` and run `git diff --stat -- vite.mcp.config.ts package.json`; report the hash and confirm the config and `package.json` are unchanged by this spec (the same config-hash check the user did before earlier `build:mcp` runs)
    - Use the `user_input` tool to ask the user to approve running `npm run build:mcp`, showing the hash. Do not continue until the user answers. If the user does not approve, stop here and leave the bundle stale.
    - _Requirements: 11.1, 11.7_

  - [x] 8.2 After approval only: rebuild and verify the bundle
    - Run `npm run build:mcp` once, then a second time and confirm `power/server/exhume-mcp.mjs` is byte-for-byte identical (for example `cmp` against a temporary copy under `os.tmpdir()`, removed afterwards)
    - Check that only `power/server/exhume-mcp.mjs` was written, its imports are `node:` only, `power/mcp.json` still has no auto-approve entry, and `.kiro/settings/mcp.json` is unchanged
    - Run `npx vitest run src/mcp/build.test.ts`, then `npm test`, `npm run typecheck` and `npm run make:demos -- --check`; everything must now be fully green. Leave the bundle in place (the user commits it).
    - _Requirements: 11.1, 11.7_

- [ ] 9. OPTIONAL: long names of deleted entries (item 5)
  - Optional by design. Skip the whole group if any step is not clean; every other requirement holds without it and `realdisks.test.ts` already accepts both forms.

  - [ ]* 9.1 Check the web and MCP tests for deleted long names first
    - Read-only: search `src/web/`, `src/mcp/` and `src/demo-disks/` tests for deleted nodes with long names or underscore-form deleted paths; list what would change; if a test would need an expected-value edit outside the design's list, stop and ask the user instead of editing it
    - Finish: `npm test` and `npm run typecheck` green (no change made)
    - _Requirements: 10.1, 10.6_

  - [ ]* 9.2 Add deleted long-name assembly to `names.ts`
    - `DeletedLfnState`, `makeDeletedLfnState`, `resetDeletedLfn`, `feedDeletedLfn` (never throws) and `takeDeletedLfn`: requires `1 <= count <= MAX_LFN_ENTRIES`, consistent checksum, no overflow; assembles units in sequence order, stops at the first `0x0000`, requires `1..MAX_NAME_UTF16` units; recovers the lost first byte with a 256-step loop over `lfnChecksum` and requires it to equal the ASCII-uppercased first unit; returns `sanitizeComponent(...)` of the name or `undefined`
    - Example tests in `src/core/fat12/names.test.ts`: the `freedos.012` case, a wrong checksum, a first character mismatch, more than the record cap, an empty name
    - Finish: `npm test` and `npm run typecheck` green
    - _Requirements: 10.1, 10.2, 10.3, 10.4_

  - [ ]* 9.3 Wire deleted long names into `directory.ts`
    - `DirFrame.dlfn`, created on the first deleted long-name record; deleted long-name records feed it, every other record resets it; the deleted 8.3 branch uses `takeDeletedLfn` for the path when defined, otherwise the underscore form; no new warning code
    - Finish: `npm test` and `npm run typecheck` green
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.6_

  - [ ]* 9.4 Write property test for deleted long names
    - **Property 11: Deleted long names (optional, item 5)**
    - New file `src/core/fat12/reader.deleted-lfn.test.ts`
    - **Validates: Requirements 10.1, 10.2, 10.4**
    - Finish: `npm test` and `npm run typecheck` green

  - [ ]* 9.5 Extend the hostile generator for deleted long-name records
    - Add `E5` plus attribute `0x0F` records (random checksum and units, overflow counts) to the reader hostile test; `openDisk` never throws and stays bounded
    - Property tag: **Property 12: Totality on hostile input**; **Validates: Requirements 10.3, 11.4**
    - Finish: `npm test` and `npm run typecheck` green

  - [ ]* 9.6 Rebuild the bundle again, with approval
    - `src/core` changed again, so the bundle is stale. Repeat task 8.1 (config hash, `user_input` approval, never run unapproved) and then 8.2
    - Finish: `npm test`, `npm run typecheck` and `npm run make:demos -- --check` fully green

- [~] 10. Final checkpoint
  - Run `npm test`, `npm run typecheck` and `npm run make:demos -- --check`; everything must be green, including `src/mcp/build.test.ts`.
  - Confirm nothing under `fixtures/` changed, `public/disks/` is unchanged, no dependency was added and nothing was committed.
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional. Property tests (except Property 6, task 2.5, which is required because the brief asks for it explicitly) and the whole of task 9 can be skipped for a faster MVP. The example tests, the golden test, the hostile tests, `realdisks.test.ts` and the edits that keep existing tests green are required.
- Each task references requirement clauses for traceability. Properties 1 to 12 are defined in `design.md`.
- Property 12 is split across tasks 2.8, 4.6 and 9.5 so each part lives in the file that owns the code.
- The WordStar rule thresholds are fixed by the design and the owner's real-disk measurement. `realdisks.test.ts` is the check if a fixture file is still detected.
- This plan never edits `fixtures/`, `public/disks/`, `scripts/make-demo-disks.ts`, `package.json`, `power/mcp.json` or `.kiro/settings/mcp.json`.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "2.3"] },
    { "id": 2, "tasks": ["2.2", "2.4", "2.5", "2.6", "2.7", "2.8"] },
    { "id": 3, "tasks": ["3.1"] },
    { "id": 4, "tasks": ["3.2", "3.3", "3.4", "3.5", "3.6", "3.7", "3.8"] },
    { "id": 5, "tasks": ["4.1"] },
    { "id": 6, "tasks": ["4.2"] },
    { "id": 7, "tasks": ["4.3", "4.4", "4.5", "4.6"] },
    { "id": 8, "tasks": ["5.1", "5.4"] },
    { "id": 9, "tasks": ["5.2"] },
    { "id": 10, "tasks": ["5.3"] },
    { "id": 11, "tasks": ["6.1"] },
    { "id": 12, "tasks": ["6.2"] },
    { "id": 13, "tasks": ["8.1"] },
    { "id": 14, "tasks": ["8.2"] },
    { "id": 15, "tasks": ["9.1"] },
    { "id": 16, "tasks": ["9.2"] },
    { "id": 17, "tasks": ["9.3"] },
    { "id": 18, "tasks": ["9.4", "9.5"] },
    { "id": 19, "tasks": ["9.6"] }
  ]
}
```
