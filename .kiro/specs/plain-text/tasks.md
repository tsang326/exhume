# Implementation Plan: Plain Text Converter

## Overview

Add a fourth converter, `convertPlainText`, so DOS text files such as `README.TXT` open as text. Work follows the design order: limits, templates and types; the extended text sink; test-support oracles; the converter; detection and wiring; hostile, property and example suites; updates to existing tests; web; MCP; demo-disk checks; docs; checkpoints; the user-run bundle build; a final checkpoint. The language is TypeScript (strict, no `any`, zero runtime dependencies in `core`).

## Hard rules for every task

These rules apply to the agent that executes this plan. No task below may violate them.

- `npm run build:mcp` is run only by the USER, in task 12. The agent never runs it.
- Never run `npm run make:demos` without `--check`. Never write into `public/disks/`. Never run `npm run build` (the full web build), `npm run dev`, `npm run preview`, `npm run test:watch` or any watch mode.
- Tests run only as single runs, for example `npx vitest --run <paths>`. DOM tests: `npx vitest --run --config vitest.dom.config.ts <paths>`.
- Typecheck with the existing script `npm run typecheck` (it runs `tsc --noEmit` for the root, core, web logic, web worker and mcp projects). Do not use `build` for this.
- No git commits unless the user asks.
- Property tests carry the comment `Feature: plain-text, Property N: <title>`, use `numRuns(100)` from `src/test-support/runs`, and a fast-check callback returns nothing or a boolean, never `expect(...)`.
- Each property below is its own test. Properties that share a file are placed in later waves than each other, so no two tasks in one wave write the same file.
- Unit and example tests that the requirements demand, or that replace expectations broken by this feature, are not optional. Property tests are optional (`*`).
- Between tasks 2.3 and 5.10 the typecheck can fail because `HostileFormat` gains `'text'` before the suites that enumerate it are updated. Run `npm run typecheck` at the checkpoints, not per task.

## Tasks

- [x] 1. Limits, templates, types and the text sink
  - [x] 1.1 Add the limit, template and type changes in `src/core/formats/`
    - `limits.ts`: add `export const MAX_TEXT_OUTPUT_BYTES = MAX_MARKDOWN_OUTPUT_BYTES;`, add `'MAX_TEXT_OUTPUT_BYTES'` to `LimitName`, keep the name `TEXT_CHUNK_BYTES` and its value, and change its comment to `// TextSink chunk, in UTF-16 code units; also the scratch byte buffer of the plain text converter`
    - `templates.ts`: add `outputCappedText: 'output capped at {0} bytes (MAX_TEXT_OUTPUT_BYTES)'` and the `MAX_TEXT_OUTPUT_BYTES` entry of `LIMIT_EXCEEDED_TEMPLATES`
    - `types.ts`: widen `OutputMime` and `OutputExtension`, add `TextResult`, widen `ConversionResult`, add `'text'` to `DetectedFormat`
    - `limits.test.ts`: add the example that `MAX_TEXT_OUTPUT_BYTES` equals 8,388,608 and equals `MAX_MARKDOWN_OUTPUT_BYTES`; update any enumeration of limits that this change breaks
    - Run `npx vitest --run src/core/formats/limits.test.ts src/core/formats/templates.test.ts`
    - _Requirements: 3.1, 3.3, 3.8_

  - [x] 1.2 Extend the sink in `src/core/formats/textsink.ts` in place
    - Rename `AsciiSink` to `TextSink` and `makeAsciiSink` to `makeTextSink`; change the one identifier in `wordstar.ts` and the import in `textsink.test.ts`
    - Chunk becomes `Uint16Array(TEXT_CHUNK_BYTES)`; mask stored values with `U16_MAX`; add UTF-8 cost accounting (1, 2, 3 bytes; surrogate pair 4; lone high 4, lone low 3) and `pushStringCapped(s, maxBytes)` that never splits a surrogate pair; `push` and `pushString` stay uncapped
    - No recursion, no regular expression, no literal of 4,096 or more
    - Run `npx vitest --run src/core/formats/textsink.test.ts src/core/formats/wordstar.output.test.ts src/core/formats/wordstar.regress.test.ts` (the WordStar tests must pass unedited)
    - _Requirements: 3.3, 3.5, 3.9_

  - [x]* 1.3 Add example tests to `src/core/formats/textsink.test.ts`
    - Unicode round trip across chunk boundaries; byte cost of 1, 2, 3 and 4 by example; `pushStringCapped` returns less than `s.length` at the cap
    - _Requirements: 3.3_

  - [x]* 1.4 Write property test for the sink
    - **Property 9: Sink UTF-8 accounting and ASCII compatibility**
    - Add to `src/core/formats/textsink.test.ts`
    - **Validates: Requirements 3.3**

- [x] 2. Test-support oracles and generators
  - [x] 2.1 Add the independent models in `src/test-support/formats/`
    - `oracles.ts`: add `plainTextOracle`, `isTextSampleOracle`, `detectFullOracle`, `encodeCp437` (derived from `decodeCp437`, no second table); `oracles.ts` imports only `decodeCp437`; leave `detectOracle` and `OracleFormat` unchanged
    - `invariants.ts`: `MIME_EXTENSION` gains `'text/plain': '.txt'`; the cap switch gains `MAX_TEXT_OUTPUT_BYTES`
    - _Requirements: 3.11_

  - [x]* 2.2 Add example tests to `src/test-support/formats/oracles.test.ts`
    - CRLF, lone CR, EOF cut, DEL, empty input, `0xFF` for each new oracle; `encodeCp437` round trip and `null` for an unmappable character
    - Run `npx vitest --run src/test-support/formats/oracles.test.ts`
    - _Requirements: 3.11_

  - [x] 2.3 Extend `hostile.ts`, `arbitraries.ts` and `arbitraries.test.ts` in `src/test-support/`
    - `hostile.ts`: `HostileFormat` gains `'text'`; add `PREFIXES.text`, `FIXTURE_BY_FORMAT.text`, a text grammar generator (with `0x1A`, NUL, DEL and high bytes) and a text header patch; the `auto` mix includes text fixtures
    - `arbitraries.ts`: add `plainTextBytesArb`
    - `arbitraries.test.ts`: the `formats` array gains `'text'`
    - Run `npx vitest --run src/test-support/formats/arbitraries.test.ts src/test-support/hostile-gen.test.ts`
    - _Requirements: 3.10, 3.11_

- [x] 3. The plain text converter
  - [x] 3.1 Create `src/core/formats/plaintext.ts`
    - Export `convertPlainText(input)` and the test seam `runPlainText(input, outputCap)`, built as `assertUint8Array`, `makeWarningCollector`, `guarded(() => convert(limitInput(...)))`, mirroring `wordstar.ts`
    - One pass over at most `MAX_CONVERT_INPUT_BYTES` bytes: stop at `0x1A`; CR and CRLF and lone LF become one LF; keep `0x09`, `0x0C`, `0x20..0x7E`, `0x80..0xFF`; count other bytes (and `0x7F`) as dropped; decode a full scratch buffer with `decodeCp437` and append with `pushStringCapped`; stop when capped
    - Warnings in order `input-truncated`, `control-codes-dropped`, `output-capped` (via `TEMPLATES.outputCappedText`); result via `okResult(..., 'text/plain', '.txt', w)`
    - Only import outside `src/core/formats` is `import { decodeCp437 } from '../fat12'`; no regular expression, no recursion, no local literal of 4,096 or more
    - Run `npx vitest --run src/test-support/formats-purity.test.ts`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 1.13, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9_

  - [x] 3.2 Write `src/core/formats/plaintext.examples.test.ts`
    - Examples for CRLF, lone CR, lone LF, tab, FF without a warning, EOF truncation, high-half CP437 bytes, the empty file, a control-byte file with its `control-codes-dropped` count, DEL, `input-truncated`, a non-`Uint8Array` input, and `runPlainText` with a small cap giving `output-capped` at a character boundary
    - Run `npx vitest --run src/core/formats/plaintext.examples.test.ts`
    - _Requirements: 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 3.2, 3.3, 3.6, 3.11_

  - [x]* 3.3 Write property test for the model comparison
    - **Property 1: Plain text matches the independent model**
    - File `src/core/formats/plaintext.model.test.ts`
    - **Validates: Requirements 1.1, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 3.11**

  - [x]* 3.4 Write property test for EOF truncation
    - **Property 3: Nothing after the first EOF byte matters**
    - File `src/core/formats/plaintext.eof.test.ts`
    - **Validates: Requirements 1.9, 1.11**

  - [x]* 3.5 Write property test for line endings
    - **Property 4: Line ending forms are equivalent**
    - File `src/core/formats/plaintext.lines.test.ts`
    - **Validates: Requirements 1.4, 1.5, 1.6**

  - [x]* 3.6 Write property test for the CP437 round trip
    - **Property 5: Idempotence through the CP437 encoding**
    - File `src/core/formats/plaintext.roundtrip.test.ts`
    - **Validates: Requirements 1.15**

  - [x]* 3.7 Write property test for determinism
    - **Property 6: Determinism and Buffer equivalence**
    - File `src/core/formats/plaintext.determinism.test.ts`; covers `convertPlainText` and `detectFormat`
    - **Validates: Requirements 1.14, 2.12**

  - [x]* 3.8 Write property test for the output cap
    - **Property 7: Output cap at a character boundary**
    - File `src/core/formats/plaintext.cap.test.ts`, using `runPlainText`
    - **Validates: Requirements 3.3**

- [x] 4. Detection and wiring
  - [x] 4.1 Extend `src/core/formats/detect.ts`
    - `formatFromExtension` gains `TXT`, `BAT`, `ASC`, `LOG`, `NFO`, `DIZ`, `1ST`, `ME` returning `'text'`
    - Add `isTextSample(sample)`: false for an empty sample, otherwise one bounded loop that fails on the first byte outside `0x09`, `0x0A`, `0x0C`, `0x0D`, `0x1A`, `0x20..0x7E`
    - `detectFormat` order: PCX, dBase, WordStar, extension, text content, `unknown` with source `none`; the file name guard stays unchanged
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.10, 2.11, 2.12_

  - [x] 4.2 Wire `src/core/formats/auto.ts` and `src/core/formats/index.ts`
    - `convertAuto`: `case 'text': return convertPlainText(input);`
    - Barrel exports `convertPlainText` and `TextResult`; `runPlainText` is not exported
    - Run `npx vitest --run src/core/formats/plaintext.examples.test.ts`
    - _Requirements: 2.1, 2.9_

- [x] 5. Suites and existing-test updates in `src/core/formats/`
  - [x] 5.1 Update `auto.test.ts`
    - Unknown inputs become the empty array and `[1..8]`; "fresh warnings array" uses `[1..8]`; "hostile non-string file name" expects `convertPlainText(ascii('hello world'))`; add a test that `hello` routes to the text converter
    - Run `npx vitest --run src/core/formats/auto.test.ts`
    - _Requirements: 2.1, 2.8, 2.9, 3.12_

  - [x] 5.2 Update `detect.examples.test.ts`
    - Make the `plain = "hi"` sample non-text (add `0x01`); keep the extension examples; add examples for `text` by extension (every Text_Extension_Set member, mixed case), `text` by content, the empty file with and without `TXT`, and the strong extensions `WS`, `DBF`, `PCX` winning over `text`
    - Run `npx vitest --run src/core/formats/detect.examples.test.ts`
    - _Requirements: 2.3, 2.4, 2.5, 2.7, 3.12_

  - [x] 5.3 Update the existing cases in `detect.test.ts`
    - Apply the design's change table: `noContentBytes` filter, `contentBytes` and "lets content win" restricted to the three strong rules, `EXTENSION_FORMATS` gains the eight text extensions, remove `file.ws.txt` from `noExtensionMatchNames`, Unicode look-alike probe `[0x01, 0x02]`, hostile file name test allows the text result and uses `[0x01]`, `fillerWith` filler `0x01`, `matchesOracle` and the length 0 to 12 sweep compare with `detectFullOracle`
    - Run `npx vitest --run src/core/formats/detect.test.ts`
    - _Requirements: 2.2, 2.6, 2.7, 3.12_

  - [x]* 5.4 Write property test for detection order
    - **Property 10: Detection follows the rule order**
    - Add to `detect.test.ts`
    - **Validates: Requirements 2.2, 2.3, 2.5, 2.7, 2.8**

  - [x]* 5.5 Write property test for strong content rules
    - **Property 11: Strong content rules beat every extension**
    - Add to `detect.test.ts`
    - **Validates: Requirements 2.4, 2.6**

  - [x]* 5.6 Write property test for the sample window
    - **Property 12: Detection reads only the sample window**
    - Add to `detect.test.ts`
    - **Validates: Requirements 2.10**

  - [x] 5.7 Update `contract.test.ts`
    - `CASES` gains a `convertPlainText` entry (`text/plain`, `.txt`, text fixture arbitrary); `converterFor` gains `case 'text'`
    - Run `npx vitest --run src/core/formats/contract.test.ts`
    - _Requirements: 3.4, 3.12_

  - [x]* 5.8 Write property test for the output contract
    - **Property 2: Output contract**
    - Add to `contract.test.ts`
    - **Validates: Requirements 1.2, 1.13, 3.4, 3.8**

  - [x]* 5.9 Write property test for auto conversion
    - **Property 13: Auto conversion follows detection**
    - Add to `contract.test.ts`
    - **Validates: Requirements 2.1, 2.9**

  - [x] 5.10 Update `formats.hostile.test.ts`
    - `FORMATS` and `CONVERTERS` gain `text`
    - Run `npx vitest --run src/core/formats/formats.hostile.test.ts`
    - _Requirements: 3.10_

  - [x]* 5.11 Write property test for hostile input
    - **Property 8: Totality on hostile input**
    - Add to `formats.hostile.test.ts`; covers `convertPlainText` and `convertAuto`
    - **Validates: Requirements 2.9, 3.2, 3.5, 3.7, 3.10**

  - [x] 5.12 Add the `targeted hostile plain text` block to `formats.targeted.hostile.test.ts`
    - 4 MiB with no `0x1A`; 4 MiB of control bytes; 4 MiB of CR; 4 MiB of `0xC4` reaching the real cap with `output-capped`; `MAX_CONVERT_INPUT_BYTES + 1` bytes with `input-truncated`; 4 MiB of high bytes; use the file's existing `run()` helper
    - Run `npx vitest --run src/core/formats/formats.targeted.hostile.test.ts`
    - _Requirements: 3.2, 3.3, 3.10_

  - [x] 5.13 Update `src/core/formats/index.test.ts`
    - `convertPlainText` joins `converters` (bad-input table and Buffer equivalence); `TextResult` joins the type tuple; `runPlainText` joins "does not export the internal runners"
    - Run `npx vitest --run src/core/formats/index.test.ts`
    - _Requirements: 3.6, 3.12_

- [x] 6. Checkpoint - core
  - Run `npm run typecheck`, then `npx vitest --run src/core src/test-support`.
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. Web preview
  - [x] 7.1 Add the `text` kind to the worker protocol and validation
    - `src/web/logic/protocol.ts`: `ExhumeResult` gains `{ kind: 'text'; text; warnings }`; `OUTPUT_BY_KIND.text = { mime: 'text/plain', extension: '.txt' }`
    - `src/web/worker/disk-handler.ts`: add the `converted.mime === 'text/plain'` branch before the PNG `else`
    - `src/web/logic/validate.ts`: `readResult` handles `case 'text'` with the markdown and csv cases
    - `src/web/logic/filename.ts`: `DownloadExtension` gains `'.txt'`
    - _Requirements: 4.10, 4.11_

  - [x] 7.2 Extend `src/web/logic/preview-model.ts`
    - `DownloadMime` gains `'text/plain'`; `PreviewBody` gains `{ kind: 'text'; text; shortened }`; `buildPreviewModel` handles `text` with `truncateForPreview` and downloads `.txt` (from `OUTPUT_BY_KIND.text`) plus the raw `.bin` download
    - _Requirements: 4.3, 4.4, 4.5, 4.6, 4.8_

  - [x] 7.3 Render and style the text body
    - `src/web/dom/preview.ts`: `buildBody` case `text` builds a `div.preview-scroll.preview-text` with `tabindex="0"`, `role="region"`, `aria-label="Document text"`, one Text node, and the existing shortened notice; no `innerHTML`, no new tag
    - `src/web/dom/download.ts`: `ALLOWED_MIME` gains `'text/plain'`
    - `src/style.css`: `.preview-text { white-space: pre-wrap; overflow-wrap: anywhere; }` with the existing `--pair-*` colors, no new color pair
    - `index.html` and the CSP do not change
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.7, 4.8, 4.12_

  - [x] 7.4 Update `src/web/worker/disk-handler.test.ts`
    - New fixture `NOTE.TXT` with ASCII bytes expecting kind `text`; the size 0 property accepts `raw` or `text`
    - Run `npx vitest --run src/web/worker/disk-handler.test.ts`
    - _Requirements: 4.8, 4.9, 3.12_

  - [x] 7.5 Update `src/web/logic/validate.test.ts`
    - The response arbitrary gains a `text` branch; add examples for an accepted `text` result and a rejected non-string `text`
    - Run `npx vitest --run src/web/logic/validate.test.ts`
    - _Requirements: 4.10, 4.11_

  - [x]* 7.6 Write property test for worker message validation
    - **Property 15: Worker message validation for text**
    - Add to `validate.test.ts`
    - **Validates: Requirements 4.10, 4.11**

  - [x] 7.7 Update `src/web/logic/preview-model.test.ts`
    - `ALLOWED_MIMES` gains `text/plain`; the `ExhumeResult` arbitrary gains a `text` branch
    - Run `npx vitest --run src/web/logic/preview-model.test.ts`
    - _Requirements: 4.3, 4.4, 4.5, 4.6, 4.10_

  - [x]* 7.8 Write property test for the preview model
    - **Property 14: Text preview model**
    - Add to `preview-model.test.ts`
    - **Validates: Requirements 4.3, 4.4, 4.5, 4.6**

  - [x] 7.9 Add examples to `src/web/logic/filename.test.ts` and `src/web/dom/download.test.ts`
    - One `'.txt'` example in filename; one example that a `text/plain` Blob is created for a `text/plain` spec
    - Run `npx vitest --run src/web/logic/filename.test.ts` and `npx vitest --run --config vitest.dom.config.ts src/web/dom/download.test.ts`
    - _Requirements: 4.5, 4.6, 4.10_

  - [x] 7.10 Update `src/web/dom/preview.dom.test.ts` and `src/web/app.dom.test.ts`
    - `preview.dom.test.ts`: a text body renders in a focusable labeled region as one Text node (hostile markup shows as text, no child elements); shortened notice; both download buttons; warnings listed
    - `app.dom.test.ts`: change `NOTES.BIN` content to bytes with `0x01` and `0xFE` so "falls back to a hex view with an error for unknown bytes" still holds; re-read the `HOSTILE.TXT` tests
    - Run `npx vitest --run --config vitest.dom.config.ts src/web/dom/preview.dom.test.ts src/web/app.dom.test.ts`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.7, 4.8, 4.9, 3.12_

- [x] 8. MCP server source
  - [x] 8.1 Teach the MCP tools the `text` format
    - `src/mcp/grave-source.ts`: add `formatOf(extension)` returning `'markdown' | 'csv' | 'text' | 'png'`
    - `src/mcp/tools/read-grave.ts` and `src/mcp/tools/exhume.ts`: use `formatOf(conversion.extension)`; the existing sanitizer stays on the string-output branch
    - `src/mcp/exhume-writer.ts`: `exhumeBase` extension union gains `'.txt'`
    - `src/mcp/errors.ts`: `NO_CONVERTER` text becomes `'No converter matches this file. Supported formats are WordStar, dBase III, PCX and plain text.'`
    - Do not edit `power/mcp.json` or `.kiro/settings/mcp.json`; do not touch `power/server/exhume-mcp.mjs` (task 12)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.7, 5.9_

  - [x] 8.2 Update `src/mcp/read-grave.test.ts`
    - "reports NO_CONVERTER for unknown content" uses a binary `DATA.BIN`; add a text success example (`format: 'text'`, `mime: 'text/plain'`, `extension: '.txt'`, labeled untrusted content); the duplicate-path test expects success with `format: 'text'` for both ids
    - Run `npx vitest --run src/mcp/read-grave.test.ts`
    - _Requirements: 5.1, 5.2, 5.6, 3.12_

  - [x] 8.3 Update `src/mcp/read-grave.props.test.ts`
    - Replace the `extension === '.csv' ? 'csv' : 'markdown'` comparison with the new extension lookup
    - Run `npx vitest --run src/mcp/read-grave.props.test.ts`
    - _Requirements: 5.1, 5.6_

  - [x]* 8.4 Write property test for `read_grave`
    - **Property 16: `read_grave` returns sanitized, capped text for text files**
    - Add to `read-grave.props.test.ts`
    - **Validates: Requirements 5.1, 5.2**

  - [x] 8.5 Update `src/mcp/exhume.test.ts`
    - Add examples: a text Grave writes one new `.txt` file in `exhumed/` with `format: 'text'`; the name stays inside `[A-Za-z0-9._-]` and 64 characters; a second call never overwrites
    - Run `npx vitest --run src/mcp/exhume.test.ts`
    - _Requirements: 5.3, 5.4, 5.6_

  - [x]* 8.6 Write property test for `exhume`
    - **Property 17: `exhume` writes one safe `.txt` file**
    - Add to `src/mcp/exhume.props.test.ts`
    - **Validates: Requirements 5.3, 5.4**

  - [x] 8.7 Update `src/mcp/server.handshake.test.ts` and re-read dependent MCP tests
    - Use a binary file name for the `NO_CONVERTER` case instead of `PLAIN.TXT`
    - Read `injection.test.ts`, `injection.props.test.ts` and `server.hostile.test.ts`; update any assertion that counts converted files or expects `NO_CONVERTER` for `.TXT`
    - Run `npx vitest --run src/mcp/server.handshake.test.ts src/mcp/injection.test.ts src/mcp/injection.props.test.ts src/mcp/server.hostile.test.ts`
    - _Requirements: 5.6, 5.7, 3.12_

- [x] 9. Demo-disk checks
  - [x] 9.1 Update `src/demo-disks/checks/expected.ts` and `reads.ts`
    - `expected.ts`: rename `noConverter` to `textFiles`: writers `['/README.TXT']`, office `['/INVOICES/INV8903.TXT', '/README.TXT']`, damaged `['/README.TXT']`; every other field unchanged
    - `reads.ts`: a path in `textFiles` must convert `ok` with `mime === 'text/plain'` and no warnings; remove the "plain text must not convert" branch; for `/README.TXT` require `MARKER_GENERATED` and `MARKER_WRITTEN` (imported from `../content/readme`) in the text
    - Do not touch `public/disks/` or `scripts/make-demo-disks.ts`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.6_

  - [x] 9.2 Update `src/demo-disks/shared-checks.test.ts`
    - Add mutation (g): a control byte planted in a `README.TXT` is reported by the `reads` group; mutation (c) still passes
    - Run `npx vitest --run src/demo-disks`
    - _Requirements: 6.1, 6.2, 6.4, 6.5_

- [x] 10. Docs and rules
  - [x] 10.1 Edit `README.md`
    - Line 6 becomes: "WordStar documents rise as Markdown, dBase tables as CSV, PCX pictures as PNG, plain text files as `.txt` text."
    - The `read_grave` bullet changes "(Markdown or CSV text, or PNG dimensions)" to "(Markdown, CSV or plain text, or PNG dimensions)"
    - _Requirements: 7.1_

  - [x] 10.2 Edit `power/POWER.md`
    - Change only the `read_grave` bullet, one line, to "(Markdown, CSV or plain text, or PNG dimensions)" like the README; leave the frontmatter, the "NOT WORKING YET" notice and every other line unchanged
    - _Requirements: 7.2_

  - [x] 10.3 Edit `.kiro/steering/safety.md`
    - Section "Web page", second bullet: add `` `text/plain` `` to the download MIME list after `` `text/csv` ``; change no other line
    - Leave `.kiro/specs/graveyard-ui/` unchanged
    - _Requirements: 4.10_

  - [x] 10.4 Add doc examples to existing tests
    - `src/demo-disks/readme.test.ts`: the README names plain text among the conversions
    - `src/mcp/config.test.ts`: the `read_grave` bullet of `power/POWER.md` names plain text
    - Run `npx vitest --run src/demo-disks/readme.test.ts src/mcp/config.test.ts`
    - _Requirements: 7.1, 7.2_

- [x] 11. Checkpoint - all source changes
  - Run `npm run typecheck`, then `npx vitest --run` and `npx vitest --run --config vitest.dom.config.ts`.
  - `src/mcp/build.test.ts` compares against the committed bundle and may fail until task 12 is done by the user; that is expected here and is not a reason to run the build.
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. User-run: rebuild the committed MCP bundle
  - [x] 12.1 USER RUNS THIS TASK THEMSELVES. The agent must not run `npm run build:mcp`.
    - Command for the user: `npm run build:mcp` (it runs `vite build --config vite.mcp.config.ts` and rewrites `power/server/exhume-mcp.mjs`)
    - Expected check: `power/server/exhume-mcp.mjs` changed, and `npx vitest --run src/mcp/build.test.ts` passes against the new bundle; `power/mcp.json` still has an empty auto-approve list and no `.kiro/settings/mcp.json` change
    - The agent only waits for the user to confirm, then continues with task 13
    - _Requirements: 5.8, 5.9_

- [x] 13. Final checkpoint
  - Run `npm run typecheck`, `npx vitest --run`, `npx vitest --run --config vitest.dom.config.ts`.
  - Run `npm run make:demos -- --check` (with `--check` only); all three images must report a match.
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional property tests and can be skipped for a faster MVP. Sub-tasks without `*`, including example tests the requirements demand and the edits to existing tests, are required.
- Each task references requirement clauses for traceability. Properties 1 to 17 are defined in `design.md`.
- The demo disk images, `public/disks/`, `scripts/make-demo-disks.ts`, `power/mcp.json` and `.kiro/settings/mcp.json` are not edited by any task.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1"] },
    { "id": 2, "tasks": ["1.3", "2.2", "2.3", "3.1", "4.1"] },
    { "id": 3, "tasks": ["1.4", "3.2", "3.3", "3.4", "3.5", "3.6", "3.7", "3.8", "4.2"] },
    { "id": 4, "tasks": ["5.1", "5.2", "5.3", "5.7", "5.10", "5.12", "5.13", "7.1", "8.1", "9.1", "10.1", "10.2", "10.3"] },
    { "id": 5, "tasks": ["5.4", "5.8", "5.11", "7.2", "7.4", "7.5", "8.2", "8.3", "8.5", "8.6", "8.7", "9.2", "10.4"] },
    { "id": 6, "tasks": ["5.5", "5.9", "7.3", "7.6", "7.7", "8.4"] },
    { "id": 7, "tasks": ["5.6", "7.8", "7.9", "7.10"] },
    { "id": 8, "tasks": ["12.1"] }
  ]
}
```
