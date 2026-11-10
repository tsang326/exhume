# Bugfix Requirements Document

## Introduction

Three small defects, handled as three separate items in one spec. Items A and B were found while building Spec 8. Item C was found afterwards, when the exhumed `CHAPTER1.md` was opened.

Scope:
- Item A: `src/mcp/paths.ts` (`resolveRoot`), `src/mcp/launch.props.test.ts`, and new test cases.
- Item B: one test in `src/web/logic/markdown.test.ts`, plus a small local counter seam in `src/web/logic/markdown.ts`.
- Item C: the WordStar converter `src/core/formats/wordstar.ts` and its tests (`src/core/formats/wordstar.*.test.ts`, including the golden file).

Workspace_Mode, the tool list and the confinement rules do not change.

**Superseded brief.** The original brief for this spec said "no core or MCP changes". For Item C that is superseded by an owner decision: the fix is in `src/core/formats`, so `power/server/exhume-mcp.mjs` must be rebuilt with `npm run build:mcp` later (owner approval and config-hash check; see the bundle section). For Item A the fix is in `src/mcp`, which also needs that rebuild.

**Coordination.** Spec 9 (ui-polish) is planned in parallel and may touch `src/web`. The change to `src/web/logic/markdown.ts` for Item B is therefore kept minimal and local (one exported function and a counter). Item C needs no change in `src/web` (see the findings under Item C).

**Owner decisions recorded**
- Item A: the empty check lives in `resolveRoot`, using `trim()` as written in 2.2.
- Item B: the evidence step is done and caught no failure (details below). The markdown linear-time test is made deterministic with a counter seam, `parseMarkdownWithStats`, plus a structural check. The wall-clock ratio and the 5 ms skip are dropped.
- Item C: a hard return that ends a paragraph becomes a paragraph break (a blank line) in the Markdown output.

**Item A: `--root ""` starts the MCP server in the working directory.** `resolveRoot` accepts the argument list `['--root', X]`, then calls `fs.realpath(X)` and `lstat`. `realpath('')` resolves to the current directory, so an empty `--root` value is treated as a valid root. A launcher that expands a missing variable to an empty string (`--root "$DIR"`) silently confines the server to the wrong folder instead of failing at start.

**Item B: a flaky timing test.** About 1 run in 4 of `npm test` shows one failure that passes on rerun (seen 2026-11-09 and 2026-11-10). It was reported as a sub-linear scaling (timing) check on about 2,000,000 items.

**Item C: WordStar documents convert to one Markdown paragraph.** The converter writes one `\n` for each hard return and never a blank line. `exhumed/CHAPTER1.md` (the file Kiro exhumed from `public/disks/writers-disk.img`) has 11 lines and 0 blank lines (checked with `wc -l` and `grep -c '^$'`). In Markdown a single newline does not end a paragraph, so any standard viewer (GitHub, Kiro) shows the whole chapter as one block of text. Our own preview does too, by a different route: `parseMarkdown` turns a single newline into a line break inside one paragraph.

### What was verified, and how

Verified by reading the code:
- `resolveRoot` in `src/mcp/paths.ts` has no check on the `--root` value other than `realpath` and `lstat().isDirectory`.
- `resolveLaunch` in `src/mcp/launch.ts` rejects the workspace flag mixed with anything else, then delegates to `resolveRoot`.
- `src/mcp/main.ts` prints the fixed line `exhume-mcp: cannot start (invalid arguments or workspace root)` plus a newline to stderr and sets exit code 1 for any failed launch, with nothing on stdout.
- `src/test-support/mcp/run-bundle.ts` exports `FIXED_START_FAILURE` and `runBundle(args, cwd, input, env)`. The `start failures` block in `src/mcp/stdio.workspace.test.ts` asserts `timedOut === false`, `code === 1`, `stdout === ''`, `stderr === FIXED_START_FAILURE`, and that no argument value appears in stderr.
- `src/mcp/launch.props.test.ts` has `isExistingDir()` with `if (path === '') return true;` and a comment saying the model must match the old behaviour. This is the line Spec 8 bent.
- `power/mcp.json` passes only `--workspace-from-agent`. `.kiro/settings/mcp.json` passes no arguments (Default_Mode, working directory). Neither passes `--root`, so neither is affected. Both were only read, not edited.
- The only test in the repo that matches the "2,000,000 items" description is the last test in `src/web/logic/markdown.test.ts`: `parses in linear time: doubling the input does not more than triple the time`. A search of `src/**/*.ts` for `2_000_000` and `2e6` found nothing else of that kind.

Run: `npx vitest run src/web/logic/markdown.test.ts` was run 6 times on this machine (macOS, 10 CPUs, Node v24.10.0) and passed 13/13 each time. The flake did not reproduce when the file ran alone.

**Evidence step for Item B (reported by the owner, not re-run in this update).** The full suite was run 8 times with `--reporter=json`; the reports are in `os.tmpdir()/exhume-flaky-evidence/`. All 8 runs passed: 1752 tests, 0 failed, 1 pending. The markdown linear-time test passed every time, with a test duration of 639 to 925 ms. So **no failing run was captured**. At about 1 failure in 4 runs, 8 clean runs in a row happen by chance about 10% of the time (0.75^8 is about 0.10), so this result is not strong evidence that the flake is gone, and it does not identify the cause.

**The suspect is named by reasoning only.** The markdown linear-time test is the prime suspect because:
- It is the only tight timing assertion found in the suite: the ratio limit is 3 against an ideal of 2.
- `src/core/formats/largest-images.test.ts` has a 2000 ms budget against about 250 ms observed, a margin of about 8x.
- `src/test-support/meta.test.ts` `busyWait` checks are coarse (a 5 ms budget against a 30 ms spin).

This is an argument from the code and the timing margins. No failure was observed that names this test, so the cause is not proven.

Could not verify without more runs or code changes:
- That this test is the cause of the observed failures. The reported symptom matches it, but no failing run's output was captured, even across 8 full-suite runs.
- Real base and doubled timings under full-suite load. Whether the base is under 5 ms on this machine was not recorded.
- Whether a bundle built from the fixed source behaves as intended. That needs a rebuild, which is not allowed in this task.
- That the counter seam removes the flake. A flake with no captured failure cannot be shown fixed by a clean run alone. The tasks therefore run every full suite with `--reporter=json` and save the report under `os.tmpdir()`, so that a future failure is captured by name (see 2.6).

## Bug Analysis

### Current Behavior (Defect)

**Item A: empty `--root`**

1.1 WHEN the server is started with `--root ""` THEN the system resolves the root to the process working directory and starts normally in Default_Mode, with no start failure.

1.2 WHEN the server is started with `--root` followed by a whitespace-only value (for example `"   "` or `"\t"`) THEN the system passes the value to `realpath`; the result depends on the platform, and a launcher mistake is not reported as a fixed start failure by an explicit rule.

1.3 WHEN `src/mcp/launch.props.test.ts` classifies `['--root', '']` THEN its reference model expects `default` instead of `invalid`, so the property test enforces the defect.

1.4 WHEN the stdio tests exercise the built bundle THEN no case covers an empty or whitespace-only `--root`, so the defect is invisible at the process boundary.

**Item B: flaky timing test**

1.5 WHEN the full suite runs with test files in parallel and the machine is under uneven load THEN the markdown linear-time test is the suspected cause of the occasional failure (by reasoning only; no failing run was captured): it can fail because the measured 2,000,000-character time exceeds three times the 1,000,000-character time, and it passes on rerun.

1.6 WHEN the 1,000,000-character baseline parses in just over 5 ms THEN the test still runs and divides a very small, noisy number into the doubled time, so a small absolute delay becomes a large ratio.

The test is timing-sensitive for these reasons, which are reasoned from the code and not yet measured:
- It compares wall-clock `performance.now()` readings taken in different time windows: five runs of the 1M input first, then five runs of the 2M input. Load from other Vitest workers can differ between the windows, and the ratio compares them directly.
- The median of 5 removes one outlier per input, not a load change that lasts across the 2M window.
- The first 1M run pays JIT warmup, which the median hides, but the 2M input allocates about twice as many events and nodes, so garbage collection pauses hit it harder. That moves the ratio above 2 without any quadratic behaviour. The limit of 3 leaves a margin of only 1.5x over the ideal ratio of 2.
- A fast machine can produce a base only slightly above the 5 ms skip threshold. Timer resolution, scheduling and a single pause are then large relative to the measurement.
- The assertion proves linearity only through a noisy proxy (time) when the property itself is about the number of operations.

Other wall-clock tests, reviewed and left out of scope because none is the culprit:
- `timed()` in `src/test-support/timed.ts` throws only when one call exceeds an absolute budget. The budgets are 2,000 ms (`CONVERT_TIME_BUDGET_MS`, `SCAN_TIME_BUDGET_MS`) and 5,000 ms in the hostile tests; `png.examples.test.ts` uses 10,000 ms. They are a coarse hang guard with large headroom and are low risk. `timed(...)` appears in many files, so the list here is partial; the search output was truncated.
- `src/core/formats/largest-images.test.ts` measures `performance.now()` only to log elapsed time and wraps `convertPcx` in `timed(..., CONVERT_TIME_BUDGET_MS)`. Its tests also have a 60,000 ms test timeout. The budget is an absolute 2,000 ms check on the largest images, so it is the next most exposed under heavy load, but it is not a ratio and does not match the reported symptom. It is a watch item, not part of this fix.
- `src/test-support/meta.test.ts` uses `busyWait` with a 5 ms budget against a 30 ms spin. That is a 6x margin and low risk.

**Item C: hard returns become single newlines**

1.7 WHEN a WordStar document holds paragraphs ended by hard returns (`0x0D 0x0A`) THEN the system writes one `\n` for each hard return and no blank line, so the Markdown output is one paragraph in any standard viewer.

1.8 WHEN the web preview shows that Markdown THEN `parseMarkdown` treats each single newline as a line break inside one paragraph, so the preview shows the document as one block with forced line breaks and no paragraph spacing.

1.9 WHEN the golden and example tests for the converter run THEN they expect a single `\n` after each hard return (for example `'a\r\nb'` to `'a\nb'`), so the tests enforce the defect.

**Findings for Item C** (read-only investigation; files named; nothing was run except `wc` and `grep` on `exhumed/CHAPTER1.md`)

*Where a hard return becomes `\n`.*
- `src/core/formats/wordstar.ts`, function `writeHard()` inside `convert()`. It closes open style markers, writes pending spaces, then does `sink.push(CHAR_LF)` and resets `textCol`, `leadingDigit`, `atBreak = true`, `lineStart = true`. There is no other place that writes a newline for a hard return. The output-cap check in `writeHard()` reserves exactly one byte for the line feed (`... + pendingSpaces + 1 > outputCap`).
- The main loop calls `writeHard()` when `readToken()` returns `KIND_HARD`. The converter keeps no paragraph state beyond `atBreak`, `lineStart` and `textCol`.

*What a hard return looks like in the bytes (from `readToken()` in `wordstar.ts` and the examples in `wordstar.examples.test.ts`).*
- `0x0D 0x0A` is one hard token (this is what `writeWordStar` in `src/test-support/formats/wordstar-writer.ts` writes at the end of each paragraph).
- `0x0D 0x8A` is also one hard token (examples test: `'a', [0x0d, 0x8a], 'b'` gives `a\nb`).
- A lone `0x0A` is a hard token, and so is a lone `0x0D`. A lone `0x8D` is also hard, because the high bit is cleared (`raw & 0x7f`) before the check (examples test: `'a', [0x8d], 'b'` gives `a\nb`).
- `0x8D 0x0A` and `0x8D 0x8A` (with the next byte `0x0A` or `0x8A`) are one **soft** token: the converter turns it into a pending space, not a newline. It must stay that way.
- Dot-command lines (`.PA`, `.xx`, `..` comments) are skipped by the same tokenizer and write no newline of their own. Only `.PA` writes the block `\n---\n\n` (constant `PA_BLOCK`). After a hard return the output ends in `\n`, so `a\r\n.PA\r\nb\r\n` gives `a\n\n---\n\nb\n`.
- The writer never emits a blank line in the source: one `0x0D 0x0A` ends each paragraph, and the demo prose in `src/demo-disks/content/prose.ts` (`CHAPTER1` and the others) has no empty paragraphs. So each hard return in the demo documents ends a paragraph. In real WordStar files a hard return also ends a line that was typed with Enter, and two hard returns in a row are the usual blank line; this was reasoned from the format, and no real WordStar file is available to check it.

*Where the output comes from.*
- `exhumed/CHAPTER1.md`: 11 lines, 0 blank lines, every line a full paragraph. `docs/KIRO_LOG.md` records that it was produced by the installed Power from `/CHAPTER1.WS` on `public/disks/writers-disk.img`.
- The demo disks are generated by `scripts/make-demo-disks.ts` through `src/demo-disks/` (builders, specs, `content/prose.ts`). They store WordStar **bytes**, not Markdown, so the committed images in `public/disks/` do not change with this fix. A text search of `scripts/` and of the non-test files in `src/demo-disks/` for WordStar names found nothing, so the link between the script and the prose goes through `src/demo-disks/content/` (not fully traced).
- The real-disk fixtures under `fixtures/real-disks/freedos13/` are FreeDOS images. `src/core/realdisks.test.ts` only checks that none of their files is detected as WordStar, so they have no WordStar output to change.

*Tests that name the current output (to be updated on purpose in the tasks, not silently).*
- `src/core/formats/wordstar.golden.test.ts`: `EXPECTED` strings for 7 demo documents (`demo:chapter1`, `demo:chapter2`, `demo:chapter3`, the two drafts, the letter and the memo), built from `src/demo-disks/content/prose.ts`. They hold `\n` between paragraphs. The file says the goldens were recorded before the soft hyphen change and must stay identical; for Item C they must change, once, with an explicit note.
- `src/core/formats/wordstar.examples.test.ts` (lines expecting `a\nb`, `'one two\nthree\n'`, `'a\n\n---\n\nb\n'`, `'.5\n. x\n'`, and the style examples), `wordstar.regress.test.ts`, `wordstar.softspace.examples.test.ts` (`'a  \nb\n'` and similar), `wordstar.dots.test.ts` (model builds `\n---\n\n`), `wordstar.text.test.ts` and `wordstar.styles.test.ts` (line-based models), and `wordstar.output.test.ts` (alphabet, cap and `output-capped` warning properties; its alphabet check already allows `\n`). These were found by counting `\n` literals; their expectations were not read in full.
- Tests that call the converter but were not opened, and may or may not name its output: `contract.test.ts`, `auto.test.ts`, `formats.*.hostile.test.ts`, `extra-corpus.test.ts` (a search for WordStar names in it found none), `src/test-support/formats/oracles.ts` (`lineMarkersBalanced`, `lineMatchesStyles` work per line, so blank lines look harmless, not run), and the MCP tests `src/mcp/exhume*.test.ts`, `read-grave*.test.ts`, `injection*.test.ts` and `src/web/worker/disk-handler.test.ts`, `src/web/app.dom.test.ts` that use WordStar images.
- `src/test-support/web/md-emitter.ts` builds converter-shaped Markdown for the web parser tests and joins lines with `\n`. It does not call the converter.

*Who consumes the Markdown.*
- Web: `src/web/worker/disk-handler.ts` passes `converted.output` to the page when the mime is `text/markdown`; `src/web/logic/markdown.ts` `parseMarkdown` splits on `\n`, an empty line ends a paragraph, `---` is a thematic break, any other line joins the current paragraph, and an inner newline becomes a `line-break` node. So a blank line already produces separate paragraphs in the preview. **No change in `src/web` is needed for Item C**, which also keeps this spec out of the way of Spec 9. (Read from the code; not run.)
- MCP: `src/mcp/grave-source.ts` calls `convertAuto(read.bytes, name)` and returns or writes the converter output with the untrusted envelope (`src/mcp/envelope.ts`). The MCP tools cap text length and the converter caps output at `MAX_MARKDOWN_OUTPUT_BYTES`; an extra newline per paragraph makes the output slightly larger, so cap tests (such as the `output-capped` property) must be re-checked. The cap values were not read.

*Interactions the design must settle.*
- `PA_BLOCK` starts with `\n`, so a paragraph break followed by `.PA` could produce three newlines in a row unless the converter tracks what the output already ends with.
- Two or more hard returns in a row (an empty line in WordStar) must not grow into several blank lines.
- A hard return inside a styled span closes the markers first (existing behavior in `writeHard()`); this must keep working so a paragraph break never sits inside `**...**`.
- The end of the document: the current output ends with a single `\n` after the last hard return.

### Expected Behavior (Correct)

2.1 WHEN the server is started with `--root ""` THEN the system SHALL fail to start with exit code 1, nothing on stdout, and the existing fixed start-failure line on stderr, as for any other invalid argument (`INVALID_ARGUMENTS`).

2.2 WHEN the server is started with `--root` followed by a value that is empty after trimming whitespace THEN the system SHALL fail to start in the same way as 2.1. Whitespace-only is detected by a check that the value's `String.prototype.trim()` is empty, which is linear in the length of the value and covers Unicode whitespace. The check lives in `resolveRoot`, before `realpath`, so that every caller gets it.

2.3 WHEN `src/mcp/launch.props.test.ts` classifies `['--root', X]` THEN its reference model SHALL treat an empty or whitespace-only `X` as `invalid`, and the `if (path === '') return true;` line and its comment SHALL be removed or replaced.

2.4 WHEN the bundle `power/server/exhume-mcp.mjs` is started with `--root ""` or a whitespace-only `--root` value THEN stdio tests SHALL assert the same five facts as the existing `start failures` block (no timeout, exit code 1, empty stdout, stderr equal to `FIXED_START_FAILURE`, no argument value echoed). The working directory used for the run SHALL be an existing directory, so the test would fail under the old behaviour.

2.5 WHEN the markdown linear-time check runs THEN the system SHALL decide it from a deterministic quantity and not from wall-clock time. The check SHALL still fail if `parseMarkdown` became quadratic. The finished test SHALL not depend on `performance.now()`, and SHALL not need a skip threshold. The owner chose the counter seam: `src/web/logic/markdown.ts` exports `parseMarkdownWithStats`, which counts parser steps; the test asserts that the step count for the 2M input is at most about 2.1 times the count for the 1M input, and also keeps the structural check on the output. The wall-clock ratio and the 5 ms skip are dropped. The change in `markdown.ts` SHALL be minimal and local (Spec 9 may touch `src/web`).

Options considered for 2.5 (the first one is **chosen by the owner**; the others are kept for the record):
- **Operation counter through a seam (chosen).** Add an optional counter, for example an exported `parseMarkdownWithStats(text)` that counts loop iterations in the character scan, events created and pairing steps, and have `parseMarkdown` call it. Compare the count for 1M and 2M inputs and assert the ratio is at most about 2.1. Deterministic and precise. Cost: it touches production code in `src/web/logic/markdown.ts`, and the counter must not change output or slow the hot loop. The parser reads as feasible to instrument: the work is two loops in `buildParagraph` (scan and pairing) and one in `parseMarkdown`, each with an obvious per-iteration point.
- **Count work with no production change.** Spy on the string operations the parser performs (for example wrap `String.prototype.indexOf`/`slice` calls, or count `events` through a Proxy). Zero production change, but it is brittle and ties the test to implementation details.
- **Structural proxy.** Check linearity on output size: model size, `dropped`, and the number of blocks and nodes at 1M and 2M must scale by exactly 2 for this periodic input. Deterministic and free, but it proves the output is proportional, not that the time is.
- **Keep wall-clock, make it robust.** Interleave 1M and 2M runs, use more samples, use the minimum rather than the median, and raise the margin. Smaller flake rate but still not deterministic. It is the fallback if no counter is accepted.
- **Scale by small ratios with a margin.** Compare work counts at 4 sizes (for example 100k, 200k, 400k, 800k) and fit the growth. Useful with a counter; it removes dependence on one pair of sizes.

Decision: the counter through a seam, with the structural proxy as a second assertion. The design must show that output is identical with and without the seam and that there is no measurable slowdown.

2.6 WHEN the repaired file and the full suite are run repeatedly THEN the system SHALL show zero failures. Acceptance is 10 consecutive runs of `src/web/logic/markdown.test.ts` and 5 consecutive runs of the full `npm test`, all green. Every later full-suite run in the tasks SHALL use `--reporter=json` with the report saved under `os.tmpdir()`, so that a future failure is captured by name. Runs under artificial load (for example another CPU-bound process in parallel) are a useful extra check but not required.

2.7 WHEN a deliberately quadratic variant of the parser is substituted in a throwaway check THEN the new linear-time test SHALL fail. This shows the repaired test still proves what it claimed to prove. It is a one-time demonstration, and the throwaway change is not committed.

2.8 WHEN a WordStar document has a hard return that ends a paragraph THEN the system SHALL write a paragraph break, that is a blank line, in the Markdown output, so that each paragraph is a separate paragraph in any viewer. For `exhumed/CHAPTER1.md` the 11 paragraphs SHALL be separated by 10 blank lines.

2.9 WHEN a document holds two or more hard returns in a row, or a hard return next to a `.PA` page break THEN the system SHALL NOT write more than one blank line in a row, and SHALL NOT write a blank line at the start of the output. (How runs and the end of the document are handled is a design point; this clause fixes only the upper bound.)

2.10 WHEN the converter tests run THEN `wordstar.golden.test.ts` and the example tests SHALL expect the new output, and a new test SHALL check on the bytes of `CHAPTER1` that the output has blank lines between paragraphs and that no paragraph is split.

2.11 WHEN the Markdown from the new converter is parsed by `parseMarkdown` THEN the preview SHALL show one paragraph per document paragraph, with no change to `src/web`.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the server is started with no arguments THEN the system SHALL CONTINUE TO start in Default_Mode with the realpath of the working directory as the root.

3.2 WHEN the server is started with `--root <dir>` where `<dir>` is an existing directory (including a symlink to one, and a path with surrounding whitespace that already resolved or failed before) THEN the system SHALL CONTINUE TO behave as before: a valid directory starts with its realpath as the root, and a missing path, a file or a symlink to a file is `INVALID_ARGUMENTS`. A non-empty value with leading or trailing whitespace is not trimmed or changed; it is passed to `realpath` as given. No reason was found to change this.

3.3 WHEN the arguments are exactly `--workspace-from-agent` THEN the system SHALL CONTINUE TO start in Workspace_Mode unchanged. The flag combined with any other argument SHALL CONTINUE TO be a start failure. No Workspace_Mode code, the four-tool list or the confinement rules change.

3.4 WHEN the arguments are any of the other already-rejected lists (`['unexpected-arg']`, `['--root']`, `['--root', dir, 'extra']`, `['--root', dir, '--root', dir]`, `['--no-such-flag']`) THEN the system SHALL CONTINUE TO fail with `INVALID_ARGUMENTS` and the same fixed line.

3.5 WHEN the start failure is printed THEN the system SHALL CONTINUE TO print exactly `exhume-mcp: cannot start (invalid arguments or workspace root)` plus a newline to stderr, exit with code 1, and never echo the rejected argument.

3.6 WHEN the existing `resolveRoot` unit tests in `src/mcp/paths.test.ts` and the tests in `src/mcp/launch.test.ts` run THEN they SHALL CONTINUE TO pass without edits, other than new cases for the empty and whitespace-only values.

3.7 WHEN markdown is parsed THEN `parseMarkdown` SHALL CONTINUE TO return exactly the same `MarkdownModel` for every input as before. All other tests in `src/web/logic/markdown.test.ts` SHALL CONTINUE TO pass unchanged. If a counter seam is added, it SHALL NOT change the returned model or the public `parseMarkdown` signature.

3.8 WHEN other wall-clock or `timed()` budget tests run THEN they SHALL CONTINUE TO run as they do now. They are not changed by this spec.

3.9 WHEN a WordStar document holds soft returns (`0x8D 0x0A`, `0x8D 0x8A`), soft hyphens, soft spaces, style toggles, escapes, control codes, or dot commands other than `.PA` THEN the system SHALL CONTINUE TO produce the same text, spaces, markers, escapes and warnings as before. Only the newline after a hard return changes.

3.10 WHEN a hard return occurs inside bold or italic text THEN the system SHALL CONTINUE TO close the markers before the line break, so markers stay balanced per line (`lineMarkersBalanced`).

3.11 WHEN any input is converted, including random, hostile and truncated bytes THEN the system SHALL CONTINUE TO return a result without throwing or hanging, within `MAX_MARKDOWN_OUTPUT_BYTES`, with the `output-capped` warning exactly when the output was cut, with an output alphabet of printable ASCII plus `\n`, and with identical results on repeated calls.

3.12 WHEN a document contains a `.PA` page break THEN the system SHALL CONTINUE TO write a thematic break (`---`) set apart by blank lines, and `parseMarkdown` SHALL CONTINUE TO return exactly the same model for every input (3.7). DBase, PCX and plain-text conversion are not touched.

### Bug Condition and Preservation

**Item A**

```pascal
FUNCTION isBugConditionA(argv)
  INPUT: argv of type list of String (arguments after the script name)
  OUTPUT: boolean

  RETURN argv.length = 2
     AND argv[0] = "--root"
     AND trim(argv[1]) = ""
END FUNCTION
```

```pascal
// Property: Fix Checking - empty or whitespace-only root is a start failure
FOR ALL argv WHERE isBugConditionA(argv) DO
  result ← resolveLaunch'(argv, cwd, fs)
  ASSERT result = { ok: false, code: INVALID_ARGUMENTS }
  // and for the built bundle: exit code 1, stdout empty, stderr = fixed start-failure line
END FOR
```

```pascal
// Property: Preservation Checking
FOR ALL argv WHERE NOT isBugConditionA(argv) DO
  ASSERT resolveLaunch(argv, cwd, fs) = resolveLaunch'(argv, cwd, fs)
END FOR
```

Preservation covers `[]`, `['--root', existingDir]`, `['--workspace-from-agent']` and every other rejected list. The two `launch.props.test.ts` properties (random string lists and structured token lists) already cover this space once the model is corrected.

**Item B**

```pascal
FUNCTION isBugConditionB(run)
  INPUT: run of type TestRun of the markdown linear-time test
  OUTPUT: boolean

  RETURN run.assertionUsesWallClock = true
     AND run.machineLoadVariesBetweenSamples = true
     // the outcome can differ between two runs of the same code on the same input
END FUNCTION
```

```pascal
// Property: Fix Checking - the verdict does not depend on timing
FOR ALL run WHERE isBugConditionB(run) DO
  result ← linearTimeTest'(run)
  ASSERT result is the same on every repetition of the same parser
  ASSERT result = FAIL WHEN parser has quadratic behaviour
  ASSERT result = PASS WHEN parser is linear
END FOR
```

```pascal
// Property: Preservation Checking
FOR ALL text WHERE true DO
  ASSERT parseMarkdown(text) = parseMarkdown'(text)
END FOR
```

**Item C**

```pascal
FUNCTION isBugConditionC(bytes)
  INPUT: bytes of type Uint8Array (a WordStar document)
  OUTPUT: boolean

  // At least one hard return (CR LF, CR 8A, lone LF, lone CR, lone 8D) is followed
  // by more text, so a paragraph break is due after it.
  RETURN exists hard return H in bytes WHERE visible text follows H
END FUNCTION
```

```pascal
// Property: Fix Checking - a hard return that ends a paragraph is a blank line
FOR ALL bytes WHERE isBugConditionC(bytes) DO
  out ← convertWordStar'(bytes).output
  ASSERT between the text before H and the text after H, out holds exactly one blank line
  ASSERT out holds no run of more than one blank line AND does not start with a blank line
  ASSERT every style marker opened before H is closed before the blank line
END FOR
```

```pascal
// Property: Preservation Checking
// Remove blank lines from both outputs; what is left is the old output.
FOR ALL bytes DO
  ASSERT withoutBlankLines(convertWordStar'(bytes).output) = withoutBlankLines(convertWordStar(bytes).output)
  ASSERT warnings and ok/error status are equal, except an output-capped warning may appear
         earlier by at most the added newline bytes
END FOR
// Inputs with no hard return followed by text (empty, one line, soft returns only) give
// byte-for-byte the same output as before.
```

**Counterexample for Item C:** `convertWordStar(bytes('a', [0x0d, 0x0a], 'b', [0x0d, 0x0a]))` currently returns `a\nb\n`; expected `a\n\nb\n` (the exact end-of-document form is a design point).

**Counterexample for Item A:** `node power/server/exhume-mcp.mjs --root ""` run from a directory that exists. Current result: the server starts and waits for input. Expected result: exit code 1 with the fixed line on stderr.

### Bundle and rebuild dependency (Items A and C)

Item C changes `src/core/formats/wordstar.ts`, which is bundled into `power/server/exhume-mcp.mjs` (through `src/mcp/grave-source.ts` and `convertAuto`). Item A changes `src/mcp/paths.ts`, also bundled. So the bundle must be rebuilt once, after both source fixes, with `npm run build:mcp`, with the owner's approval and after the config-hash check. Bundle-tied tests, found by searching for the bundle path:
- `src/mcp/build.test.ts` (stale-build test): rebuilds in memory and compares with the committed bundle. It goes red at the first edit to any bundled source file and stays red until the rebuild.
- `src/mcp/stdio.test.ts` and `src/mcp/stdio.workspace.test.ts`: run the committed bundle over stdio (through `src/test-support/mcp/run-bundle.ts` for the second). The new stdio cases for Item A fail until the rebuild. Whether any stdio test reads converted WordStar text from the bundle was not checked; if one does, it will see the old output until the rebuild.
- `src/mcp/config.test.ts` and `src/mcp/power-package.test.ts` check the package and config files. They do not run the bundle code as far as the search showed (not fully read).

The rest of this section describes Item A in detail; the same rebuild step covers Item C. The stdio tests run against the committed bundle, not against the source. The bundle was built from the old `resolveRoot`, so the new stdio cases for 2.4 will fail until the bundle is rebuilt with `npm run build:mcp`. The bundle may be rebuilt only with the owner's approval, after the config-hash check, as done for every earlier `build:mcp` run (see `docs/KIRO_LOG.md`). This task does not rebuild it.

Plan for the tasks phase:
- Write the source fix and the unit and property tests first (`paths.test.ts`, `launch.test.ts`, `launch.props.test.ts`). These do not need the bundle and should pass at once.
- Add the stdio cases (following the `start failures` block in `src/mcp/stdio.workspace.test.ts`) and state clearly that they are expected to fail until the owner approves the rebuild. This follows the earlier pattern, where `stdio.workspace.test.ts` was marked RED until its rebuild task.
- Ask the owner to approve the rebuild after the config-hash check, then run the stdio tests again to see them pass, and run the full suite.
- Do not commit. Whether the new stdio cases land before or after the rebuild is decided in design, because a full-suite run in between will show those failures.

### Decided by the owner (no longer open)

- Item A: the check lives in `resolveRoot`, using `trim()` as written in 2.2. NUL bytes and other odd values already fail in `realpath`; that was reasoned, not run.
- Item B: the counter seam (`parseMarkdownWithStats`) plus the structural check; wall-clock ratio and 5 ms skip dropped.
- Item C: a hard return that ends a paragraph becomes a blank line; the fix is in `src/core/formats/wordstar.ts`; `src/web` is not changed.

### Open points for design

- Item B: exactly which steps the counter counts (character scan, events, pairing, line loop) and the allowed ratio (about 2.1), and the proof that output is identical with the seam.
- Item C: how `writeHard()` knows what the output already ends with, so that repeated hard returns, `PA_BLOCK` (which starts with `\n`) and the end of the document give at most one blank line; whether the document ends with `\n` or `\n\n`.
- Item C: whether lines typed with Enter inside one logical paragraph (for example an address block) also become separate paragraphs. By 2.8 every hard return is a paragraph break; keeping some as line breaks would need a rule that was not decided and is not asked for.
- Item C: how the new golden strings are produced and reviewed (regenerated from the converter once, then read by the owner), and the order of the bundle rebuild relative to the stdio and golden tests.
- Item C: `exhumed/CHAPTER1.md` is an old output and is in the `exhumed/` folder, which the server never overwrites; it is not edited by this spec.
