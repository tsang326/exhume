# Implementation Plan

## Conventions for every task below

- **Evidence directory.** `EVIDENCE=$(node -p "require('os').tmpdir()")/exhume-flaky-evidence`. Create it with `mkdir -p "$EVIDENCE"` before the first run. Files go under `os.tmpdir()`, never in the repo.
- **Every full-suite run** uses exactly this form, with a distinct `N` (the task says which name to use):
  `npx vitest run --reporter=json --outputFile="$EVIDENCE/run-N.json"`
  Never use plain `npm test` for a full run, so a failure is captured by test name.
- **Naming the failures in a report.** After each full run, list failing tests with:
  `node -e "const r=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));for(const f of r.testResults)for(const t of f.assertionResults)if(t.status==='failed')console.log(f.name+' :: '+t.fullName)" "$EVIDENCE/run-N.json"`
  A file-level failure (import error) shows as a `testResults` entry with `status: 'failed'` and no assertions; print those too.
- **Single-file runs** (for example `src/web/logic/markdown.test.ts`) are not full-suite runs and may use the default reporter.
- **`npm run typecheck` and `npm run test:dom` are not full-suite JSON runs.** `test:dom` is a separate vitest config and uses its normal reporter; record failing test names from its output. `typecheck` is reported as pass or fail with the compiler errors, if any. Neither is saved as a `run-N.json` file.
- **Expected RED.** From task 12.1 onward `src/mcp/build.test.ts` (stale-build test) is RED, because a bundled source file changed. From task 20 onward the new stdio case in `src/mcp/stdio.workspace.test.ts` is also RED. Both stay RED until the owner-approved `npm run build:mcp` in task 21. **Do not "fix" them by editing `power/server/exhume-mcp.mjs`, by loosening the tests, by regenerating the bundle any other way, or by skipping them.** Any other red test is a real problem and must be fixed or reported.
- **No commits** in any task. **No edits to `docs/KIRO_LOG.md`** (a hook handles it). `exhumed/CHAPTER1.md` is never edited.
- **Scratch work** (old-function copies, benchmarks, mutations, golden transform script) lives under `os.tmpdir()`, outside the repo, and is deleted at the end of its task. None of it is committed or left in the working tree.
- Fast-check property callbacks return a boolean or nothing, never `expect(...)`.

## Phase 0: Baseline

- [x] 1. Record a baseline full-suite run
  - Run `mkdir -p "$EVIDENCE"`, then one full run saved as `run-baseline.json`
  - List failing tests by name. Expected: none (the owner reported 1752 tests, 0 failed, 1 pending)
  - If anything is red before any change, stop and report it to the owner; do not proceed
  - _Requirements: 2.6_

## Phase 1: Item B (flaky timing test). Bundle is not affected; suite stays green

- [x] 2. Prepare the throwaway reference for Item B
  - Create a scratch directory under `os.tmpdir()`
  - Save the pre-change parser verbatim: `git show HEAD:src/web/logic/markdown.ts` into the scratch directory as `markdown.old.ts`, with its imports fixed to resolve from the scratch location (or copied together with any helper it imports)
  - Do not edit `src/web/logic/markdown.ts` before this copy exists
  - _Requirements: 2.5, 3.7_

- [x] 3. Add the counter seam to `src/web/logic/markdown.ts` (minimal and local, Spec 9 parallel)
  - Keep the diff small: one exported `MarkdownStats` interface, one exported `parseMarkdownWithStats(text)`, `parseMarkdown` reduced to a one-line wrapper with the same name, parameter and return type, and about eight counter statements. Nothing else in the file moves
  - Counters (`lineSteps`, `scanSteps`, `events`, `pairSteps`) are `let` locals inside `buildParagraph` and `parseMarkdown`, returned once per paragraph, not module-level and not object fields
  - `scanSteps`: one per pass of `while (i < len)`, plus `j - i` after each `*` run, plus one per pass of `while (n > 0)`. `events`: `events.length` at the end of each paragraph. `pairSteps`: one per pass of the pairing `for`. `lineSteps`: one per line taken in `parseMarkdown`
  - No `performance.now()`, no new dependency, no change to rendering, DOM or any other file in `src/web`
  - _Requirements: 2.5, 3.7_

- [x] 4. Replace the wall-clock test in `src/web/logic/markdown.test.ts`
  - Replace only the last test (`parses in linear time: doubling the input does not more than triple the time`) with the counter-based test from the design: 1M and 2M periodic inputs, every counter ratio within `[1.98, 2.02]`, non-vacuity bound (`scanSteps` of the 1M input at least 500,000), plus the structural check on whole units (`blocks.length`, `dropped` and node count scale by exactly 2)
  - Add a small iterative `countNodes` walker in the test file (or reuse the existing `walkModel`)
  - Remove `performance.now()`, the median logic, the 5 ms skip and the `ctx` argument. The other 12 tests stay unchanged
  - Run `npx vitest run src/web/logic/markdown.test.ts`; expect 13/13 green
  - _Requirements: 2.5, 3.7_

- [x] 5. Write the identical-output property against the throwaway old function
  - **Property 4: Preservation** - `parseMarkdown` is unchanged
  - Throwaway test file in the scratch directory (not in the repo, not committed): import `markdown.old.ts` (task 2) and the new `src/web/logic/markdown.ts`
  - Fixed corpus: empty string, `'\n'`, `'---'`, `'a\n---\n\nb'`, every string literal in `markdown.test.ts`, converter-shaped samples from `src/test-support/web/md-emitter.ts`, and a 1M periodic sample
  - fast-check property, at least 1,000 runs, over `fc.string()`, strings biased toward `*`, `\`, digits, `-`, `#` and `\n`, and the md-emitter arbitrary: `JSON.stringify(old(t)) === JSON.stringify(new(t))` and `JSON.stringify(parseMarkdownWithStats(t).model) === JSON.stringify(new(t))`. Returns a boolean
  - Run it (for example with `npx vitest run --root` pointing at the scratch setup, or a small script run with Node 22+ type stripping). **EXPECTED OUTCOME**: all pass. Record the number of runs and corpus size
  - _Requirements: 3.7, 3.8_

- [x] 6. Prove no measurable slowdown with an interleaved benchmark (throwaway)
  - Scratch script: load the old copy and the new file, same 1M, 2M and short-paragraph inputs, 5 warm-up runs each, then at least 30 **interleaved** runs (old, new, old, new, ...) with `performance.now()`
  - Compare medians and interquartile ranges. Accept if `median(new) <= 1.03 * median(old)` and the IQRs overlap
  - If the machine noise cannot resolve 3%, say so in the final report; do not claim "no change"
  - Record the numbers for the report. Do not commit the script
  - _Requirements: 2.5, 3.7_

- [x] 7. Run the throwaway quadratic mutation check
  - **Property 3: Bug Condition** - the linear-time verdict is deterministic and still catches super-linear parsing
  - In a scratch copy of the tree or of `markdown.ts` plus the new test (never in the repo working tree), apply three mutations one at a time and run the new linear-time test against each:
    - (a) pairing loop: add an inner re-walk such as `for (let q = 0; q < e; q++) pair++;`
    - (b) scan: re-scan the line from `runStart` on every `*`
    - (c) `parseMarkdown`: re-count lines from the start for each line
  - **EXPECTED OUTCOME**: each mutation fails the ratio assertion (ratio about 4). Also run the unmutated copy to show it passes, and run the test twice on the same copy to show the verdict is identical
  - Record that a quadratic cost hidden inside a single native call (`slice`, `indexOf`, string concatenation) is not detected
  - **Owner note (runs hung twice, 2026-11-10).** A mutation written as a real loop (`for (let q = 0; q < i; q++) scan++;`) makes the 2M-character long-line input run for hours, and Vitest's test timeout cannot interrupt synchronous code. So: (1) write each mutation as a direct counter increment with the same quadratic total (for example `scan += i - lineStart;` or `pair += e;`), so the step count is quadratic but the run stays fast; (2) still pass `timeout: 120_000` to every `spawnSync` call, and count a timed-out run as "caught" in the report; (3) run one driver at a time, never two in parallel
  - Confirm afterwards with `git status --short` that no mutation reached the repo, then delete the scratch directory
  - _Requirements: 2.5, 2.7_

- [x] 8. Run the repaired markdown file 10 times
  - Run `npx vitest run src/web/logic/markdown.test.ts` ten times in a row; all must be green. Record any failing test name
  - This is a first check; the final 10 and 5 repeated runs are in task 24
  - _Requirements: 2.6_

- [x] 9. Checkpoint after Item B
  - One full run saved as `run-after-b.json`; list failing tests by name. Expected: none
  - Run `npm run typecheck`; report the result. Expected: no errors
  - `git status --short` should show only `src/web/logic/markdown.ts` and `src/web/logic/markdown.test.ts` changed
  - Ask the owner if questions arise

## Phase 2: Item A source and unit/property tests (bundled source: `build.test.ts` goes RED here)

- [x] 10. Write the bug condition exploration test for Item A
  - **Property 1: Bug Condition** - Empty or whitespace-only `--root` is a start failure
  - **IMPORTANT**: Write this BEFORE the fix. **Scoped PBT Approach**: scope to the concrete failing values `''`, `' '`, `'   '`, `'\t'`, `'\n'`, `'\u00a0'`, `'\u2003'`, `'\ufeff'`
  - In `src/mcp/paths.test.ts` inside `describe('resolveRoot')`: `it.each` over the values, `resolveRoot(['--root', v], w.root, nodeFs)` equals `reject('INVALID_ARGUMENTS')` (`w.root` exists, so the old code starts there)
  - Add a `recordingFs` case: for `''` and `'  '` the recorded call list is empty (proves the check runs before `realpath`)
  - Add the same blank values to `src/mcp/launch.test.ts` (`resolveLaunch(['--root', v], cwd, nodeFs)` equals `INVALID`), plus `[flag, '--root', '']` stays `INVALID`
  - Run these files on the UNFIXED code. **EXPECTED OUTCOME**: the new cases FAIL (`ok: true` with the working directory). Record the counterexamples
  - _Requirements: 1.1, 1.2, 2.1, 2.2_

- [x] 11. Write preservation tests for Item A
  - **Property 2: Preservation** - Every other launch list classifies as before
  - **IMPORTANT**: observation-first. On UNFIXED code observe: `[]` gives default with the realpath of the working directory; `['--root', existingDir]` gives its realpath; a directory literally named ` pad ` (created with `mkdirSync(join(w.root, ' pad '))`) starts; `' ' + w.root` (leading space) is rejected and not trimmed; `['--workspace-from-agent']` gives workspace; every already-rejected list stays `INVALID_ARGUMENTS`
  - Add the padded-directory and leading-space cases to `paths.test.ts`. The existing cases stay untouched
  - Run on UNFIXED code. **EXPECTED OUTCOME**: PASS
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 12. Fix Item A: empty or whitespace-only `--root`

  - [x] 12.1 Implement the fix in `src/mcp/paths.ts`
    - In the `--root` branch of `resolveRoot`, before `realpath`, return `{ ok: false, code: 'INVALID_ARGUMENTS' }` when `value.trim().length === 0`, with a short comment (an unset launcher variable; `realpath('')` is the working directory)
    - Do not trim the value that is passed on; do not touch `resolveLaunch`, `main.ts`, Workspace_Mode, the tool list or confinement
    - _Bug_Condition: isBugConditionA(argv) where argv = ['--root', X] and trim(X) = ''_
    - _Expected_Behavior: INVALID_ARGUMENTS with no file-layer call; the built server exits 1 with the fixed line_
    - _Preservation: every other argv classifies as before_
    - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 12.2 Correct the reference model in `src/mcp/launch.props.test.ts`
    - Replace `if (path === '') return true;` and its comment in `isExistingDir` with `if (path.trim() === '') return false;` and a comment that an empty or whitespace-only value is a launcher mistake
    - Add `fc.constantFrom('', ' ', '\t', '  \n', '\u00a0')` to `token()`
    - Add a property: for any string joined from `fc.array(fc.constantFrom(' ', '\t', '\n', '\r', '\u00a0', '\u2003', '\ufeff'))`, `resolveLaunch(['--root', w], dir, recordingFs)` is invalid with zero recorded calls. The callback returns a boolean
    - _Requirements: 1.3, 2.3_

  - [x] 12.3 Verify the bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Empty or whitespace-only `--root` is a start failure
    - Re-run the SAME tests from task 10; do NOT write new ones. **EXPECTED OUTCOME**: PASS
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 12.4 Verify preservation tests still pass
    - **Property 2: Preservation** - Every other launch list classifies as before
    - Re-run the SAME tests from task 11 plus the unchanged `paths.test.ts`, `launch.test.ts` and `launch.props.test.ts`. **EXPECTED OUTCOME**: PASS, with no edits to pre-existing cases
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 13. Checkpoint after Item A
  - One full run saved as `run-after-a.json`; list failing tests by name
  - Run `npm run typecheck`; report the result. Expected: no errors
  - **EXPECTED RED: `src/mcp/build.test.ts` only** (stale bundle). Do not fix it by editing the bundle; it is resolved by the rebuild in task 21
  - Any other failure is a real problem: fix it or report it
  - _Requirements: 3.6_

## Phase 3: Item C (WordStar paragraph breaks)

- [x] 14. Prepare the throwaway old converter for Item C
  - In a scratch directory under `os.tmpdir()`, save the old converter and what it imports for comparison: `git show HEAD:src/core/formats/wordstar.ts` (and any sibling module it imports, saved from HEAD as well), with imports resolved from the scratch location
  - Do not edit `src/core/formats/wordstar.ts` before this copy exists
  - _Requirements: 3.9, 3.10, 3.11_

- [x] 15. Write the bug condition exploration test for Item C
  - **Property 5: Bug Condition** - Paragraph normal form
  - **IMPORTANT**: Write this BEFORE the fix, in a new file `src/core/formats/wordstar.paragraphs.props.test.ts` (plus examples in the same file or `wordstar.paragraphs.test.ts`)
  - **Scoped PBT Approach**: concrete counterexamples first: `a CRLF b CRLF` expects `a\n\nb\n`; the four hard-return forms (`0D 0A`, `0D 8A`, lone `0A`, lone `0D`, lone `8D`) between `a` and `b` expect `a\n\nb`; the `CHAPTER1` test: convert `writeWordStar(CHAPTER1)`, assert 11 paragraphs when split on `\n\n`, none containing `\n`, no `\n\n\n`, paragraph texts equal the 11 authored paragraphs (with markers for the bold heading)
  - Normal-form property over `biasedArb` (reuse from `wordstar.output.test.ts` or export it from a shared test-support module): output has no `\n\n\n`, does not start with `\n`, does not end with `\n\n`; for generated content lines, `convert(lines joined by CRLF + CRLF)` equals `lines.join('\n\n') + '\n'`
  - Run on the UNFIXED converter. **EXPECTED OUTCOME**: the examples, the CHAPTER1 test and the paragraph-model property FAIL (single `\n` output). Record counterexamples such as `a\nb\n`
  - _Requirements: 1.7, 2.8, 2.9, 2.10_

- [x] 16. Write preservation tests for Item C
  - **Property 6: Preservation** - Removing blank lines gives the old output
  - **IMPORTANT**: observation-first. On UNFIXED code observe byte-for-byte outputs for inputs with no hard return followed by text: empty input, a single line, soft returns only (`0x8D 0x0A`, `0x8D 0x8A`), soft hyphens, soft spaces, style toggles, escapes, dot commands other than `.PA`
  - Add example tests to the new paragraphs test file asserting those exact outputs; add the marker-balance property (`lineMarkersBalanced` for every output line) and the totality/determinism/alphabet/cap/`output-capped` property (reuse the cap arbitrary of `wordstar.output.test.ts`). These all PASS on UNFIXED code
  - Throwaway differential harness in the scratch directory (not committed), using the old copy from task 14: over `biasedArb` with `.PA` excluded, `dropBlank(new) === dropBlank(old)` where `dropBlank` deletes empty and space-only lines, and warning codes and messages are equal; for inputs with `.PA`, equal after also deleting `---` lines. Run it against the UNFIXED converter now (old equals new, trivially PASS) to confirm the harness itself works
  - **EXPECTED OUTCOME**: PASS on unfixed code
  - _Requirements: 3.9, 3.10, 3.11, 3.12_

- [x] 17. Fix Item C: hard return becomes a paragraph break

  - [x] 17.1 Implement the converter change in `src/core/formats/wordstar.ts` only
    - Add three local booleans in `convert()`: `hasOut` (set by `writeChar` when a visible character is written), `needBlank` (set by `writeHard` when it ends a content line), `ruleDue` (set by a `.PA` line when `hasOut`)
    - `writeHard()`: if `textCol > 0`, keep the existing cap check, close open markers, write pending spaces, push one LF and set `needBlank = true`; otherwise (empty or space-only line) drop pending spaces and write nothing. Reset the existing flags as today. Markers still close before the line feed
    - `writeChar(c)`: compute `prefix = ruleDue ? PA_BLOCK : needBlank ? "\n" : ""`, include `prefix.length` in `groupLen` before the cap check, push the prefix before spaces and reopened markers, clear `ruleDue` and `needBlank`, set `hasOut = true`. `atLineStart` logic is unchanged so line-start escapes behave as before
    - `.PA` branch: replace the eager `PA_BLOCK` push and its cap check with `if (hasOut) ruleDue = true;` and keep `atBreak = true`. Other dot commands and `..` comments unchanged
    - End of document: drop `needBlank` and `ruleDue`; the final flush writes `pendingSpaces` only when `textCol > 0 || !hasOut`
    - Keep the loop linear: no recursion, no regex, every loop step still consumes at least one input byte. No change in `src/web`, `src/mcp` or `src/core/fat12`; no change to limit constants
    - _Bug_Condition: isBugConditionC(bytes) where a content line ends at a hard return and a later content line exists_
    - _Expected_Behavior: exactly one blank line between content lines; no run of blank lines; no leading or trailing blank line; markers closed before the line feed_
    - _Preservation: dropBlank(new) = dropBlank(old) without .PA; soft returns, soft hyphens, soft spaces, styles, escapes, warnings unchanged_
    - _Requirements: 2.8, 2.9, 3.9, 3.10, 3.11, 3.12_

  - [x] 17.2 Update `wordstar.golden.test.ts` by mechanical transform, not by regeneration
    - Throwaway script in the scratch directory maps each old `EXPECTED` string to the new one: turn each paragraph-ending `\n` that is not part of an existing `\n\n---\n\n` block into `\n\n`, and collapse the empty-paragraph case. Apply its result to the 10 changing entries (`demo:chapter1`, `chapter2`, `chapter3`, `draft1`, `draft2`, `letter`, `memo`, `fixed:two paragraphs`, `fixed:bold heading`, `fixed:empty paragraphs` = `top\n\nbottom\n`). The 7 other entries stay unchanged
    - Do NOT paste converter output into the file. The test then compares converter output to those strings
    - Review check, to show to the owner in the report: removing blank lines from each new string gives the previous string, and the file diff with blank lines ignored is empty except for the `empty paragraphs` entry
    - Update the header comment with a dated note that Item C changed paragraph spacing on purpose
    - _Requirements: 1.9, 2.10_

  - [x] 17.3 Update the example and model tests on purpose
    - `wordstar.examples.test.ts` (7 assertions): `'one two\nthree\n'` to `'one two\n\nthree\n'`; the four hard-return forms `'a\nb'` to `'a\n\nb'`; `'.5\n. x\n'` to `'.5\n\n. x\n'`; the bold/underline/italic fixture becomes three paragraphs. Leave the `.PA` example, the soft-return-at-start example, empty input, and the 4 MiB tests unchanged. Add: leading hard returns write nothing, `a CRLF CRLF CRLF b` equals `a CRLF b`, trailing `.PA` writes nothing, doubled `.PA` gives one rule
    - `wordstar.softspace.examples.test.ts` (3 assertions): `'a  \nb\n'`, `'a \nb\n'`, `'a  \nb\n'` become `'a  \n\nb\n'`, `'a \n\nb\n'`, `'a  \n\nb\n'`
    - `wordstar.text.test.ts`: change only the "passes Plain_ASCII_Text through" model to keep lines with a non-space byte joined by `\n\n` (a single space-only line document expects that line)
    - `wordstar.styles.test.ts` Property 12: keep only paragraphs with visible text and compare against the output split on `\n\n`
    - `wordstar.dots.test.ts`: rewrite the model as a reference function with the lazy rule (text runs joined by one blank line, a rule only between content, duplicates collapsed, none at the ends, spaces and empty lines dropped)
    - Leave `wordstar.regress.test.ts` and `wordstar.output.test.ts` untouched; if either fails, report why before editing
    - Each edit is made on purpose with the cause named (blank line, dropped leading/trailing/space-only lines, collapsed runs). No silent loosening of assertions
    - _Requirements: 1.9, 2.10, 3.9, 3.10_

  - [x] 17.4 Complete the new Item C tests
    - In `wordstar.paragraphs.props.test.ts` add: runs absorbed (`convert(P CRLF Q)` equals `convert(P CRLF (CRLF | spaces CRLF){k} Q)` for generated plain segments, k >= 1); repeated `.PA` gives one rule; `.PA` before the first or after the last content writes nothing; bold across a break (markers close before the line feed and reopen after the blank line); soft return before a hard return; document ending without a return
    - Callbacks return booleans, never `expect(...)`
    - _Requirements: 2.9, 3.10, 3.12_

  - [x] 17.5 Verify the bug condition exploration test now passes
    - **Property 5: Expected Behavior** - Paragraph normal form
    - Re-run the SAME tests from task 15; do NOT write new ones. **EXPECTED OUTCOME**: PASS
    - _Requirements: 2.8, 2.9, 2.10_

  - [x] 17.6 Verify preservation tests still pass and run the differential proof
    - **Property 6: Preservation** - Removing blank lines gives the old output
    - Re-run the SAME tests from task 16, then re-run the throwaway differential harness against the real new converter. **EXPECTED OUTCOME**: PASS. Inputs without `.PA`: `dropBlank(new) === dropBlank(old)` and equal warnings; with `.PA`: equal after also deleting `---` lines; inputs with no hard return followed by text: byte-for-byte equal. Where the cap is hit, only the position of `output-capped` may differ, by at most the added line feeds
    - _Requirements: 3.9, 3.10, 3.11, 3.12_

  - [x] 17.7 Prove runs are absorbed and bounds hold
    - **Property 7: Preservation** - Runs of line ends are absorbed (required properties in the repo file from 17.4, run here)
    - **Property 8: Preservation** - Totality, determinism and bounds. In the throwaway harness with the old converter, also assert uncapped `new.length <= old.length + hardReturns`; in the repo file assert no throw, equal repeated results, alphabet printable ASCII plus `\n`, `output.length <= cap`, and `output-capped` exactly when the uncapped output is longer than the cap
    - **EXPECTED OUTCOME**: PASS
    - _Requirements: 2.9, 3.11, 3.12_

  - [x] 17.8 Add the web-preview check in a separate file (no `src/web` source change)
    - New test file (for example `src/core/formats/wordstar.preview.test.ts`, or a new file next to the web tests; do not edit `markdown.test.ts`, to stay out of the Spec 9 diff): `parseMarkdown(convertWordStar(writeWordStar(CHAPTER1)).output)` gives 11 paragraph blocks
    - _Requirements: 1.8, 2.11_

  - [ ]* 17.9 Add an extra property: block count equals paragraph count
    - For generated documents of content lines, `parseMarkdown` of the converter output has exactly one paragraph block per content line. Optional extra beyond the required properties
    - _Requirements: 2.11_

- [x] 18. Run the other tests that call the converter and read any failure before editing
  - Run (single-file runs, default reporter): `src/core` (`contract`, `auto`, `index`, `formats.*.hostile`, `detect*`, `plaintext.determinism`, `extra-corpus`, `realdisks`), `src/demo-disks` (`committed.test.ts`, `shared-checks.test.ts`, `builders.props.test.ts`), `src/mcp` (`exhume*`, `read-grave*`, `injection*`, `server.workspace.props`), `src/web/worker/disk-handler*`, `src/web/app.dom.test.ts`
  - Expected green (they compare the converter with itself or check weak layout). If one fails, read the failure and report the cause; change an expectation only if the cause is the intended blank-line change, and say so
  - Do not edit `src/test-support/web/md-emitter.ts` (stale shape is out of scope here)
  - Delete the Item C scratch directory when the differential proof is recorded
  - _Requirements: 3.9, 3.11, 3.12_

- [x] 19. Checkpoint after Item C
  - One full run saved as `run-after-c.json`; list failing tests by name
  - Run `npm run typecheck` and `npm run test:dom` and report both results (Item C changes converter output that the web preview shows). Read every `test:dom` failure before editing anything; do not silence or loosen a failing test. Change an expectation only if the cause is the intended blank-line change, and name that cause
  - **EXPECTED RED: `src/mcp/build.test.ts` only.** Do not edit the bundle to make it pass
  - `git status --short` should show only the intended source and test files; `exhumed/`, `public/disks/` and `power/server/` unchanged
  - Ask the owner if questions arise

## Phase 4: Stdio cases (expected RED until the rebuild)

- [x] 20. Add the stdio start-failure cases for Item A
  - In the `start failures` block of `src/mcp/stdio.workspace.test.ts`, add `it('--root with an empty or whitespace-only value', ...)` looping over `''`, `'   '` and `'\t'`, using the existing `expectStartFailure` with an empty secrets list (a blank value is contained in every string, so an "is not echoed" check would be meaningless), the working directory `w.root` (it exists, so the old bundle would have started), and `ping` as input
  - Each case asserts the five facts: no timeout, exit code 1, empty stdout, stderr equals `FIXED_START_FAILURE`, no argument value echoed
  - Extend the file header "RED until rebuild" note to name this case
  - Run only `npx vitest run src/mcp/stdio.workspace.test.ts`. **EXPECTED OUTCOME: RED** for the new case (the committed bundle starts on `--root ""` and answers `ping`). The pre-existing cases stay green. **Do not fix this by editing `power/server/exhume-mcp.mjs`.** Do not commit in this state
  - _Requirements: 1.4, 2.4_

## Phase 5: Rebuild approval gate

- [x] 21. GATE: owner approval for `npm run build:mcp` (never run without it)
  - Stop here and ask the owner explicitly: "Approve running `npm run build:mcp`?" Show: the bundled sources that changed (`src/mcp/paths.ts` for Item A, `src/core/formats/wordstar.ts` for Item C), the current red tests (`build.test.ts`, the new stdio case), and that nothing has been committed
  - Do the config-hash check as done for every earlier `build:mcp` run (see `docs/KIRO_LOG.md` for the procedure): compute the hash of the build configuration inputs and compare with the previously recorded value; report both values and whether they match. If they differ, do not run the build; report to the owner
  - **Do not run `npm run build:mcp` unless the owner has approved in this session AND the config hash matches.** If approval is not given, stop and report; leave the red tests red
  - On approval and a matching hash, run `npm run build:mcp` exactly once. The only changed bundle file must be `power/server/exhume-mcp.mjs` (check `git status --short` and `git diff --stat`); if anything else changed, stop and report
  - _Requirements: 2.4_

## Phase 6: Post-rebuild verification

- [x] 22. Verify the rebuilt bundle
  - Run `npx vitest run src/mcp/build.test.ts` (stale-build): expected green now
  - Run `npx vitest run src/mcp/stdio.workspace.test.ts src/mcp/stdio.test.ts src/mcp/config.test.ts src/mcp/power-package.test.ts`: expected green, including the new `--root` blank-value case
  - One full run saved as `run-after-rebuild.json`; list failing tests by name. Expected: none
  - Run `npm run typecheck` and `npm run test:dom`; report both results. Expected: no errors and no failing tests. Record failing names from the `test:dom` output
  - If something is still red, diagnose from the failure; do not edit the bundle by hand and do not rebuild a second time without asking the owner
  - _Requirements: 2.4, 3.1, 3.3, 3.5_

- [x] 23. Run `npm run make:demos -- --check`
  - **Caveat from the design:** this command first runs `vite build` into `node_modules/.cache`, so it writes files there (git-ignored build cache). Say so in the report; it does not modify tracked files
  - Expected: no difference reported, because the demo images hold WordStar bytes built by `writeWordStar` and never call the converter (`committed.test.ts` is the in-suite proof)
  - Afterwards run `git status --short` and confirm `public/disks/*.img` and `power/` are unchanged. Report that this expectation is reasoning confirmed by the run, or the actual difference found
  - _Requirements: 3.9, 3.12_

## Phase 7: Final repeated runs

- [x] 24. Run the repaired file 10 times and the full suite 5 times, recording failures by name
  - Run `npx vitest run --reporter=json --outputFile="$EVIDENCE/file-N.json" src/web/logic/markdown.test.ts` for N = 1 to 10. All must be green
  - Run the full suite 5 times, each as `npx vitest run --reporter=json --outputFile="$EVIDENCE/final-N.json"` for N = 1 to 5
  - After the 5 full runs, run `npm run typecheck` once and `npm run test:dom` once. `test:dom` uses its normal reporter (separate vitest config); record its failing test names from the output. Add both results to the report
  - After every run list failing tests by name with the node one-liner in the Conventions section, and write a table: run, tests, failed, pending, names of failing tests, and the duration of the markdown linear-time test
  - Record any failing test name even if it passes on rerun; a failing test other than the markdown test means Item B did not cover the flake, and that must go in the report
  - Report honestly that 5 clean full runs do not prove absence of a 1-in-4 flake (0.75^5 is about 24%); the claim is that the one tight timing assertion was removed and any later failure is now captured by name
  - _Requirements: 2.6_

- [ ]* 25. Optional: one full run under artificial CPU load
  - Start a CPU-bound process in parallel (for example a busy loop in a separate shell), run the full suite once saved as `$EVIDENCE/loaded-1.json`, then stop the load process. List failing tests by name
  - Optional extra check only; not required for acceptance
  - _Requirements: 2.6_

- [x] 26. Checkpoint - Ensure all tests pass
  - Ensure the latest full runs are green, scratch directories are deleted, `git status --short` shows only intended changes, and nothing is committed. Ask the owner if questions arise

## Phase 8: Report

- [x] 27. Report to the owner (no commit, no docs edits)
  - Write the report in chat only. Do not create or edit `docs/KIRO_LOG.md` (a hook handles it) and do not commit
  - Cover per item: what changed (files), the proofs run and their numbers, and what could not be verified
  - Item B: identical-output result (corpus size, property runs), benchmark medians and whether 3% was resolvable, the three quadratic mutations and their outcome, the native-call blind spot, the 10 and 5 run tables with failing test names (or none), and the honest statement that the flake's cause was never captured
  - Item A: red-then-green evidence for the unit/property tests and the stdio case
  - Item C: the golden diff review (only inserted blank lines, plus the `empty paragraphs` entry), the list of tests changed on purpose with causes, the four decisions beyond "add a blank line" (collapsed runs, no leading or trailing blank line, `.PA` at the ends writes nothing, space-only lines dropped), the CHAPTER1 result (11 paragraphs, 10 blank lines), and that `exhumed/CHAPTER1.md` was not edited
  - Rebuild: approval, config-hash values, the single `build:mcp` run, and the post-rebuild results; `make:demos --check` outcome and the `node_modules/.cache` write
  - Remaining risks from the design: address-style lines get paragraph spacing, possible merge conflict with Spec 9 in `markdown.ts`, hostile near-cap input cut earlier with a warning
  - State plainly that nothing is committed and the owner commits
  - _Requirements: 2.5, 2.6, 2.7, 2.8, 2.10, 2.4_
