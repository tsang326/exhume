# mcp-root-and-flaky Bugfix Design

## Overview

Three small defects, three separate items, one spec. This document is the design only. No source file, test, bundle or
fixture was changed to write it. Everything below was read from the code or computed in a throwaway script that lived
under `/tmp` and was deleted (the one computation is in Item B).

- **Item A (empty `--root`).** `resolveRoot` hands `''` to `realpath`, which resolves to the working directory. Fix: one
  `trim()` check inside `resolveRoot`, before any file-layer call. Tests: `paths.test.ts`, `launch.test.ts`, the model in
  `launch.props.test.ts`, and stdio cases against the bundle.
- **Item B (flaky timing test).** No failing run was ever captured, so the cause is a hypothesis. The markdown linear-time
  test is the prime suspect by reasoning. Fix: replace its wall-clock ratio with a deterministic step counter exported as
  `parseMarkdownWithStats`, and keep `parseMarkdown` byte-identical in output and signature. Every later full-suite run is
  saved as JSON under `os.tmpdir()` so a future failure is captured by name.
- **Item C (WordStar paragraphs).** `writeHard()` writes one `\n` per hard return, so a document is one Markdown
  paragraph. Fix: a hard return that ends a line with visible text becomes a paragraph break (one blank line), written
  lazily so repeated hard returns, `.PA` and the end of the document never produce more than one blank line, a leading
  blank line or a trailing one.

Items A and C both change bundled source, so `power/server/exhume-mcp.mjs` is rebuilt **once**, after both source fixes,
with `npm run build:mcp`, with owner approval and the config-hash check. This task does not rebuild it.

## Glossary

- **Bug_Condition (C)**: the input set that triggers a defect. Defined per item below as `isBugConditionA/B/C`.
- **Property (P)**: the required result for inputs in C.
- **Preservation**: behaviour for inputs outside C that must stay equal to the old behaviour.
- **resolveRoot**: `src/mcp/paths.ts`. Accepts `[]` or `['--root', X]` and returns the realpath of the root.
- **Default_Mode / Workspace_Mode**: the two MCP launch modes. Not changed.
- **FIXED_START_FAILURE**: the line `exhume-mcp: cannot start (invalid arguments or workspace root)\n` on stderr.
- **Step counters**: `lineSteps`, `scanSteps`, `events`, `pairSteps`, integers returned by `parseMarkdownWithStats`.
- **Hard return**: `0x0D 0x0A`, `0x0D 0x8A`, a lone `0x0A`, `0x0D` or `0x8D`. A **soft return** is `0x8D 0x0A` or `0x8D 0x8A`.
- **Content line**: a WordStar line (between hard returns) in which at least one visible character was written
  (`textCol > 0` in the converter).
- **Blank line (output)**: an output line that is empty. A **space-only line** has only spaces.
- **Rule**: the `---` line written for `.PA`.
- **Old converter / new converter**: `convertWordStar` before and after Item C.

## Bug Details

### Bug Condition

**Item A.** `resolveRoot(['--root', X])` calls `fs.realpath(X)` for every `X`, and `realpath('')` is the working directory.
The failure is the missing explicit rule for an empty value.

```
FUNCTION isBugConditionA(argv)
  INPUT: argv of type list of String
  OUTPUT: boolean
  RETURN argv.length = 2 AND argv[0] = "--root" AND trim(argv[1]) = ""
END FUNCTION
```

**Item B.** The test decides linearity from `performance.now()` readings taken in different time windows.

```
FUNCTION isBugConditionB(run)
  INPUT: run of type TestRun of the markdown linear-time test
  OUTPUT: boolean
  RETURN run.assertionUsesWallClock AND run.machineLoadVariesBetweenSamples
END FUNCTION
```

**Item C.** A hard return that ends a line with visible text and is followed by more visible text.

```
FUNCTION isBugConditionC(bytes)
  INPUT: bytes of type Uint8Array (a WordStar document)
  OUTPUT: boolean
  RETURN exists hard return H in bytes
         WHERE a content line ends at H AND a later content line exists
END FUNCTION
```

### Examples

- A: `node power/server/exhume-mcp.mjs --root ""` from an existing directory. Now: starts and serves. Expected: exit 1, empty
  stdout, `FIXED_START_FAILURE` on stderr. Same for `"   "`, `"\t"`, `"\u00a0"`.
- A (preserved): `--root " pad "` where a directory literally named ` pad ` exists still starts (value is not trimmed).
- B: a full `npm test` where the 2M-character parse overlaps heavy work from another Vitest worker. Ratio of medians
  passes 3 on a linear parser. Not captured in 8 runs.
- C: `a CRLF b CRLF` now gives `a\nb\n`. Expected `a\n\nb\n`.
- C (edge): `CRLF a CRLF CRLF CRLF b` now gives `\na\n\n\nb`. Expected `a\n\nb`.
- C (edge): `a CRLF .PA CRLF b CRLF` gives `a\n\n---\n\nb\n` now and after. Unchanged.

## Expected Behavior

### Preservation Requirements

**Unchanged behaviors**

- No arguments: Default_Mode with the realpath of the working directory (3.1).
- `--root <dir>` for an existing directory, a symlink to one, a path with padding spaces that exists: unchanged. Missing
  path, file, symlink to file: `INVALID_ARGUMENTS`. A non-empty value is never trimmed (3.2).
- `--workspace-from-agent` alone is Workspace_Mode; with anything else it is a start failure. Tool list and confinement
  unchanged (3.3). The other rejected lists and the stderr line are unchanged (3.4, 3.5).
- `parseMarkdown` returns the same `MarkdownModel` for every string, same public signature (3.7). Other wall-clock budgets
  are untouched (3.8).
- WordStar: text, spaces, escapes, markers, warnings, soft returns, soft hyphens, soft spaces, style toggles, dot commands
  other than `.PA` are unchanged (3.9). Markers still close before a line break (3.10). Never throws or hangs, within
  `MAX_MARKDOWN_OUTPUT_BYTES`, alphabet printable ASCII plus `\n`, `output-capped` exactly when cut (3.11). `.PA` is still a
  `---` set apart by blank lines when it sits between content (3.12).

**Scope.** Item A only touches `['--root', X]` with blank `X`. Item B touches one test and adds a function to
`markdown.ts`. Item C only touches the newline written for hard returns and `.PA`, plus space-only lines (see C.3).

## Hypothesized Root Cause

**A.** `resolveRoot` trusts `realpath`. Spec 8 then bent the model in `launch.props.test.ts` to match
(`if (path === '') return true;`), so the property test enforced the defect. Confirmed by reading both files.

**B. Not confirmed.** No failing run was captured: 8 full-suite JSON runs all passed (1752 tests), and at about 1 failure in
4 runs, 8 clean runs happen by chance about 10% of the time (0.75^8). The suspect is named by reasoning only:

1. It is the only tight timing assertion found (limit 3 against an ideal 2), and it compares readings from two different
   time windows (five 1M runs, then five 2M runs).
2. The 2M input allocates about twice the events and nodes, so GC can push the ratio above 2 with no quadratic code.
3. `largest-images.test.ts` has a 2000 ms budget against about 250 ms observed (about 8x margin) and `meta.test.ts` uses a
   30 ms spin against a 5 ms budget (6x). Both are absolute checks with large headroom.
4. Not excluded: another test file that was not found by the search (the `timed(...)` search output was truncated).

The design therefore does two things: removes the only tight timing assertion, and arranges for a future failure to be
captured by name. It does not claim the flake is fixed.

**C.** `writeHard()` is the only place a hard return becomes output and it always pushes a single `CHAR_LF`. The converter
has no paragraph state beyond `atBreak`, `lineStart` and `textCol`. `PA_BLOCK` is written eagerly and starts with `\n`, so
it assumes the output already ends in a line feed.

## Correctness Properties

Property 1: Bug Condition - empty or whitespace-only `--root` is a start failure

_For any_ argument list where `isBugConditionA` holds, the fixed `resolveRoot` and `resolveLaunch` SHALL return
`{ ok: false, code: 'INVALID_ARGUMENTS' }` without calling the file layer, and the built server SHALL exit with code 1,
empty stdout and `FIXED_START_FAILURE` on stderr, without echoing the value.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4**

Property 2: Preservation - every other launch list classifies as before

_For any_ argument list where `isBugConditionA` does NOT hold, the fixed `resolveLaunch` SHALL return the same result as the
old one (`default` with the realpath, `workspace`, or `INVALID_ARGUMENTS`).

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**

Property 3: Bug Condition - the linear-time verdict is deterministic and still catches super-linear parsing

_For any_ repetition of the check on the same parser, the verdict SHALL be identical (no clock is read). _For any_ parser
whose instrumented loops do work that grows faster than linearly, the check SHALL fail, and for the current linear parser
it SHALL pass.

**Validates: Requirements 2.5, 2.6, 2.7**

Property 4: Preservation - `parseMarkdown` is unchanged

_For any_ string `t`, `parseMarkdown(t)` after the change SHALL deep-equal `parseMarkdown(t)` before the change, and
`parseMarkdownWithStats(t).model` SHALL deep-equal `parseMarkdown(t)`. The signature of `parseMarkdown` is unchanged.

**Validates: Requirements 3.7, 3.8**

Property 5: Bug Condition - paragraph normal form

_For any_ bytes where `isBugConditionC` holds, `convertWordStar(bytes).output` SHALL put exactly one blank line between two
consecutive content lines, SHALL hold no run of two or more blank lines, SHALL NOT start with a blank line, and SHALL NOT end
with a blank line (a non-empty output ends with exactly one `\n` when the document ends with a hard return). Every style
marker opened on a content line is closed before the line feed that ends it.

**Validates: Requirements 2.8, 2.9, 2.10, 2.11**

Property 6: Preservation - removing blank lines gives the old output

_For any_ bytes with no `.PA` line, deleting every empty and every space-only line from the new output SHALL give the old
output with its empty and space-only lines deleted. Warnings and `ok` are equal, except `output-capped` may appear earlier
(by at most the added line feeds). _For any_ bytes with no hard return followed by text (empty input, one line, soft returns
only), the output SHALL be byte-for-byte the old output.

**Validates: Requirements 3.9, 3.10, 3.11**

Property 7: Runs of line ends are absorbed

_For any_ two content segments `P` and `Q` and any `k >= 1`, the output for `P`, one hard return, `Q` SHALL equal the output
for `P`, `k` hard returns (optionally with space-only lines among them), `Q`. Repeated `.PA` lines between content give one
rule. A `.PA` before the first or after the last content writes nothing.

**Validates: Requirements 2.9, 3.12**

Property 8: Totality, determinism and bounds

_For any_ bytes and any cap up to `MAX_MARKDOWN_OUTPUT_BYTES`, the converter SHALL return without throwing, give the same
result on repeated calls, keep the alphabet printable ASCII plus `\n`, keep `output.length <= cap`, warn `output-capped` exactly
when the uncapped output is longer than the cap, and (uncapped) keep `new.length <= old.length + number of hard returns`.

**Validates: Requirements 3.11, 2.9**

## Fix Implementation

### Item A: `resolveRoot`

**File**: `src/mcp/paths.ts`. **Function**: `resolveRoot`. One new check in the `--root` branch, before `realpath`:

```ts
  let dir = cwd;
  if (argv.length === 0) {
    dir = cwd;
  } else if (argv.length === 2 && argv[0] === ROOT_FLAG) {
    const value = argv[1] as string;
    // An empty or whitespace-only value is a launcher mistake (an unset variable). realpath('') would
    // resolve to the working directory and hide it. trim() is linear and covers Unicode whitespace.
    if (value.trim().length === 0) return { ok: false, code: 'INVALID_ARGUMENTS' };
    dir = value;
  } else {
    return { ok: false, code: 'INVALID_ARGUMENTS' };
  }
```

Why here: every caller of `resolveRoot` gets the rule, `resolveLaunch` is unchanged, and the check runs before any file-layer
call, which a test can observe with `recordingFs`. `main.ts` already prints the fixed line for any failed launch, so no
output code changes. A non-empty value is passed as given (3.2). NUL and other odd values still fail in `realpath`; that was
reasoned, not run. Literal `0` or `1` in `src/mcp` is allowed by the limits-module rule; no new numeric constant is needed.

**Tests to add or update (A)**

- `src/mcp/paths.test.ts`, in `describe('resolveRoot')`:
  - `it.each(['', ' ', '   ', '\t', '\n', '\u00a0', '\u2003', '\ufeff'])`: `resolveRoot(['--root', v], w.root, nodeFs)`
    equals `reject('INVALID_ARGUMENTS')`.
  - A `recordingFs` case: for `''` and `'  '` the recorded call list is empty (proves "before realpath").
  - A preservation case: `mkdirSync(join(w.root, ' pad '))`, then `resolveRoot(['--root', join(w.root, ' pad ')], ...)`
    is ok with that realpath, and `resolveRoot(['--root', ' ' + w.root], ...)` is rejected (leading space, not trimmed).
  - The existing cases stay as they are (3.6).
- `src/mcp/launch.test.ts`: `it.each` the same blanks for `resolveLaunch(['--root', v], cwd, nodeFs)` equals `INVALID`
  (`cwd` exists, so the old code would have started), plus `[flag, '--root', '']` stays `INVALID`.
- `src/mcp/launch.props.test.ts` (the model Spec 8 bent):
  - Replace the comment and `if (path === '') return true;` in `isExistingDir` with
    `if (path.trim() === '') return false;` and a comment saying an empty or whitespace-only value is a launcher mistake.
  - Add `fc.constantFrom('', ' ', '\t', '  \n', '\u00a0')` to `token()`.
  - Add a property: for any string made of whitespace characters (`fc.array(fc.constantFrom(' ', '\t', '\n', '\r', '\u00a0',
    '\u2003', '\ufeff'))` joined), `resolveLaunch(['--root', w], dir, recordingFs)` is invalid with zero recorded calls.
    The two existing classification properties already draw `''` often from `fc.string`.
- Stdio, against the bundle, in the `start failures` block of `src/mcp/stdio.workspace.test.ts`, using the existing
  `expectStartFailure` (five facts: no timeout, code 1, empty stdout, stderr equals `FIXED_START_FAILURE`, no value echoed):

```ts
    it('--root with an empty or whitespace-only value', async () => {
      const { w, h } = setup();
      for (const value of ['', '   ', '\t']) {
        // w.root exists, so the old bundle would have started there.
        expectStartFailure(await run(w, h, req(1, 'ping') + '\n', ['--root', value]), []);
      }
    });
```

  (The secrets list is empty on purpose: `''` is contained in every string, so an "is not echoed" check on a blank value
  would be meaningless. The check that matters is `stderr === FIXED_START_FAILURE`.) **Expected RED until the rebuild:** the committed bundle predates the fix, so with
  `--root ""` it starts, answers `ping`, and exits 0 with stdout, and these cases fail. The file header already carries a
  "RED until rebuild" note from Spec 8; extend it. The `run(...)` helper is whichever wrapper that file already uses over
  `runBundle`; the working directory must be an existing directory.

### Item B: `parseMarkdownWithStats`

**File**: `src/web/logic/markdown.ts` only (plus the one test). Spec 9 may touch `src/web`, so the diff is limited to one new
exported interface, one new exported function, `parseMarkdown` reduced to a one-line wrapper, and about eight counter
statements. Nothing else in the file moves.

**What is counted.** I read the parser and found three loops in the work path and one in the line splitter:

| Counter | Where | Counted |
|---|---|---|
| `lineSteps` | `parseMarkdown` `for (;;)` | one per line taken from the text |
| `scanSteps` | `buildParagraph` scan | one per pass of `while (i < len)`, plus `j - i` after each `*` run (characters walked by the inner run loop), plus one per pass of `while (n > 0)` |
| `events` | `buildParagraph` | `events.length` at the end of each paragraph, summed |
| `pairSteps` | `buildParagraph` pairing | one per pass of `for (e ...)` |

Summed per paragraph into the totals. A quadratic change in any of these loops (for example re-walking `events` from the
start for each marker, or restarting the line scan) changes the totals.

**Signature and shape.**

```ts
export interface MarkdownStats {
  lineSteps: number;
  scanSteps: number;
  events: number;
  pairSteps: number;
}

/** Same parse as parseMarkdown, plus the number of steps the loops took. Used by tests. */
export function parseMarkdownWithStats(text: string): { model: MarkdownModel; stats: MarkdownStats } { ... }

export function parseMarkdown(text: string): MarkdownModel {
  return parseMarkdownWithStats(text).model;
}
```

`parseMarkdown` keeps its name, parameter and return type. There is one parser body, so the test measures the production path
and not a copy. `buildParagraph` returns two or three more integers in the object it already returns.

**Hot-loop cost.** Counters are `let` locals inside `buildParagraph` (`scan`, `pair`) and `parseMarkdown` (`lineSteps`), not
module-level variables and not object fields, so the engine can keep them in registers; they are returned once per
paragraph. `events` costs nothing in the loop (`events.length` read at the end). Per call there is one extra small object.
The star-run count is one addition per run, not per character. The cost per iteration is one increment.

**The test (replaces the last test in `markdown.test.ts`).** Same periodic input as today (`unit` of 52 characters).

```ts
it('parses in linear time: doubling the input doubles the loop steps', () => {
  const unit = 'word *em* **bold** \\* more\nline two ***both*** end\n\n';
  const build = (chars: number): string => unit.repeat(Math.ceil(chars / unit.length)).slice(0, chars);
  const a = parseMarkdownWithStats(build(1_000_000));
  const b = parseMarkdownWithStats(build(2_000_000));
  for (const key of ['lineSteps', 'scanSteps', 'events', 'pairSteps'] as const) {
    expect(a.stats[key]).toBeGreaterThan(0);
    const ratio = b.stats[key] / a.stats[key];
    expect(ratio).toBeGreaterThanOrEqual(1.98);
    expect(ratio).toBeLessThanOrEqual(2.02);
  }
  // The counters are not vacuous: at least one scan step per 2 characters.
  expect(a.stats.scanSteps).toBeGreaterThanOrEqual(500_000);
  // Structural check on whole units, where the scaling is exact.
  const k = Math.ceil(1_000_000 / unit.length);
  const s1 = parseMarkdownWithStats(unit.repeat(k)).model;
  const s2 = parseMarkdownWithStats(unit.repeat(2 * k)).model;
  expect(s2.blocks.length).toBe(2 * s1.blocks.length);
  expect(s2.dropped).toBe(2 * s1.dropped);
  expect(countNodes(s2)).toBe(2 * countNodes(s1));
});
```

(`countNodes` is a small iterative walker in the test file; a similar walker already exists as `walkModel`. `performance.now()`
and the 5 ms skip are gone, and so is the `ctx` argument.)

**The ratio, computed read-only.** I patched a copy of `markdown.ts` in a scratch directory with exactly the counters above
and ran it (Node 24 type stripping). Results (the scratch directory was deleted):

| Input | lineSteps | scanSteps | events | pairSteps | blocks | dropped |
|---|---|---|---|---|---|---|
| 1,000,000 chars | 57,692 | 1,192,309 | 365,386 | 365,386 | 19,231 | 307,688 |
| 2,000,000 chars | 115,385 | 2,384,616 | 730,772 | 730,772 | 38,462 | 615,384 |
| ratio | 2.000017 | 1.999998 | 2.000000 | 2.000000 | 2.0000 | 2.0000 |

On whole units (`k` and `2k` repeats of the 52-character unit) the ratios were 1.999983, 2.000000, 2.000000, 2.000000, and
blocks/dropped are exact doubles. **Margin.** The measured deviation from 2 is at most 2e-5. It comes only from the cut at
the slice end (a partial unit) and one trailing empty line. The input is deterministic, so the counters are the same on every
machine. The margin `[1.98, 2.02]` is therefore wide against noise (there is none) and still tight against complexity:
`n` to `2n` with a `log n` factor gives about 2.10, `n^1.1` gives 2.14, `n^2` gives 4. A limit of 2.1 would have missed a
`log n` factor, which is why I chose 2.02 over the 1.9 to 2.1 range suggested earlier. The lower bound 1.98 fails a
sub-linear result, which means a counter that stopped counting. The parsed output was also identical to the old function on a
300,000-character sample.

**What the counter does not prove.** It counts passes of the instrumented loops. A quadratic cost hidden inside one native
call (a `slice` or `indexOf` that restarts from 0, a string concatenation) is not a loop pass and is not counted. The
structural check and the proof plan below cover the common mutations, and this limit is stated, not hidden.

**Proof plan for Item B (all throwaway, nothing committed).**

1. *Output identical.* In a scratch directory outside the repo (for example under `os.tmpdir()`), keep a verbatim copy of the
   pre-change `parseMarkdown` and its helpers (`git show HEAD:src/web/logic/markdown.ts`). Compare
   `JSON.stringify(old(t)) === JSON.stringify(new(t))` on (a) a fixed corpus: the empty string, `'\n'`, `'---'`, `'a\n---\n\nb'`,
   every string literal in `markdown.test.ts`, the converter-shaped samples from `md-emitter`, a 1M periodic sample; and
   (b) a fast-check property over `fc.string()`, strings biased toward `*`, `\`, digits, `-`, `#` and `\n`, and
   `emittedDocArb`, 1,000 runs. The existing 13 tests in `markdown.test.ts` must also pass unchanged apart from the one replaced.
2. *No measurable slowdown.* A throwaway benchmark script: two modules (old copy, new file), the same 1M and 2M inputs and a
   short-paragraph input, warm-up of 5 runs each, then at least 30 **interleaved** runs (old, new, old, new, ...) with
   `performance.now()`; compare the medians. Accept if `median(new) <= 1.03 * median(old)` and the interquartile ranges overlap.
   If the benchmark cannot resolve 3% (machine noise), say so in the report instead of claiming no change. I did not run it.
3. *The throwaway quadratic check of 2.7.* In a scratch copy of `markdown.ts`, apply three mutations one at a time and run the
   new test against each copy (via a path alias or by temporarily copying over the file in the scratch tree, never in the repo):
   (a) in the pairing loop, add an inner `for (let q = 0; q < e; q++) pair++;` style re-walk; (b) in the scan, re-scan the
   line from `runStart` on every `*`; (c) in `parseMarkdown`, re-count lines from the start for each line. Each must fail the
   ratio assertion (expected ratio about 4). Record that mutations hidden in native calls are not detected. This is a
   one-time demonstration.
4. *Runs.* 10 consecutive runs of `src/web/logic/markdown.test.ts` and 5 consecutive runs of `npm test`, all green. Each full
   run uses `--reporter=json --outputFile=<os.tmpdir()>/exhume-flaky-evidence/run-N.json` (see the testing strategy), so a
   failure of any test is recorded by name.

### Item C: WordStar paragraph breaks

**File**: `src/core/formats/wordstar.ts`. No change in `src/web`, `src/mcp` or `src/core/fat12`.

#### C.1 Candidate rules for classifying a hard return

A hard return in a WordStar file is the Enter key. In document mode, wrapped lines end with a soft return (which the
converter already turns into a space), so a hard return normally ends a paragraph. In non-document mode, or for address
blocks, poems and lists, Enter ends a line that belongs with the next. I have no real WordStar file to check the mix, so the
rules are judged on determinism and loss.

| Rule | Description | For | Against |
|---|---|---|---|
| **R1: every hard return after a content line ends a paragraph** | one blank line after each content line, runs collapse | Deterministic and local. Loses no text. Matches owner decision 2.8 and the `CHAPTER1` expectation (11 paragraphs, 10 blank lines). Property 6 (removing blank lines gives the old output) holds exactly. | An address block becomes one paragraph per line (more vertical space, but still readable and never merged). |
| R2: short-line heuristic (a line under N visible characters followed by another line stays a line break) | keeps address blocks tight | Looks right for addresses | N has to be tuned; a short real paragraph ("Dear Sir,") would merge into the next; depends on the next line; a single `\n` renders as a space on GitHub and Kiro anyway, so the text is not even kept as separate lines unless trailing spaces or a backslash are added. Not deterministic in spirit. |
| R3: indentation (a line starting with spaces or a tab starts a paragraph; others continue) | follows typewriter convention | Works for indented prose | Most WordStar prose is not indented, and the demo documents have no indentation, so it would still produce one block. |
| R4: line break marked with two trailing spaces | exact "Enter" fidelity | Keeps every line | Needs a rule for when to use it (same problem as R2), adds trailing spaces that break Property 6, and `parseMarkdown` keeps trailing spaces as text. |

**Chosen: R1.** It is the only rule that is exact, linear, stateless apart from three flags, and explainable in one sentence.
The cost (address-style lines get paragraph spacing) is cosmetic, and R2 to R4 would each need a heuristic whose failures
merge or garble text, which is worse for an archival tool. The owner decision in the bugfix document ("a hard return that ends
a paragraph becomes a blank line", "every hard return is a paragraph break") matches R1. Revisit R2 only with real WordStar
files in hand.

#### C.2 Exact rule

State added to `convert()` (all local variables, no allocation):

- `hasOut: boolean`, set to true by `writeChar` when it writes a visible character.
- `needBlank: boolean`, set by `writeHard` when it ends a content line.
- `ruleDue: boolean`, set by a `.PA` line when `hasOut` is true.

Invariant I: whenever `textCol === 0` and `hasOut`, the output ends with exactly one `\n` that follows a non-`\n` byte. This
holds because the only line feeds written are the one that ends a content line, and the prefix below, which is immediately
followed by a visible character.

**`writeHard()`** (called for every hard token):

```
function writeHard():
  if textCol > 0:                                   // the line has visible text
    if sink.length + stackLength(open) + pendingSpaces + 1 > outputCap: capped = true; return    // as today
    close open markers (reverse order); open = []   // bold or italic never crosses the break
    push pendingSpaces spaces; pendingSpaces = 0    // trailing spaces kept, as today
    push LF
    needBlank = true
  else:                                              // empty or space-only line
    pendingSpaces = 0                                // nothing is written, needBlank is left as it was
  runOrdinary = 0; runSoft = 0
  textCol = 0; leadingDigit = false; atBreak = true; lineStart = true
```

**`writeChar(c)`**: compute the prefix before the existing group, at the point where today's code computes `groupLen`:

```
  prefix = ruleDue ? PA_BLOCK            // "\n---\n\n"
         : needBlank ? "\n"
         : ""
  groupLen = closeLen + pendingSpaces + openLen + charLen + prefix.length
  if sink.length + groupLen + reserve > outputCap: capped = true; return    // as today, prefix included
  push prefix; ruleDue = false; needBlank = false      // prefix goes first, before spaces and markers
  ... existing writes ...
  hasOut = true
```

Because the prefix is written when the next visible character arrives, it lands before the indentation spaces and before the
reopened markers, and `atLineStart` (`textCol === 0 && pendingSpaces === 0`) is unchanged, so line-start escapes (`\#`, `1\.`)
behave as before.

**`.PA` line** (in the dot-command branch): replace the eager `sink.pushString(PA_BLOCK)` and its cap check by
`if (hasOut) ruleDue = true;` and keep `atBreak = true`. The dot line is skipped by the same tokenizer as today. Other dot
commands and `..` comments are unchanged.

**End of document.** `needBlank` and `ruleDue` are simply dropped, so the output ends with the single `\n` of the last content
line (when the document ends with a hard return) and has no trailing blank line or trailing rule. The final flush writes
`pendingSpaces` only when `textCol > 0 || !hasOut`. The `!hasOut` part keeps today's behaviour for a document that is only
spaces (an existing test, "un-escaping recovers the 7-bit text", feeds spaces with no return and expects them back); the
`textCol > 0` part keeps trailing spaces after text.

**Rules, summarised**

| Input shape | Output |
|---|---|
| content line, hard return, content line | `line1 \n \n line2` (one blank line) |
| content, hard return x k, content (k >= 1, empty or space-only lines between) | same as k = 1 |
| hard returns before any content | nothing written (no leading blank line) |
| content, `.PA`, content | `\n---\n\n` between them, as today |
| content, `.PA`, `.PA`, content | one rule |
| `.PA` before any content or after the last content | nothing |
| document ends with a hard return | ends with exactly one `\n` |
| document ends mid-line | ends without `\n`, as today |
| soft return `0x8D 0x0A` or `0x8D 0x8A` | unchanged: a pending space, never a break |
| soft hyphen, soft space, control codes | unchanged |
| bold or italic spanning a hard return | markers close before the line feed and reopen on the next visible character, after the blank line |
| caps (`**`, `*` toggles) on the break | same as above; toggles keep their state across blank lines |

A line that contains only markers, control bytes or soft hyphens has `textCol === 0` and is an empty line.

**Decisions that change old output beyond "add a blank line", for the owner's attention**

1. Several hard returns in a row now give one blank line, not several (the "empty paragraphs" golden changes from `top\n\n\nbottom\n`).
2. Leading hard returns and space-only lines no longer write a leading `\n` or spaces.
3. A `.PA` at the very start or end of the content writes nothing. A leading `---\n\n` would be read as front matter by
   Jekyll-style tools, and a trailing rule separates nothing. `.PA` twice in a row is one rule (the old output had two rules and an extra blank line).
4. A space-only line that ends with a hard return, or follows content at the end of the document, is dropped.

If the owner prefers to keep a leading or trailing rule, only the `if (hasOut)` guard and the final flush change.

#### C.3 Complexity and safety

The change adds three booleans and a constant-size prefix. Each loop step still consumes at least one input byte, there is no
recursion and no regex, so the converter stays linear and bounded by `MAX_CONVERT_INPUT_BYTES` (4 MiB) in and
`MAX_MARKDOWN_OUTPUT_BYTES` (8 MiB) out. Output alphabet is still printable ASCII plus `\n`. The cap accounting includes the
prefix in `groupLen`, so the output never exceeds the cap and `capped` is set only when something is cut. The closing-marker
reserve is unchanged.

#### C.4 Worked example: `CHAPTER1`

The source is `CHAPTER1` in `src/demo-disks/content/prose.ts`: 11 paragraphs written by `writeWordStar` (each ends with
`0D 0A`; paragraph 1 is bold; the prose has no empty paragraph, and the file `exhumed/CHAPTER1.md` is the old output of
`/CHAPTER1.WS` on `public/disks/writers-disk.img`). Trace of the first two paragraphs:

```
bytes   02 'Chapter One: The Morning Crossing' 02 0D 0A  'Marta Voss opened ...' 0D 0A ... 'Near noon ... whose.' 0D 0A
        02 -> wantBold = true            (no output)
        'C'  writeChar: prefix "" (needBlank false)  -> "**C"   hasOut = true
        ...  'g'  ; 02 -> wantBold = false (nothing yet)
        0D 0A writeHard: textCol > 0 -> close "**", push LF, needBlank = true     out: "**Chapter ...Crossing**\n"
        'M'  writeChar: prefix "\n" (needBlank) -> "\nM"; needBlank = false        out: "...Crossing**\n\nMarta"
        ...
        0D 0A writeHard -> "\n", needBlank = true
        ... after the last paragraph: 0D 0A writeHard -> "\n", needBlank = true, end of input: nothing more is written
```

New output: 11 paragraphs separated by 10 blank lines (21 lines), ending with one `\n`; the old output is 11 lines. Text
bytes are identical; the new output is exactly 10 bytes longer. `**Chapter One: The Morning Crossing**` is now its own heading-like
block, and `parseMarkdown` makes 11 paragraph blocks of the new text (2.11). In the golden, `CHAPTER2` differs from its old
string only by blank lines between paragraphs: its `.PA` region (`...run.\n\n---\n\nThat evening`) is byte-for-byte the same,
because the old `PA_BLOCK` after a hard return and the new prefix `PA_BLOCK` produce the same bytes there.

#### C.5 What changes in tests, and what stays

Every check below was found by search or reading. I did not run any of them against a changed converter. "Changes" means the
expectation or the model must be rewritten on purpose; the "Cause" is always the new blank line, the dropped
leading/trailing/space-only lines, or the collapsed runs.

**`src/core/formats/wordstar.golden.test.ts`** (change, 10 of 17 entries)

| Entry | Result |
|---|---|
| `demo:chapter1`, `chapter2`, `chapter3`, `draft1`, `draft2`, `letter`, `memo` | change: blank line between paragraphs (7) |
| `fixed:two paragraphs` | `First paragraph here.\n\nSecond one.\n` |
| `fixed:bold heading` | `**Title Line**\n\nBody text follows the title.\n` |
| `fixed:empty paragraphs` | `top\n\nbottom\n` (was `top\n\n\nbottom\n`) |
| `fixed:single word`, `soft wrap`, `mixed styles`, `page break`, `single letters`, `bold and italic nested`, `wrapped styled` | **unchanged** (7): one paragraph, or the `.PA` form that is already the same bytes |

How the new strings are produced: not by regenerating from the new converter and trusting the result. A throwaway script (not
committed) maps each old string to the new one by a mechanical edit (turn each paragraph-ending `\n` that is not part of an
existing `\n\n---\n\n` block into `\n\n`, and collapse the empty-paragraph case), and the test then compares converter output
to those strings. The owner reviews the diff of this file: it must show **only inserted blank lines** (check:
`git diff -w` with blank lines ignored is empty, except for the `empty paragraphs` entry). The header comment ("recorded before
the soft hyphen change... must stay identical") gets a dated note that Item C changed paragraph spacing on purpose and that
removing blank lines from each new string gives the previous string.

**New test (2.10)** in `wordstar.golden.test.ts` or a new `wordstar.paragraphs.test.ts`: convert `writeWordStar(CHAPTER1)`;
assert the output has 11 paragraphs when split on `\n\n`, none of them contains `\n`, no `\n\n\n`, and the paragraph texts
equal the 11 authored paragraphs (with the markers for the bold heading).

**`wordstar.examples.test.ts`** (change, 7 assertions)

- `'one two\nthree\n'` becomes `'one two\n\nthree\n'` (cause: blank line after a hard return).
- The four hard-return forms (`CR`, `LF`, lone `0x8D`, `0D 8A`): `'a\nb'` becomes `'a\n\nb'`.
- `'.5\n. x\n'` becomes `'.5\n\n. x\n'`.
- The bold/underline/italic fixture: three lines become three paragraphs.
- Unchanged: the `.PA` example (`'a\n\n---\n\nb\n'`), the soft-return-at-start example (`'a'`), the empty input, the
  4 MiB truncation test (compares two outputs of the same converter), and the 4 MiB `<` cap test (no returns; stays exactly
  at the cap boundary as before).
- Add: leading hard returns write nothing, `a CR LF CR LF CR LF b` equals `a CR LF b`, a trailing `.PA` writes nothing, doubled `.PA`.

**`wordstar.softspace.examples.test.ts`** (change, 3 assertions): `'a  \nb\n'`, `'a \nb\n'`, `'a  \nb\n'` become `'a  \n\nb\n'`,
`'a \n\nb\n'`, `'a  \n\nb\n'` (trailing spaces kept, then the blank line). Other cases in the file had no hard return in the
lines I searched; they are re-checked by running.

**`wordstar.regress.test.ts`**: unchanged. Every case is one line with one terminating hard return (`s + '\r\n'` gives
`s + '\n'`).

**`wordstar.text.test.ts`** (change, one model; the others unchanged)

- "passes Plain_ASCII_Text through": the model `toText(lines) = lines.join('\n')` becomes: keep only lines with a non-space
  byte, join with `\n\n`; for a document that is a single space-only line the expected text is that line. Cause: empty and
  space-only lines in the generated documents are now dropped and the rest are separated by a blank line.
- The high-bit test compares two conversions of the same shape: unchanged. The `0x1A` end-marker test compares a document with
  itself plus a tail: unchanged. The dropped-control-bytes tests use one segment run without returns: unchanged.

**`wordstar.styles.test.ts`** (change, Property 12; the rest to be confirmed by running)

- Property 12 asserts `lines.length === paragraphs.length` after `split('\n')`. The model must keep only paragraphs that have
  visible text (the generator makes empty and space-only paragraphs) and compare against the output split on `\n\n`. Cause:
  paragraph spacing and dropped empty paragraphs.
- Properties 13/14 and the escaping tests iterate `output.split('\n')` and check each line; an empty line has no markers and no
  text to recover, so I expect them to hold. Not run. The "Property 14" plain-text test has no returns and is unchanged.
- `firstLine`-style helpers read the first line only: unchanged.

**`wordstar.dots.test.ts`** (change, the model) The model concatenates old outputs of text runs and `'\n---\n\n'` per `.PA` line.
Rewrite it as a small reference function with the lazy rule: text runs joined with one blank line, a rule only between
content, duplicates collapsed, none at the ends, and spaces/empty lines dropped. Cause: `.PA` is now written lazily and the
run outputs no longer concatenate.

**`wordstar.output.test.ts`** (unchanged, to be confirmed): alphabet check already allows `\n`; the `output-capped` check
compares against a second run at a large cap, which includes the new bytes on both sides; the per-line marker check holds for
empty lines.

**Other core tests that call the converter** (`contract.test.ts`, `auto.test.ts`, `index.test.ts`, `formats.*.hostile.test.ts`,
`detect*.test.ts`, `plaintext.determinism.test.ts`, `extra-corpus.test.ts`): they compare the converter with itself, check
invariants or alphabet, or use detection only. I expect no change; not run and not read line by line. `realdisks.test.ts` only
checks that no FreeDOS file is detected as WordStar: unchanged.

**Demo disks and the committed images (unchanged)**

- `public/disks/*.img` hold WordStar **bytes** built by `src/demo-disks/builders` from `prose.ts` through `writeWordStar`. The
  builders never call the converter, so the generated images are byte-identical. `committed.test.ts` compares the committed
  images to freshly generated ones in memory, so it is the in-suite proof; it stays green. `npm run make:demos -- --check`
  is therefore expected to report no difference. I did not run it: it first runs `vite build` into `node_modules/.cache`, which
  writes files, and the instruction was to avoid that. This is reasoning, not a result.
- `runSharedChecks` (used by `committed.test.ts` and `shared-checks.test.ts`) does call the converter in `checks/reads.ts`,
  `texts.ts` and `features.ts`. Their assertions are weak on layout: `_RAFT1.WS` compares disk Markdown with source Markdown
  (both new), `CHAPTER1.WS` needs 100 non-marker characters and an `*`, `_RAFT2.WS` needs non-empty output, and the link/phone
  scans work on text with a 1,048,576 UTF-16 unit cap that the extra blank lines do not approach. Expected unchanged; confirm by running.
- `builders.props.test.ts` converts DBF and PCX only. `readme.test.ts`, `demos.registry.test.ts`: unaffected.

**MCP and web tests** (`src/mcp/exhume*.test.ts`, `read-grave*.test.ts`, `injection*.test.ts`, `server.workspace.props.test.ts`,
`src/web/worker/disk-handler*.test.ts`, `src/web/app.dom.test.ts`): they either compare tool output with
`convertAuto(...)` run in the same test (so they follow the new converter), or check that the text contains `Hello`, or use
plain text and CSV. I expect no change. The stdio tests do not read converted WordStar text from the bundle (searched
`stdio*.test.ts`, `build.test.ts`: no WordStar use). Not run.

**Test helper**: `src/test-support/web/md-emitter.ts` builds "converter-shaped" Markdown with single `\n` between paragraphs. It
does not call the converter, so nothing breaks, but its shape is now stale. Updating it is optional, belongs with Spec 9 if
that spec touches the web parser tests, and is out of scope here.

#### C.6 Web preview and MCP

- **Web.** `parseMarkdown` already ends a paragraph on an empty line and renders a thematic break for an exact `---`. With the
  new blank lines the preview shows one paragraph per document paragraph with no change in `src/web` (2.11). Visual paragraph
  spacing in the preview (CSS) is Spec 9 item 6, which this change makes useful rather than conflicting. Read from the code, not run.
- **MCP.** `grave-source.ts` calls `convertAuto` and `read_grave` caps the sanitized text at `MAX_TEXT_CHARS` (65,536
  characters), reporting `totalChars` and `truncated`. The extra line feeds count towards that cap, so a long chapter is
  shortened earlier by about one character per paragraph (about 0.3% for the demo prose); this is reported, not an error.
  Response size: the text is at most 65,536 characters and a `\n` is two bytes in JSON, so the line stays far below
  `MAX_RESPONSE_BYTES` (1,048,576). `exhume` writes the full converter output; I did not find a size cap on that path other than
  the converter's own, but I did not read `exhume.ts` in full.
- **Converter cap.** The input limit is 4 MiB (`MAX_CONVERT_INPUT_BYTES`) and the output cap is 8 MiB. Each hard return adds
  at most one byte (and `.PA` is no larger than before), so the worst case for returns alone is `a CR LF` repeated: 2 input
  bytes to 3 output bytes, 6 MiB. A pathological input of escaped characters with returns (`* CR LF`: 2 bytes to 4 bytes) reaches
  exactly 8 MiB, and inputs already near the cap (the existing `<` test, markers around every character) were already
  truncated. So the added bytes can push some hostile inputs that used to fit just under the cap over it. The result is
  the existing `output-capped` warning and a cut at a safe place (markers closed), not a failure. Real floppy files are far below
  this: the largest image is 2.88 MB and a prose file adds about 0.3%. No limit constant changes.

### Bundle consequence and ordering (Items A and C)

Bundled sources that change: `src/mcp/paths.ts` (A) and `src/core/formats/wordstar.ts` (C, through `grave-source.ts` and
`convertAuto`). `src/web/logic/markdown.ts` is not in the MCP bundle. One `npm run build:mcp` after both source changes,
**only with the owner's approval and after the config-hash check**, as for every earlier build (`docs/KIRO_LOG.md`).
This task does not run it.

Bundle-tied tests:

- `src/mcp/build.test.ts` (stale-build): rebuilds in memory and compares with the committed bundle. It goes red at the first
  edit to `paths.ts` or `wordstar.ts` and stays red until the rebuild.
- The new stdio cases (`stdio.workspace.test.ts`): red until the rebuild (the bundle starts on `--root ""`).
- `stdio.test.ts`, `config.test.ts`, `power-package.test.ts`: no WordStar output; the first runs the bundle for existing
  behaviour that is unchanged. Expected to stay green.

Ordering to keep the red window short and well understood:

1. Item B first (independent of the bundle and the other items): counter seam, new test, proofs, 10 runs of the file. Suite
   stays green.
2. Item A source and unit/property tests (`paths.test.ts`, `launch.test.ts`, `launch.props.test.ts`). From here `build.test.ts` is red.
3. Item C source, then the updated models and goldens, then the new CHAPTER1 test. The core suite is green; only `build.test.ts` is red.
4. Add the stdio cases and run only that file to see the expected RED (five failing facts). Do not commit in this state.
5. Ask the owner for approval, check the config hash, run `npm run build:mcp`. Re-run `build.test.ts` and the stdio file: green.
6. Full suite (below). Do not commit; the owner commits.

Steps 2 to 5 should be done in one sitting so the repository is never left red between sessions.

## Testing Strategy

### Validation Approach

Each item gets exploratory tests on the unfixed code, a fix check and a preservation check. Everything is run with Vitest and
fast-check, with no new dependency. Properties return booleans and never call `expect` inside a fast-check callback.

### Exploratory Bug Condition Checking

**Goal**: show the defect on the unfixed code before changing it.

**Test Cases**:
1. **A, unit**: `resolveRoot(['--root', ''], existingDir, nodeFs)` returns `ok: true` with `existingDir` (will fail the new test).
2. **A, bundle**: `runBundle(['--root', ''], existingDir, ping)` exits 0 with output (will fail the new stdio case).
3. **B**: Not reproducible: 6 runs of the file and 8 full runs passed. The exploratory step is the JSON evidence runs below; the
   old test is not run for evidence of a failure that was never captured.
4. **C**: `convertWordStar(bytes('a', CRLF, 'b', CRLF))` returns `a\nb\n` (will fail the new example, expected `a\n\nb\n`), and
   `exhume` of `CHAPTER1.WS` has 0 blank lines.

**Expected Counterexamples**: `ok: true` for blank roots; one paragraph for a multi-paragraph document. Cause for A: no rule before
`realpath`; for C: `writeHard()` always pushes one `\n`.

### Fix Checking

```
FOR ALL argv WHERE isBugConditionA(argv) DO
  ASSERT resolveLaunch'(argv, cwd, fs) = { ok: false, code: INVALID_ARGUMENTS } AND no fs call was made
END FOR

FOR ALL text IN {1M, 2M periodic} DO
  ASSERT 1.98 <= steps(2M)/steps(1M) <= 2.02 for each counter AND structure scales by exactly 2 on whole units
END FOR

FOR ALL bytes WHERE isBugConditionC(bytes) DO
  out := convertWordStar'(bytes).output
  ASSERT normalForm(out)    // blank between content lines, no run, no leading or trailing blank, markers closed per line
END FOR
```

### Preservation Checking

```
FOR ALL argv WHERE NOT isBugConditionA(argv) DO ASSERT resolveLaunch(argv) = resolveLaunch'(argv) END FOR
FOR ALL text DO ASSERT parseMarkdown(text) = parseMarkdown'(text) END FOR
FOR ALL bytes WITHOUT a .PA line DO
  ASSERT dropBlank(convertWordStar'(bytes).output) = dropBlank(convertWordStar(bytes).output)
END FOR
```

**Testing approach**: property-based tests with a reference model for A and C, and a throwaway copy of the old function for B and
the C preservation run. For C the old converter is kept in a scratch directory outside the repo (`git show HEAD:...`), never committed.

**Test Cases**:
1. **A preservation**: `[]`, `['--root', dir]`, a padded directory name, the flag alone, and every rejected list: results equal the old ones.
2. **B preservation**: output identical on the fixed corpus and the property (proof plan above).
3. **C preservation**: for random biased byte arrays (the `biasedArb` of `wordstar.output.test.ts`, which includes returns,
   dots, toggles, soft returns and hyphens), with `.PA` excluded, `dropBlank(new) = dropBlank(old)` and the warning codes and
   messages are equal. For arrays with `.PA`: equal after also deleting `---` lines. Where the cap is hit, only the `output-capped`
   position may differ.

### Unit Tests

- A: the blank values (including `\u00a0`, `\u2003`, `\ufeff`), zero fs calls, the padded directory.
- B: the deterministic ratio test, the non-vacuity bound, the structural check.
- C: examples from section C.5, the run/edge table in C.2 (leading returns, space-only lines, doubled `.PA`, leading and trailing
  `.PA`, bold across a break, soft return before a hard return, document ending without a return), and the CHAPTER1 test.

### Property-Based Tests

- A (Property 1 and 2): corrected model in `launch.props.test.ts` plus the whitespace-only property.
- B (Property 4): the throwaway equivalence property; not committed. In the repo: the existing 13 tests.
- C (Properties 5 to 8), new file `src/core/formats/wordstar.paragraphs.props.test.ts`:
  - *normal form*: over `biasedArb`, the output has no `\n\n\n`, does not start with `\n`, and does not end with `\n\n`.
  - *runs absorbed*: `convert(P CRLF Q)` equals `convert(P CRLF (CRLF | spaces CRLF){k} Q)` for generated plain segments.
  - *paragraph model*: for generated content lines, `convert(lines joined by CRLF + CRLF) = lines.join('\n\n') + '\n'`.
  - *totality and determinism*: no throw, equal repeated results, alphabet, cap and `output-capped`, with the cap arbitrary of
    `wordstar.output.test.ts`; `new.length <= old.length + hardReturns` needs the old converter, so it stays in the throwaway run.
  - *markers*: `lineMarkersBalanced` for every line, as today.
  - A fast-check callback returns a boolean or nothing, never `expect(...)`.

### Integration Tests

- A: the stdio block against the rebuilt bundle (three blank values).
- C: `read_grave` on `writers-disk.img` `/CHAPTER1.WS` through the MCP tests' `convertAuto` comparison (existing), and the web
  `parseMarkdown` of the new `CHAPTER1` output gives 11 paragraph blocks (a small test next to the converter test or in
  `markdown.test.ts`; if it goes in `src/web`, keep it out of the Spec 9 diff by using a separate file).
- Whole suite, 5 consecutive runs, each as
  `npx vitest run --reporter=json --outputFile="$(node -p "require('os').tmpdir()")/exhume-flaky-evidence/final-N.json"`
  (and `--reporter=default` is not needed; add `--reporter=dot` if console output is wanted). A failing test is then named in the
  JSON. Optional: one run with a CPU-bound process in parallel.

### Risks

1. **The flake may not be the markdown test.** If a different test fails in the JSON evidence later, Item B's fix does not
   cover it. The acceptance criterion is "zero failures in 5 runs", which does not prove absence either (0.75^5 is about 24%).
   The honest statement is: the one tight timing assertion was removed and failures will now be named.
2. **Counter blind spot.** A quadratic cost inside a single native call is not counted (stated above).
3. **Item C changes visible output** of every multi-paragraph document and three decisions go beyond "add a blank line"
   (collapsed runs, dropped leading/trailing `.PA`, dropped space-only lines). The owner should read the decisions list in C.2.
4. **Address-style lines** get paragraph spacing (R1 trade-off).
5. **Golden review risk.** If the goldens were regenerated by running the new converter, a converter bug would be recorded as
   expected output. Hence the mechanical transform of the old strings and the "only blank lines inserted" diff check.
6. **Red window** between the first bundled-source edit and the rebuild (`build.test.ts`, the new stdio cases).
7. **Spec 9 overlap.** `markdown.ts` is the only shared file; the diff is small, but a merge conflict is possible if Spec 9 edits
   the same function.
8. **Hostile near-cap input** can now be cut earlier by up to the added line feeds (warning, not failure).
9. **Front-matter risk** is the reason `.PA` at the start writes nothing; the owner may prefer a leading rule.

### Not Verified

- That the markdown linear-time test is the source of the flake, and that the counter removes it. No failing run exists.
- That the new test catches every quadratic mutation. Only loop-level mutations are detectable; the 2.7 demonstration is planned, not run.
- No measurement of slowdown from the counters. The benchmark is described, not run. The sample equality of old and new
  `parseMarkdown` was checked on one 300,000-character input only.
- Nothing about Item C was run: the new converter is not written, so every claim about which tests change, stay or pass is from
  reading the code and tests. Tests I did not open (`contract.test.ts`, `formats.*.hostile.test.ts`, `extra-corpus.test.ts`,
  the MCP and web tests that use WordStar images, `oracles.ts`) are expected to stay green by reasoning only.
- The `wordstar.styles.test.ts` properties other than Property 12, and the other cases in `wordstar.softspace.examples.test.ts`,
  were read in part.
- `npm run make:demos -- --check` was not run. That the demo images are unchanged is reasoning from the builders, supported by
  `committed.test.ts` comparing in memory.
- Real WordStar files were not available, so the R1 trade-off for address-style lines is a judgement.
- `exhume.ts` was not read in full; whether its write path has a size cap is unverified.
- The bundle: nothing was built. That the rebuilt bundle behaves as designed needs the rebuild and the stdio run.
- Behaviour of `trim()`-equal values on other platforms for non-blank odd values (for example NUL) was reasoned, not run.
