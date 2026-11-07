# Implementation Plan: Demo Disks

## Overview

The plan builds the demo-disk generator bottom-up and proves everything in memory before any committed image is involved. It starts with the build tooling and the source scanner (task 1), the specs and the text scanners (tasks 2 and 3), and the two generic builders (task 4). Then it adds the authored content, the three disk plans and `build.ts` (task 5). The first checkpoint (task 6) runs only in-memory tests. Task 7 adds the Shared_Checks, and a second in-memory checkpoint follows (task 8). Task 9 adds the CLI core, the Node shell and the CLI tests, task 10 the generator source and import scans, and task 11 the `DEMO_REGISTRY` content with the two minimal web test edits. A third in-memory checkpoint follows (task 12). Task 13 documents the disks in the README. Task 14 adds the Committed_Image tests, which are allowed to fail until the user generates the images. Task 15 is the final hand-over to the user.

All code is TypeScript under `strict`, with no `any`. The pure code in `src/demo-disks/` uses no Node API, no clock and no randomness. Only `scripts/make-demo-disks.ts` imports `node:fs`. Tests use Vitest and fast-check. Property callbacks return nothing or a boolean and never call `expect(...)`. Every property is tagged with `// Feature: demo-disks, Property N: <title>` followed by `// **Validates: Requirements ...**`, and every run count comes from `numRuns(100)` in `src/test-support/runs.ts`.

## Working rules (apply to every task)

- NEVER run `npm run make:demos`, with or without `--check` (Requirement 2.10). NEVER write, create, modify or delete anything in `public/disks/`. The user generates the images.
- NEVER run `npm run build`. NEVER run a watch mode. Tests run only as `npx vitest --run <files>` or `npm test` (single run). DOM tests run only as `npm run test:dom`.
- No package installs, no network access, no change to `dependencies`, `devDependencies` or `optionalDependencies` (Requirement 1.3).
- No shell-based file edits (no `sed`, `awk`, `python`, heredocs, `echo >`). Use the file-editing tools.
- Do not touch any existing file under `src/core/` or under `src/test-support/`. The only new files added under `src/test-support/` are `demo-source-scan.ts` and its test (Requirement 1.2).
- Names in the Generator source must avoid the substrings of the forbidden-name list of Requirement 1.6 everywhere, including comments and identifiers (the scan is a plain text scan). Do not write the words `Date.now`, `fetch`, `process.env` and the other listed names in any non-test file under `src/demo-disks/` or in `scripts/make-demo-disks.ts`. The scanner file `src/test-support/demo-source-scan.ts` is the only file that holds them.
- Author-side names are `DRAFT1.WS`, `DRAFT2.WS`, `OLDCUST.DBF` (given to the Image_Writer). Everything the Reader reports, and every check, uses the Reader_Paths `/_RAFT1.WS`, `/_RAFT2.WS`, `/_LDCUST.DBF`, with converter name hints `_RAFT1.WS` and `_RAFT2.WS` (design Finding F1).
- If an in-memory check fails, fix the authored content or builder, never weaken the check.
- Checkpoints 6, 8 and 12 run only in-memory tests. The Committed_Image tests of task 14 may fail until the user has run the generator; that is expected and is not a reason to change any other task.

## Tasks

- [x] 1. Build tooling and the source scanner
  - [x] 1.1 Write `vite.demos.config.ts`, the `make:demos` script and the `scripts` include
    - Design: "How the script runs", Finding F5, Finding F7
    - Create `vite.demos.config.ts` in the repository root as the design shows: `publicDir: false`, `logLevel: 'warn'`, `build.ssr: 'scripts/make-demo-disks.ts'`, `outDir: 'node_modules/.cache/exhume-demos'`, `emptyOutDir: false`, `copyPublicDir: false`, `target: 'node22'`, `minify: false`, `sourcemap: false`, `reportCompressedSize: false`, `rollupOptions.external: [/^node:/, ...builtinModules]`, `output { format: 'es', entryFileNames: 'make-demo-disks.mjs', inlineDynamicImports: true }`, `ssr: { noExternal: true, target: 'node' }`
    - `package.json`: add only the script `"make:demos": "vite build --config vite.demos.config.ts && node node_modules/.cache/exhume-demos/make-demo-disks.mjs"`. Leave `build` and every other script and field unchanged.
    - Root `tsconfig.json`: add `"scripts"` to `include` and change nothing else
    - Do NOT run the new script and do NOT run a Vite build
    - _Requirements: 2.1, 2.9, 2.11, 1.3_

  - [x] 1.2 Create `src/test-support/demo-source-scan.ts`
    - Design: "Source scan names"; Finding F6
    - Export `FORBIDDEN_NAMES` (the 14 names of Requirement 1.6, in that order, as string literals), the `Violation` type `{ file, line, name }` (1-based line) and `scanGeneratorSource(file, text)`: split into lines, at each position find the longest forbidden name that starts there, record one violation per name per occurrence and continue after the matched name (so `node:https` gives one violation for `node:https` and none for `node:http`)
    - Pure, no import from `node:`, no regular expression over the whole text
    - _Requirements: 1.6, 1.7_

  - [x] 1.3 Write tests for the source scanner
    - In `src/test-support/demo-source-scan.test.ts`
    - Examples: a fixture holding each of the 14 names once gives 14 violations with the right names and lines; a clean fixture gives zero; `node:https` gives exactly one violation
    - _Requirements: 1.6, 1.7_

  - [x]* 1.4 Write property test for the source scan
    - **Property 5: Source scan reports exactly the inserted names**
    - Add to `src/test-support/demo-source-scan.test.ts`; filler lines of upper-case letters, digits and spaces; names inserted on chosen lines separated by spaces
    - **Validates: Requirements 1.6, 1.7**

- [x] 2. Specs, dates and errors
  - [x] 2.1 Create `src/demo-disks/specs.ts`, `src/demo-disks/content/dates.ts` and `src/demo-disks/errors.ts`
    - Design: "Specs", "Fixed values"
    - `specs.ts`: `DemoDiskId`, `DemoDiskSpec`, `DEMO_DISK_SPECS` in the order writers, office, damaged: file names `writers-disk.img`, `office-disk.img`, `damaged-disk.img`; labels `WRITER DEMO`, `OFFICE DEMO`, `DAMAGE DEMO`; geometries `360K`, `720K`, `360K`; three distinct fixed serial constants
    - `dates.ts`: explicit fixed `DosDateTime` constants between 1988 and 1993 (never the writer default of 1980-01-01) and their expected `YYYY-MM-DDTHH:MM:SS` strings
    - `errors.ts`: `DemoBuildError(diskFile, message)`
    - Pure; imports only the `src/test-support/fat12/index` types
    - _Requirements: 3.2, 3.3, 4.1, 5.1, 6.1, 7.1_

- [x] 3. Text scanners
  - [x] 3.1 Create `src/demo-disks/checks/text-scan.ts`
    - Design: "Text scanners (Property 1 and 2)"
    - `TEXT_SCAN_CAP` (1,048,576), `scanPhones` and `scanLinks` as one left-to-right loop each, no regular expression, no backtracking; the Phone_Pattern rules (not inside a longer digit run, not touching a hyphen that touches a digit), `reserved` only for prefix `555` and `0100` to `0199`; `scanLinks` finds `http://`, `https://`, `www.` (ASCII case-insensitive) and an `@` with an ASCII letter on both sides; both return `{ ok: false, reason: 'too-long' }` above the cap
    - _Requirements: 8.2, 8.9_

  - [x] 3.2 Write example tests for the scanners
    - In `src/demo-disks/text-scan.test.ts`
    - Examples: `1989-03-14`, `-1250.00`, `INV-8903-12`, `555-0123`, `555-0200`, `123-4567`, `12-555-0123`, `555-0123-45`; the cap edge at exactly 1,048,576 and at 1,048,577 characters; `HTTP://x`, `www.`, `a@b`, and a leading `@` that is not a match
    - _Requirements: 8.2, 8.9_

  - [x]* 3.3 Write property tests for the scanners
    - **Property 1: Phone scan agrees with a token model**
    - **Property 2: Text scans are total, ordered and bounded**
    - In `src/demo-disks/text-scan.props.test.ts`; Property 1 builds the text from tokens (phone-shaped numbers, dates, amounts, words, codes) and compares with the expected list; Property 2 uses arbitrary and full Unicode strings
    - **Validates: Requirements 8.2, 8.9**

- [x] 4. Generic builders
  - [x] 4.1 Create `src/demo-disks/content/cp437.ts` and `src/demo-disks/content/table.ts`
    - Design: "Generic builders (Property 3 and 4)"
    - `cp437.ts`: a small table of ASCII plus a few CP437 letters above 0x7F (for example `é`, `ñ`, `ü`) with their byte values
    - `table.ts`: `AuthoredField`, `AuthoredTable`, `tableToDbf` returning `{ bytes, expectedCsv }`; validates names (1 to 10 characters of `A-Z0-9_`), value fit, characters (printable ASCII or the CP437 table), no C value starting with `=`, `+`, `-` or `@`, no control character or trailing space; pads C left, N right, D as given; calls `writeDbf`; invalid input throws `DemoBuildError`
    - _Requirements: 1.1, 6.2, 6.3, 6.4_

  - [x] 4.2 Create `src/demo-disks/content/logo.ts`
    - Design: "Generic builders (Property 3 and 4)"
    - `AuthoredLogo`, `logoToPcx` returning `{ bytes, expectedRgba }`: fills a 256-entry palette (unused entries black), builds the index array, calls `encodePcx({ mode: 'indexed256', ... })`; `expectedRgba` is palette colour, alpha 255, row-major; invalid input (size 0, over 256, palette over 256 or empty, index out of range) throws `DemoBuildError`
    - _Requirements: 1.1, 6.5, 6.6_

  - [x] 4.3 Write tests for the builders
    - In `src/demo-disks/builders.test.ts`
    - Examples that reject bad tables (a C value starting with `=`, a value too long, an unknown character, a bad field name) and bad logos (zero width, palette index out of range)
    - _Requirements: 6.2, 6.3, 6.5_

  - [x]* 4.4 Write property tests for the builders
    - **Property 3: Table builder round trip**
    - **Property 4: Logo builder round trip**
    - In `src/demo-disks/builders.props.test.ts`; Property 3 converts with `convertAuto` and compares `parseCsv` of the output with `expectedCsv`; Property 4 uses width and height 1 to 24, palette 1 to 16 colours, and compares `decodePng` of the output with the authored size and `expectedRgba`
    - **Validates: Requirements 6.4, 6.6, 10.8**

- [x] 5. Authored content, disk plans and build
  - [x] 5.1 Create `src/demo-disks/content/prose.ts` and `src/demo-disks/content/readme.ts`
    - Design: "Disk plans" (chapter content), "Fixed values"
    - `prose.ts`: authored paragraphs in a fictional setting (a small-town ferry office, for example) for three chapters, two drafts, a letter and a memo, built with `writeWordStar`. The three live chapters together use at least one bold, one underline, one italic span, one `.PA` paragraph and one long paragraph wrapped with `wrapAt` to give soft returns. No paragraph starts with `#`, `-`, `+` or a digit followed by `.`, none contains `*`, `_`, `<`, `>`, `[`, `]`, a backtick or a backslash, none contains `@`, `http://`, `https://` or `www.`. Any phone number uses 555-0100 to 555-0199. No real person, company, address or e-mail.
    - `readme.ts`: the three `README.TXT` texts and the invoice text `INV8903.TXT`, plain ASCII with CR LF line ends. Every README holds the phrases `generated by the Exhume demo-disk script` and `written for the demo`; the damaged README names both defects ("the boot sector field for sectors per cluster is set to zero" and "the cluster chain of LETTER.WS loops back on itself"). The invoice has no leading `.xx` line and no phone-like digit group.
    - Export the two required marker phrases as constants so the checks use the same text
    - _Requirements: 5.3, 7.7, 8.1, 8.2, 8.3, 8.4_

  - [x] 5.2 Create `src/demo-disks/content/writers.ts`
    - Design: "Writer's disk, 360K, label WRITER DEMO"
    - One `DiskPlan` builder (`tree`, `damage`, `sources`): label `WRITER DEMO`; tree order `CHAPTER1.WS` (live), `DRAFT1.WS` (`deleted: true`, no placement, 3,073 to 4,096 bytes, four free clusters), `CHAPTER2.WS` (live), `DRAFT2.WS` (`deleted: true`, no placement, 1,100 to 2,048 bytes, two free clusters), `CHAPTER3.WS` (live, 4,097 to 5,120 bytes), `README.TXT` (live); every node has an explicit `modified`; chapter sizes between 2,048 and 16,384 bytes; damage `[{ type: 'size-exceeds-chain', path: '/DRAFT2.WS', extraBytes: 1024 }]` (the only damage); `sources` maps author paths to the `writeWordStar` bytes
    - _Requirements: 5.1, 5.2, 5.3, 5.5, 5.6, 5.7, 5.10, 3.3_

  - [x] 5.3 Create `src/demo-disks/content/office.ts`
    - Design: "Small-business disk, 720K, label OFFICE DEMO"
    - One `DiskPlan` builder: label `OFFICE DEMO`; `CUSTOMER.DBF` from `tableToDbf` (fields `CUSTNO` N(5,0), `NAME` C(24), `CITY` C(16), `PHONE` C(8), `SINCE` D(8), `BALANCE` N(9,2); 14 records; phones 555-0100 to 555-0199; at least two CP437 letters above 0x7F; no text cell starting with `=`, `+`, `-` or `@`; invented names and cities), `LOGO.PCX` from `logoToPcx` (64 by 40, five authored colours, no resemblance to a real brand), directory `INVOICES` holding `INV8903.TXT`, deleted `OLDCUST.DBF` (`deleted: true`, `placement: { startCluster: 2 }`, an older table of about 200 bytes), `README.TXT`; explicit `modified` on every node; no damage
    - Also export the authored table and logo so the checks compare against the same data
    - _Requirements: 6.1, 6.2, 6.3, 6.5, 6.7, 6.8, 6.10, 8.2, 3.3_

  - [x] 5.4 Create `src/demo-disks/content/damaged.ts`
    - Design: "Damaged disk, 360K, label DAMAGE DEMO"; Finding F2
    - One `DiskPlan` builder: label `DAMAGE DEMO`; `LETTER.WS` (live, 2,049 to 3,072 bytes, three clusters), `MEMO.WS` (live), `README.TXT`; explicit `modified`; damage list in this order: `{ type: 'invalid-bpb', field: 'sectorsPerCluster' }`, `{ type: 'cyclic-chain', path: '/LETTER.WS' }`, `{ type: 'size-exceeds-chain', path: '/LETTER.WS', extraBytes: 1024 }`. Add a comment that the last two damages are one defect, the looping chain, because a cyclic chain alone is not visible to the Reader.
    - _Requirements: 7.1, 7.2, 7.4, 7.6, 7.7, 7.10, 3.3_

  - [x] 5.5 Create `src/demo-disks/build.ts` and `src/demo-disks/index.ts`
    - Design: "Plans and the build function"
    - `DiskPlan`, `planOf(id)` (pure, calls the three plan builders), `FreshDisk`, `buildDemoDisk(id)` (`writeFat12Image(plan.tree, spec.geometry, { serial: spec.serial, damage: plan.damage })`, whole body in `try/catch`, any error rethrown as `DemoBuildError(spec.fileName, message)`), `buildAllDemoDisks()` (three disks in spec order, builds all before returning). `index.ts` is the public barrel.
    - Imports only `src/test-support/fat12/index`, `src/test-support/formats/index` and in-module files
    - _Requirements: 1.1, 1.4, 2.7, 2.8, 3.1, 3.2, 3.5, 4.1, 4.3, 4.8_

  - [x] 5.6 Write `build.test.ts`
    - In `src/demo-disks/build.test.ts`
    - `buildAllDemoDisks()` twice gives byte-identical images per disk; each length equals the geometry capacity, is at most 1,474,560 and at most `MAX_IMAGE_BYTES`; the sum of the three lengths is at most 4,423,680; a writer that throws becomes a `DemoBuildError` naming the file (use a plan with an impossible tree through a test-only call path, not a change to the plans)
    - _Requirements: 3.4, 3.6, 4.2, 4.3, 4.7, 2.7, 4.8_

- [x] 6. Checkpoint - Content and build (in-memory only)
  - Run `npx vitest --run src/test-support/demo-source-scan.test.ts src/demo-disks`. Run `npm run typecheck`. Both must exit 0. Do not run any other command from the working rules' forbidden list.
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Shared_Checks (pure functions over image bytes)
  - [x] 7.1 Create `src/demo-disks/checks/types.ts` and `src/demo-disks/checks/expected.ts`
    - Design: "Data Models" (expectation tables)
    - `CheckFailure { check, message }`; `ExpectedGrave`, `Expectation`, `expectationOf(id, plan)`: the exact `(path, kind, state)` tables typed by hand (not derived from the Reader or the writer): writers `/CHAPTER1.WS`, `/_RAFT1.WS` recovered, `/CHAPTER2.WS`, `/_RAFT2.WS` partial, `/CHAPTER3.WS`, `/README.TXT`; office `/CUSTOMER.DBF`, `/LOGO.PCX`, `/INVOICES` (directory), `/INVOICES/INV8903.TXT`, `/_LDCUST.DBF` lost, `/README.TXT`; damaged `/LETTER.WS` partial, `/MEMO.WS`, `/README.TXT`; sizes from `plan.sources` (`+ 1,024` for `/_RAFT2.WS`; chain bytes + 1,024 for `/LETTER.WS`; 0 for directories); dates from `dates.ts`; warning codes `[]`, `[]`, `['bpb-invalid', 'chain-cycle']`; the `noConverter` list (README and invoice text files)
    - _Requirements: 10.1, 10.2, 10.3, 5.5, 5.6, 6.8, 7.3, 7.5_

  - [x] 7.2 Create `src/demo-disks/checks/shape.ts`, `graves.ts` and `warnings.ts`
    - Design: "Shared_Checks" (groups `shape`, `graves`, `warnings`)
    - `shape`: length equals the geometry capacity, at most `MAX_IMAGE_BYTES` and at most 1,474,560; `volume.geometrySource` (`bpb`, `bpb`, `fallback`); `volume.label`; serial at offset `0x27` equals the spec serial; boot sector bytes 0 to 2 are `EB 3C 90` and bytes 62 to 509 are zero; at most 64 graves, no path deeper than two parts, no declared size above 65,536
    - `graves`: the exact table of `(path, kind, state)`; sizes and dates; `reason` absent for `alive` and non-empty otherwise; relations (`/_RAFT2.WS` start cluster + 2 equals the start cluster of `/CHAPTER3.WS`; `/_LDCUST.DBF` start cluster equals that of `/CUSTOMER.DBF`; `/_RAFT1.WS` spans at least three clusters; the writers disk has exactly two `recovered`/`partial` files and no `lost`; every non-deleted file is `alive` with no reason)
    - `warnings`: the sorted code list equals the expectation; the `chain-cycle` warning has path `/LETTER.WS`
    - Each group returns `CheckFailure[]` and never throws (an unexpected exception becomes a failure naming the group)
    - _Requirements: 3.3, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 5.1, 5.2, 5.5, 5.6, 5.7, 5.10, 5.11, 6.1, 6.7, 6.8, 6.10, 6.11, 7.1, 7.2, 7.3, 7.5, 7.6, 7.10, 10.1, 10.2, 10.3_

  - [x] 7.3 Create `src/demo-disks/checks/reads.ts` and `features.ts`
    - Design: "Shared_Checks" (groups `reads`, `features`)
    - `reads`: for every non-lost grave `readBytes` returns without throwing and `ok` is true except for the `noConverter` files; live read bytes equal the source bytes; `/_RAFT1.WS` read bytes equal the source and `convertAuto` with name hint `_RAFT1.WS` gives the same Markdown as the converter on the source; `/_RAFT2.WS` returns fewer bytes than declared and converts (name hint `_RAFT2.WS`) with `ok` true and non-empty text; `/LETTER.WS` returns in finite time (wrap the call in `timed(fn, SCAN_TIME_BUDGET_MS)` from `src/test-support/timed.ts`) and at most the declared size; `/_LDCUST.DBF` returns the Reader's lost result and no conversion is attempted; `/CHAPTER1.WS` converts to Markdown with authored text and an emphasis marker; `/CUSTOMER.DBF` converts to CSV equal (via `parseCsv`) to the table's expected rows; `/LOGO.PCX` converts to a PNG that `decodePng` reads as the authored width, height and pixels
    - `features`: the chapter sources together contain `0x02`, `0x13`, `0x19`, a `0x8D 0x0A` pair and a line starting with `.` plus two letters; `CUSTOMER.DBF` has at least five fields, at least 12 records, a C field named with `PHONE`, an N field, a D field and a byte above 0x7F; `LOGO.PCX` is at most 256 by 256 with at least four distinct colours used
    - _Requirements: 5.2, 5.3, 5.4, 5.8, 5.9, 6.2, 6.3, 6.4, 6.5, 6.6, 6.9, 7.8, 7.9, 10.4, 10.5_

  - [x] 7.4 Create `src/demo-disks/checks/markers.ts` and `texts.ts`
    - Design: "Shared_Checks" (groups `markers`, `texts`), "The text of a disk"
    - `markers`: each `README.TXT` is plain ASCII and holds both marker phrases; the damaged README names both defects; volume labels match the specs; no grave (deleted entries included) has an extension in `EXE COM BAT SYS SCR PIF VBS JS`, case-insensitive
    - `texts`: collect the text (plain text files byte-for-byte, WordStar Markdown, DBF CSV including headers and the lost file's source, PCX skipped); `scanLinks` finds nothing anywhere; `scanPhones` matches within the Phone_Scope (PHONE columns, all WordStar text, each README) are all reserved; every value of the column whose header contains `PHONE` is a full-string reserved phone; a `too-long` result is a failure
    - _Requirements: 7.7, 8.2, 8.4, 8.5, 8.8, 8.9, 6.2_

  - [x] 7.5 Create `src/demo-disks/checks/index.ts`
    - Design: "Shared_Checks"
    - `runSharedChecks(id, image)` opens the image once with `openDisk`, gets `planOf(id)` and the expectation, runs the groups `shape`, `graves`, `warnings`, `reads`, `features`, `markers`, `texts` and returns the concatenated `CheckFailure[]` (empty means all pass); never throws and reads no clock or file system. Export it from `src/demo-disks/index.ts`.
    - _Requirements: 10.1, 10.9, 10.11_

  - [x] 7.6 Write `shared-checks.test.ts`
    - In `src/demo-disks/shared-checks.test.ts`
    - `runSharedChecks(id, buildDemoDisk(id).image)` returns `[]` for each of the three disks
    - Mutation tests prove the checks bite, each returning at least one failure from the right group: (a) set the FAT entry of the first cluster of `CHAPTER3.WS` to free so `/_RAFT2.WS` is no longer `partial`; (b) swap the label bytes; (c) change one byte of a `README.TXT` marker phrase; (d) flip the cyclic link of `LETTER.WS`; (e) put a boot-code byte at offset 100; (f) change a PHONE cell to a non-reserved number
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.9, 10.11_

- [x] 8. Checkpoint - Shared_Checks (in-memory only)
  - Run `npx vitest --run src/demo-disks src/test-support/demo-source-scan.test.ts` and `npm run typecheck`. Both must exit 0. If a check fails on the fresh images, fix the authored content (task 5) and not the check.
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. CLI core and Node shell
  - [x] 9.1 Create `src/demo-disks/cli.ts`
    - Design: "The CLI core", "Error Handling"
    - `CliIo`, `CliDeps` (defaults: `buildAllDemoDisks`, and a `verify` that runs `runSharedChecks` on each Fresh_Image), `DISKS_DIR` (`public/disks`), `USAGE`, `runCli(args, io, root, deps?)` returning `0 | 1`: unknown arguments print the usage and return 1 before any work; build inside `try/catch` printing `failed to build <file>: <message>`; check mode reads each committed file, prints `missing: <file>` or `differs: <file>`, writes nothing; write mode runs `verify`, prints `check failed: <check>: <message>` and writes nothing on a failure, otherwise `makeDir` then writes the exact Fresh_Image bytes of the three files only; a failed write is caught and reported with exit status 1. Paths are `/` joins on `root`; the file imports no `node:` module.
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 3.8_

  - [x] 9.2 Create `scripts/make-demo-disks.ts`
    - Design: "How the script runs"
    - The only file that imports `node:fs`: check that `package.json` exists in `process.cwd()` (otherwise print "run it from the repository root" and set exit status 1), build the `nodeIo` adapter (`readFile` returns `undefined` only for `ENOENT`; any other error is caught by a top-level `try/catch` that prints the message and sets exit status 1), then `process.exitCode = runCli(process.argv.slice(2), nodeIo, root)`. Do NOT run it.
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

  - [x] 9.3 Write `cli.test.ts`
    - In `src/demo-disks/cli.test.ts` with a fake `CliIo` and fake `CliDeps`; nothing touches the real file system or `public/disks/`
    - Examples: write mode writes exactly the three paths, in order, with the exact bytes, after creating the folder; `--check` with all equal exits 0 and writes nothing; one differing, one missing and all differing exit 1, print the right names and write nothing; a build failure on the first, second and third disk writes nothing and names the disk; a verify failure writes nothing; a failing `writeFile` returns 1
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 3.8_

  - [x]* 9.4 Write property test for argument handling
    - **Property 6: Unknown arguments are refused before any work**
    - Add to `src/demo-disks/cli.test.ts`; arrays of strings that are neither `[]` nor `['--check']`; assert return 1, no `build`, no `verify`, no `writeFile`, no `makeDir`, usage printed
    - **Validates: Requirements 2.6**

- [x] 10. Generator source and import scans
  - [x] 10.1 Write `generator-sources.scan.test.ts`
    - In `src/demo-disks/generator-sources.scan.test.ts`
    - Run `scanGeneratorSource` over `scripts/make-demo-disks.ts` and every non-test `.ts` file under `src/demo-disks/` (read with `node:fs`, files discovered by a sorted directory walk) and expect zero violations, printing file, line and name on failure
    - Import scan with `moduleRefs` and `isRelative` from `src/test-support/scan.ts`: every specifier is `node:`-prefixed (only in the script, and only `node:fs`) or relative; relative imports stay inside the Generator or resolve to `src/test-support/fat12/index`, `src/test-support/formats/index`, `src/core/fat12/index` or `src/core/formats/index`; files outside `checks/` and `cli.ts` import nothing from `src/core`; `cli.ts` imports no `node:` module; no dynamic `import()` and no `require`
    - `package.json` examples: `make:demos` exists, the `build` script does not mention it, and `dependencies`, `devDependencies` and `optionalDependencies` are unchanged against the values pinned in the test
    - _Requirements: 1.3, 1.4, 1.5, 1.6, 2.1, 2.9_

- [x] 11. Web registry
  - [x] 11.1 Fill `DEMO_REGISTRY` in `src/web/demos.ts`
    - Design: "Registry entries"; Finding F4
    - Change only the comment above `DEMO_REGISTRY` and its content: three entries in the order `writers-disk`, `office-disk`, `damaged-disk` with the titles, descriptions and URLs `/disks/<file>` shown in the design. Leave `loadDemoBytes`, its request options and every import unchanged.
    - _Requirements: 9.1, 9.2, 9.3, 9.5, 9.9_

  - [x] 11.2 Edit `src/web/demos.test.ts` (one minimal change)
    - Change only the empty-registry test so that it asserts the three Demo_Entries (ids and URLs) instead. Touch no other test in the file.
    - _Requirements: 9.6_

  - [x] 11.3 Edit `src/web/dom/demo-slot.dom.test.ts` (one minimal change)
    - Change only the test that uses the default registry so that it passes an explicit empty array `[]` as the registry argument to `createDemoSlot`. Touch no other test. Run it with `npm run test:dom` at checkpoint 12.
    - _Requirements: 9.6_

  - [x] 11.4 Write `src/web/demos.registry.test.ts`
    - Three entries in order; ids and URLs equal `DEMO_DISK_SPECS` (`/disks/` + file name); title 1 to 80 and description 1 to 200 characters, no line break; `validateDemoDisk` returns `ok` for each; descriptions hold the keywords of Requirement 9.3 (`WordStar` and `two deleted`; `customer table`, `logo` and `lost`; `broken` and `warnings`); each URL begins with `/disks/` and has no scheme, host or query string
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.9_

- [x] 12. Checkpoint - Everything in memory
  - Run `npm test` (single run) and `npm run test:dom` and `npm run typecheck`. The only tests allowed to fail are none at this point, because task 14 is not written yet. Do not run `npm run build` or `npm run make:demos`.
  - Ensure all tests pass, ask the user if questions arise.

- [x] 13. README
  - [x] 13.1 Add the demo-disks section to `README.md`
    - Design: Testing Strategy (`readme.test.ts`)
    - List the three files in `public/disks/` with one sentence each and the expected state of each deleted file (`/_RAFT1.WS` recovered, `/_RAFT2.WS` partial, `/_LDCUST.DBF` lost); state that the images are generated by `scripts/make-demo-disks.ts`, that the content is authored by the project, and that they are not recovered archive material; name `npm run make:demos` and `npm run make:demos -- --check`; state that the same commit produces the same bytes; state that the damaged disk is broken on purpose in two ways (a bad BPB field and a cyclic cluster chain). Leave the prior-art credit to andete/disk-peek intact and make no "first" claim.
    - Do not edit `docs/KIRO_LOG.md` (only when the user asks)
    - _Requirements: 8.6, 8.7, 11.1, 11.2, 11.3, 11.4_

  - [x] 13.2 Write `readme.test.ts`
    - In `src/demo-disks/readme.test.ts`
    - The README names `scripts/make-demo-disks.ts`, `public/disks/`, `npm run make:demos`, `npm run make:demos -- --check`, the three file names, the states `recovered`, `partial` and `lost`, the two defects, the determinism sentence and the phrase "not recovered archive material"; it still holds `disk-peek` and holds neither "first browser" nor "first in the browser"
    - _Requirements: 8.6, 8.7, 11.1, 11.2, 11.3, 11.4_

- [x] 14. Committed_Image tests (may fail until the user generates the images)
  - [x] 14.1 Write `committed.test.ts`
    - In `src/demo-disks/committed.test.ts`
    - These are the only tests allowed to fail before the user runs the generator. They only read `public/disks/<file>` (path from `import.meta.url`); nothing is written anywhere (temporary files, if any, go under `os.tmpdir()` and are removed)
    - For each disk: committed bytes equal the Fresh_Image; committed length equals the Fresh_Image length and is at most `MAX_IMAGE_BYTES`; `runSharedChecks(id, committedBytes)` returns `[]`. For each `DEMO_REGISTRY` URL: the file under `public/` exists and its length equals the Fresh_Image length and is at most `MAX_IMAGE_BYTES`
    - A missing or different file fails with: "Committed image public/disks/<file> is missing or differs from the generated one. Run `npm run make:demos` and commit the result." The message builder takes an injected reader and has a small in-memory test that does not touch the real folder
    - _Requirements: 3.7, 4.7, 9.7, 10.7, 10.10, 10.11, 10.12_

- [~] 15. Final checkpoint - Hand over to the user (MANUAL, NOT executable by the agent)
  - The coding agent STOPS here and hands over. It must not run `npm run make:demos` (with or without `--check`), `npm run build`, or write anything in `public/disks/`.
  - The user reviews the authored content once before the first run: fictional names, businesses and cities; phone numbers (only 555-0100 to 555-0199); the prose in `src/demo-disks/content/prose.ts` and `readme.ts`; the logo; and that no real person, company, address, e-mail, secret or token appears (Requirements 8.2, 8.3).
  - The user then runs, in this order: `npm run make:demos`, then `npm run make:demos -- --check`, commits the three images in `public/disks/`, runs `npm test` (the Committed_Image tests of task 14 must now pass), and runs `npm run build` and confirms `dist/disks/writers-disk.img`, `dist/disks/office-disk.img` and `dist/disks/damaged-disk.img` equal the committed images (Requirement 9.8).
  - Optionally record the spec in `docs/KIRO_LOG.md`, only if the user asks.
  - _Requirements: 2.10, 8.2, 8.3, 9.8, 10.12, 11.5_

## Notes

- Tasks marked with `*` are optional property tests and can be skipped for a faster MVP. Example tests, scan tests, the in-memory Shared_Checks and the Committed_Image tests are not optional.
- Each task references the requirements it satisfies and the design sections it follows.
- Checkpoints 6, 8 and 12 prove the disk contents on Fresh_Images in memory, before any file exists in `public/disks/` (Requirement 10.11).
- Requirement 1.2 (nothing changed under `src/core/` and the existing `src/test-support/` files) is checked by reviewing the diff, not by a test. Requirements 2.10 and 11.5 are process rules for the agent.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.1", "3.1"] },
    { "id": 1, "tasks": ["1.3", "1.4", "3.2", "3.3", "4.1", "4.2", "5.1", "11.1"] },
    { "id": 2, "tasks": ["4.3", "4.4", "5.2", "5.3", "5.4", "11.2", "11.3", "11.4", "13.1"] },
    { "id": 3, "tasks": ["5.5", "13.2"] },
    { "id": 4, "tasks": ["5.6", "7.1"] },
    { "id": 5, "tasks": ["7.2", "7.3", "7.4"] },
    { "id": 6, "tasks": ["7.5"] },
    { "id": 7, "tasks": ["7.6", "9.1"] },
    { "id": 8, "tasks": ["9.2", "9.3", "9.4", "14.1"] },
    { "id": 9, "tasks": ["10.1"] }
  ]
}
```
