# Implementation Plan: Format Resurrection

## Overview

The plan builds the converters in `src/core/formats/` bottom-up: the two approved prerequisites first, then limits, types, templates, warnings, guard and result helpers, then the checksums and the PNG encoder, then the test-only writers, parsers and oracles in `src/test-support/formats/`, then the detector, WordStar, dBase with CSV, PCX, and finally `convertAuto` and the public index. Purity, hostile-input, timing and size tests close the plan. All code is TypeScript under `strict`. Tests use Vitest 3.2.4 and fast-check 4.3.0. Property callbacks return nothing or a boolean and never call `expect(...)`. Every property uses `numRuns(100)`, and every timed check wraps only the converter call in `timed()`.

Every task in this plan is required, including all test and property sub-tasks. Limits from the requirements live only in `src/core/formats/limits.ts`. `MAX_CONVERT_INPUT_BYTES` and `MAX_IMAGE_PIXELS` are written as arithmetic (`4 * MIB`, `2048 * 2048`) so the existing core-wide literal scan stays green.

## Tasks

- [x] 1. Approved prerequisites
  - [x] 1.1 Re-export `decodeCp437` from the FAT12 index
    - Add the single line `export { decodeCp437 } from './cp437';` to `src/core/fat12/index.ts`
    - Add `decodeCp437` to the import list in `src/core/fat12/index.test.ts` with one assertion: `decodeCp437(Uint8Array.of(0x80))` equals `Ç`
    - Do not change anything else in the completed `fat12-core` code
    - _Requirements: 6.9, 12.8_

  - [x] 1.2 Extract the purity scanners into `src/test-support/scan.ts`
    - Move the scanner helpers from `src/test-support/purity.test.ts` unchanged into the new `src/test-support/scan.ts` and export them
    - `purity.test.ts` imports them from `scan.ts`; its rules, file walk and results stay exactly as they are (behavior-preserving refactor)
    - Run the existing suite and confirm the purity test results are unchanged
    - _Requirements: 12.2, 12.8, 14.11_

- [ ] 2. Foundation modules in `src/core/formats/`
  - [x] 2.1 Create `limits.ts` and `types.ts`
    - `limits.ts`: every Limit and internal constant from the design (`U16_MAX`, `MAX_CONVERT_INPUT_BYTES`, `DETECT_SAMPLE_BYTES`, `MAX_WARNINGS`, `MAX_MARKDOWN_OUTPUT_BYTES`, `MAX_DBF_FIELDS`, `MAX_DBF_RECORDS`, `MAX_CSV_OUTPUT_BYTES`, `MAX_IMAGE_DIMENSION`, `MAX_IMAGE_PIXELS`, `MAX_PCX_BYTES_PER_LINE`, `MAX_PCX_DECODED_BYTES`, the PNG layout constants, `CONVERT_TIME_BUDGET_MS`, and the DBF and PCX header constants). Use the arithmetic spelling for the two 4,194,304 values.
    - Export `pngBytesForFiltered(filteredBytes)` and define `MAX_PNG_BYTES` as a computed constant from its inputs, never as a literal
    - Export the `LimitName` union
    - `types.ts`: `ConversionWarningCode` (`as const` object, no `enum`), `ConversionWarning`, `OutputMime`, `OutputExtension`, `ConversionSuccess`, `ConversionFailure`, `MarkdownResult`, `CsvResult`, `PngResult`, `ConversionResult`, `RgbaImage`, `DetectedFormat`, `DetectSource`, `DetectResult`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.14, 1.17_

  - [x] 2.2 Create `templates.ts` and `chars.ts`
    - `templates.ts`: the closed table of warning and error templates from the design (numbers only, digit-free constant names for limits), the `errInternal` template, and `fill(template, ...values)` using `split`/`join` (no regular expression)
    - `chars.ts`: `isAsciiLetter`, `asciiUpper`, `isDigit` on numeric code points
    - _Requirements: 1.5, 1.13, 1.15, 12.4_

  - [x] 2.3 Create `warnings.ts`, `guard.ts` and `result.ts`
    - `warnings.ts`: `makeWarningCollector()` with `add`, `addOnce` (keyed by code and key, duplicates do not count toward the cap) and `list`; after `MAX_WARNINGS` stored warnings the next add stores one `warnings-capped` and later adds are ignored
    - `guard.ts`: `assertUint8Array` (the `Object.prototype.toString` check used by `fat12/disk.ts`, throwing `TypeError('invalid input type: expected Uint8Array')`), `limitInput` (subarray plus one `input-truncated` warning), and `guarded(fn, collector)` that turns an unexpected throw (for example a `RangeError`) into the `conversion failed` failure while keeping earlier warnings
    - `result.ts`: `okResult` and `failResult`
    - _Requirements: 1.4, 1.5, 1.6, 1.8, 1.12, 1.13, 1.15, 12.3, 12.12_

  - [x] 2.4 Write example tests for limits, templates and guards
    - `limits.test.ts`: every value from Requirement 1 criterion 2; `MAX_PNG_BYTES` equals 16,782,660; `MAX_CONVERT_INPUT_BYTES` equals `MAX_FILE_OUTPUT_BYTES` imported from the FAT12 core
    - `guard.test.ts`: `assertUint8Array` rejects `null`, `undefined`, a string, a number, an array, an `ArrayBuffer` and a `DataView` with the exact message, and accepts a `Buffer`; `limitInput` truncation and warning; `guarded` converts a throwing function into `conversion failed` and keeps earlier warnings
    - `templates.test.ts`: every template, after each run of digits is replaced by `#`, is at most 200 characters and holds no input text
    - _Requirements: 1.2, 1.5, 1.6, 1.8, 1.13, 1.17, 14.10, 14.12_

  - [x] 2.5 Write property test for the warning collector
    - **Property 4: The warning collector is bounded**
    - In `src/core/formats/warnings.test.ts`; N from 0 to 300 additions; check exactly 100 adds give 100 warnings and 101 adds give 100 plus one `warnings-capped`
    - **Validates: Requirements 1.12**

- [x] 3. Checksums and PNG encoder
  - [x] 3.1 Create `checksums.ts`
    - Table-driven CRC-32 (`0xEDB88320`, 256-entry `Uint32Array` built at module load) with `crc32Update` and `crc32`
    - Adler-32 with deferred modulus (`ADLER_NMAX = 5552`, modulus 65521) with `adler32Update` and `adler32`
    - Both chainable across segments
    - _Requirements: 11.5, 11.6, 11.7, 12.3_

  - [x] 3.2 Create `png.ts` with `encodePng`
    - Validate first (object, integer width and height in `[1, MAX_IMAGE_DIMENSION]`, pixel cap checked only after both dimensions are in range, `Uint8Array` check, `rgba.length === width * height * 4`) and return `PNG input invalid` without allocating or throwing; add `limit-exceeded` when a Limit caused the failure
    - Compute the exact output size with `pngBytesForFiltered` from validated dimensions, allocate once, write signature, IHDR, one IDAT of stored blocks (zlib header `78 01`, blocks of at most `PNG_STORED_BLOCK_MAX`, final flag on the last, `NLEN` as one's complement, row copies with `set(subarray)`), the Adler-32 trailer, CRCs, and IEND
    - Never modify the input `rgba`; identical input gives identical bytes
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.8, 11.9, 11.10, 11.11, 11.14, 11.15, 11.16, 11.17, 12.2, 12.12_

  - [x] 3.3 Write example tests for the encoder
    - `png.examples.test.ts`: the 1 by 1 image gives a 5-byte filtered stream, the zlib header check value, signature and chunk order; rejects each invalid-image shape without throwing; width 4096 by height 1 and the 2048 by 2048 pixel cap encode within `MAX_PNG_BYTES`
    - _Requirements: 11.1, 11.8, 11.15, 11.16, 14.10_

- [x] 4. Test-support writers, parsers and oracles (`src/test-support/formats/`)
  - [x] 4.1 Create `errors.ts`, `png-decoder.ts`, `csv-parser.ts` and `png-oracle.ts`
    - `FixtureError` naming the offending field (no constructor parameter properties)
    - `decodePng`: stored blocks, filter 0, colour type 6 only; returns pixels, IDAT bytes, stored-block list, the stored Adler-32 and the stored CRCs without recomputing them; throws `FixtureError` naming the unsupported feature
    - `parseCsv` (RFC 4180 subset, throws on an unterminated quote) and an independent `serializeCsvRow`
    - `png-oracle.ts`: Node-only cross-checks with `zlib.inflateSync` and `zlib.crc32` (tests only, never reachable from the barrel)
    - _Requirements: 13.1, 13.5, 13.6, 13.11, 11.13_

  - [x] 4.2 Create `wordstar-writer.ts`, `dbase-writer.ts`, `pcx-encoder.ts` and the barrel `index.ts`
    - `writeWordStar` (high bit on the last letter of each word, `0x8D 0x0A` soft returns, `0x0D 0x0A` hard returns, style toggles, 0 to 1,000 paragraphs)
    - `writeDbf` (32-byte header, descriptors, `0x0D` terminator, fixed-width records, final `0x1A`; field lengths 1 to 254, 0 to 65,535 records)
    - `encodePcx` (all five modes, one continuous RLE stream so runs cross scanlines, optional padding, 769-byte trailer for 256 colours)
    - Validate every bound before writing any byte and throw `FixtureError` naming the field; no clock and no random value
    - `index.ts` re-exports only writers and parsers and imports no `vitest`, `fast-check` or Node module
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.7, 13.8, 13.10_

  - [x] 4.3 Create `oracles.ts` and `invariants.ts`
    - `oracles.ts`: independent models for expected cells (own calendar and number-form check), the detector rules, the dBase header conditions, the PCX header conditions, the Markdown marker decompositions with the hugging rule, the style-per-character check, the balanced-marker check, `pngSizeFromFirstPrinciples`, a per-byte-reduction Adler-32 reference and a plain two-branch RLE reference
    - `invariants.ts`: `checkResultInvariants(result)` returning a list of violation strings (mime and extension pairs, output type, `error` length 1 to 200, warning count, digit-skeleton check of every message against the template table, JSON-shape check, no NUL in text, output caps, PNG dimensions)
    - _Requirements: 1.4, 1.5, 1.13, 1.14, 8.7, 12.7, 14.7, 14.8_

  - [x] 4.4 Create `arbitraries.ts` and `hostile.ts`
    - `arbitraries.ts` (not exported from the barrel): WordStar paragraphs, dBase tables (including the needs-repair family), PCX sources of 1 to 64 pixels per side (up to 300 by 100 for block-boundary use), RGBA images, and `{ seed, length }` large-input generators expanded with `expandContent`
    - `hostile.ts`: per format, random bytes with planted prefixes, grammar-aware bytes, mutated fixture files (one mutation per run: 1 to 64 changed bytes or truncation), and fuzzed headers drawn from boundary values
    - Generators only produce inputs; they never call a converter and never use `timed()`
    - _Requirements: 14.3, 14.4, 13.2, 13.3, 13.4_

  - [x] 4.5 Write tests for the fixture writers, parsers and decoder
    - **Property 36: Fixture writers are deterministic**
    - In `src/test-support/formats/writers.test.ts`; writing the same description twice returns identical bytes for the WordStar, dBase and PCX writers
    - Example tests: out-of-bounds descriptions throw `FixtureError` naming the field; the decoder and parser reject a compressed deflate block, a filter other than 0, a colour type other than 6 and an unterminated quoted cell
    - Import-graph test: the transitive closure of the barrel contains no `vitest`, `fast-check`, `src/core` or `node:` module, and `arbitraries.ts`, `oracles.ts` and `png-oracle.ts` are not reachable
    - **Validates: Requirements 13.7, 13.8, 13.10, 13.11**

- [x] 5. Checksum and PNG property tests
  - [x] 5.1 Write property test for checksums
    - **Property 35: Checksums match references**
    - In `src/core/formats/checksums.test.ts`; include all-`0xFF` arrays longer than 5,552 bytes and split chaining; plus the example vectors `crc32('123456789') = 0xCBF43926` and `adler32('Wikipedia') = 0x11E60398`
    - **Validates: Requirements 11.5, 11.6, 11.7**

  - [x] 5.2 Write property test for the PNG round trip
    - **Property 30: PNG round trip**
    - In `src/core/formats/png.test.ts`; width and height 1 to 64; check chunk order, IHDR fields and that the input `rgba` is unchanged
    - **Validates: Requirements 11.1, 11.2, 11.12, 11.15**

  - [x] 5.3 Write property test for agreement with Node zlib
    - **Property 31: PNG agrees with Node zlib**
    - Add to `png.test.ts`, using `png-oracle.ts`
    - **Validates: Requirements 11.3, 11.4, 11.5, 11.13**

  - [x] 5.4 Write property test for exact PNG size
    - **Property 32: PNG size is exact and bounded**
    - In `src/core/formats/png.layout.test.ts`, using `pngSizeFromFirstPrinciples`
    - **Validates: Requirements 11.9, 11.10**

  - [x] 5.5 Write property test for stored-block boundaries
    - **Property 33: Stored-block boundaries**
    - Add to `png.layout.test.ts`; images up to 300 by 100
    - **Validates: Requirements 11.14**

  - [x] 5.6 Write property test for invalid PNG input
    - **Property 34: Invalid PNG input is rejected without allocation**
    - In `src/core/formats/png.invalid.test.ts`; include huge dimensions with a short `rgba`
    - **Validates: Requirements 11.8**

- [x] 6. Checkpoint - Ensure all tests pass
  - Run `npm test` and `npm run typecheck`. Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Format detector
  - [ ] 7.1 Create `detect.ts`
    - `detectFormat(input, fileName?)` in the order PCX, dBase, WordStar (one bounded pass over the sample), extension fallback with ASCII-only case folding by code point, then `unknown`
    - File name used only if it is a string of at most 255 characters, and only for the extension after the last `.`
    - Look at no more than `DETECT_SAMPLE_BYTES` bytes plus the full length for the dBase header comparison; short inputs never throw
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.12, 12.3_

  - [ ] 7.2 Write property test for content detection
    - **Property 5: Content detection matches the rule oracle**
    - In `src/core/formats/detect.test.ts`; include every length from 0 to 12 bytes
    - **Validates: Requirements 2.1, 2.3, 2.4, 2.5, 2.8, 2.9**

  - [ ] 7.3 Write property test for extension fallback and file-name hygiene
    - **Property 6: Extension fallback, content precedence and file-name hygiene**
    - Add to `detect.test.ts`
    - **Validates: Requirements 2.6, 2.7, 2.10, 2.12**

  - [ ] 7.4 Write property test for the sample window
    - **Property 7: Detection looks only at the sample window**
    - Add to `detect.test.ts`
    - **Validates: Requirements 2.2**

  - [ ] 7.5 Write detector example tests
    - `detect.examples.test.ts`: one valid sample of each format; `ws`, `Ws` and `WS7` extensions; a name with no dot; content beating a conflicting extension
    - _Requirements: 2.3, 2.4, 2.5, 2.6, 2.7, 14.10_

- [ ] 8. WordStar converter
  - [ ] 8.1 Create `textsink.ts`
    - `makeAsciiSink()` with `push`, `pushString`, `length` and `finish()`; an 8 KiB `Uint8Array` chunk converted with `String.fromCharCode.apply`, pieces joined at the end
    - _Requirements: 3.9, 12.3_

  - [ ] 8.2 Create `wordstar.ts` with `convertWordStar` and the internal `runWordStar`
    - Character-level tokenizer (pair tokens, high-bit clearing, hard and soft returns, bare CR and LF, `0x1A` stop, tab, `0x00` and `0x1F` silent, other controls and `0x7F` dropped and counted)
    - Lazy style markers (bold, shared emphasis, close at hard return and end, spaces outside markers, proper nesting, no marker for empty spans)
    - Escaping of Markdown specials, including the line-start rules and the `1\.` form
    - Dot commands at line start (comments removed, `.PA` replaced by a blank line, `---`, a blank line, others counted), output cap with the close reserve, and the end-of-conversion warnings
    - `runWordStar(input, cap)` is a test seam and is not exported from `index.ts`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11, 3.13, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.11, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 5.9, 5.10, 1.6, 12.4_

  - [ ] 8.3 Write WordStar example tests
    - `wordstar.examples.test.ts`: soft versus hard return, bare CR, bare LF, lone `0x8D`, `0x0D 0x8A`, `.PA`, `.5` and `. x` kept as text, empty input, input over 4 MiB gives `input-truncated` and equals the result for the first 4 MiB, a 4 MiB input of `<` bytes hits the real cap with one `output-capped`, and the writer and converter agreement example
    - _Requirements: 3.2, 3.3, 3.4, 3.10, 3.11, 5.3, 5.6, 1.6, 13.9, 14.10_

  - [ ] 8.4 Write property test for pass-through and high-bit invariance
    - **Property 8: WordStar pass-through and high-bit invariance**
    - In `src/core/formats/wordstar.text.test.ts`
    - **Validates: Requirements 3.1, 3.12**

  - [ ] 8.5 Write property test for the `0x1A` end marker
    - **Property 9: `0x1A` ends the document**
    - Add to `wordstar.text.test.ts`
    - **Validates: Requirements 3.5**

  - [ ] 8.6 Write property test for dropped control bytes
    - **Property 10: Dropped control bytes are counted exactly**
    - Add to `wordstar.text.test.ts`
    - **Validates: Requirements 3.7, 3.8, 3.13**

  - [ ] 8.7 Write property test for output alphabet and cap
    - **Property 11: WordStar output alphabet and output cap**
    - In `src/core/formats/wordstar.output.test.ts`; caps from 0 to 200 through `runWordStar`
    - **Validates: Requirements 3.9, 3.10**

  - [ ] 8.8 Write property test for styles against the fixture description
    - **Property 12: WordStar styles agree with the fixture description**
    - In `src/core/formats/wordstar.styles.test.ts`, using the decomposition oracle
    - **Validates: Requirements 3.2, 3.3, 3.6, 4.1, 4.2, 4.3, 13.4, 13.9**

  - [ ] 8.9 Write property test for marker balance
    - **Property 13: Markers are balanced, nested and hug the text**
    - Add to `wordstar.styles.test.ts`; inputs of 0 to 1,048,576 bytes
    - **Validates: Requirements 4.4, 4.5, 4.6, 4.8, 4.9, 4.10**

  - [ ] 8.10 Write property test for Markdown escaping
    - **Property 14: Markdown specials are escaped**
    - Add to `wordstar.styles.test.ts`
    - **Validates: Requirements 4.7, 4.11**

  - [ ] 8.11 Write property test for dot commands
    - **Property 15: Dot-command lines are removed and counted**
    - In `src/core/formats/wordstar.dots.test.ts`
    - **Validates: Requirements 5.1, 5.2, 5.4, 5.5, 5.7, 5.8, 5.10**

- [ ] 9. Checkpoint - Ensure all tests pass
  - Run `npm test` and `npm run typecheck`. Ensure all tests pass, ask the user if questions arise.

- [ ] 10. dBase converter and CSV
  - [ ] 10.1 Create `csv.ts`
    - `formulaGuard`, `csvCell`, `csvRow` (CRLF on every row) and `utf8Length`; the guard runs first and quoting second so the `'` sits inside the quotes
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [ ] 10.2 Create `dbase-header.ts`
    - `parseDbfHeader` with the checks in the order of Requirement 6 criterion 3: input under 32 bytes first, then version, then conditions 2 to 5 (header length, descriptor walk capped at `MAX_DBF_FIELDS + 1`, field lengths, record length), reporting the lowest failed condition and adding `limit-exceeded` when a Limit caused it
    - Field names via the shared `decodeCp437`, controls replaced by `_`; unknown type letters read as `C` and flagged
    - Allocate nothing from a header field before conditions 1 to 5 pass
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.8, 6.9, 6.10, 6.14, 12.3_

  - [ ] 10.3 Create `dbase-cells.ts`
    - Per-type formatters for `C`, `N`/`F` (four-state character machine), `D` (real Gregorian date, year 0001 to 9999), `L` and `M`, returning the text and the formula-guard flag
    - `field-value-invalid` through `addOnce` keyed by field number; `memo-not-available` once
    - _Requirements: 7.5, 7.6, 7.7, 7.8, 7.9, 7.10, 7.11, 7.12, 7.13, 7.14, 8.6, 12.4_

  - [ ] 10.4 Create `dbase.ts` with `convertDBase` and the internal `runDBase`
    - Record count as the smaller of the declared count, `MAX_DBF_RECORDS` and the whole records that fit; `records-truncated`, `record-limit` and `record-length-mismatch` warnings; stride equal to the record length
    - Header row first, active records in file order, deleted records skipped and counted, unknown flags read as active with one warning
    - UTF-8 byte cap checked per row, ending after the last complete row with one `output-capped`
    - `runDBase(input, cap)` is a test seam and is not exported from `index.ts`
    - _Requirements: 6.7, 6.11, 6.12, 6.13, 7.1, 7.2, 7.3, 7.4, 7.15, 7.16, 8.1, 8.7, 8.8, 8.11, 1.6_

  - [ ] 10.5 Write dBase example tests
    - `dbase.examples.test.ts`: each field type once including a negative number, a date, a logical value and a memo field; the `warnings-capped` path with a table of more than 100 distinct problems; the under-32-byte case reports condition 2; the large-table case drives the real CSV cap
    - _Requirements: 6.4, 7.5, 7.6, 7.8, 7.11, 7.13, 7.15, 1.12, 14.10_

  - [ ] 10.6 Write property test for CSV serialization
    - **Property 24: CSV serialization round trip**
    - In `src/core/formats/csv.test.ts`
    - **Validates: Requirements 8.2, 8.3, 8.10**

  - [ ] 10.7 Write property test for header acceptance
    - **Property 16: dBase header acceptance matches the oracle**
    - In `src/core/formats/dbase.header.test.ts`
    - **Validates: Requirements 6.3, 6.5, 6.6**

  - [ ] 10.8 Write property test for the dBase to CSV round trip
    - **Property 17: dBase to CSV round trip**
    - In `src/core/formats/dbase.roundtrip.test.ts`
    - **Validates: Requirements 6.1, 6.2, 6.7, 6.8, 6.10, 7.1, 7.2, 7.3, 7.4, 7.16, 8.1, 8.8, 8.9, 13.2**

  - [ ] 10.9 Write property test for record count arithmetic
    - **Property 18: Record count arithmetic**
    - Add to `dbase.roundtrip.test.ts`
    - **Validates: Requirements 6.11, 6.12, 8.11**

  - [ ] 10.10 Write property test for the CSV output cap
    - **Property 23: CSV output cap**
    - In `src/core/formats/dbase.cap.test.ts`; caps through `runDBase`
    - **Validates: Requirements 7.15**

  - [ ] 10.11 Write property test for formula neutralisation
    - **Property 25: Formula prefixes are neutralised**
    - In `src/core/formats/dbase.formula.test.ts`
    - **Validates: Requirements 8.4, 8.5, 8.6**

  - [ ] 10.12 Write property test for character cells
    - **Property 19: Character cells follow the text rule**
    - In `src/core/formats/dbase.cells.text.test.ts`
    - **Validates: Requirements 7.5**

  - [ ] 10.13 Write property test for numeric cells
    - **Property 20: Numeric cells are validated**
    - Add to `dbase.cells.text.test.ts`
    - **Validates: Requirements 7.6, 7.7, 7.14**

  - [ ] 10.14 Write property test for date cells
    - **Property 21: Date cells are validated**
    - In `src/core/formats/dbase.cells.typed.test.ts`
    - **Validates: Requirements 7.8, 7.9, 7.10**

  - [ ] 10.15 Write property test for logical cells
    - **Property 22: Logical cells map as specified**
    - Add to `dbase.cells.typed.test.ts`; every byte value 0 to 255
    - **Validates: Requirements 7.11, 7.12**

- [ ] 11. Checkpoint - Ensure all tests pass
  - Run `npm test` and `npm run typecheck`. Ensure all tests pass, ask the user if questions arise.

- [ ] 12. PCX converter
  - [ ] 12.1 Create `pcx-header.ts`
    - `parsePcxHeader` evaluating the ten conditions of Requirement 9 criterion 2 in order, mapping each failure to its template (`too short`, `too large`, `not supported`, `header invalid` with the condition number), adding `limit-exceeded` for limit-caused failures, and never reading DPI or screen-size fields
    - Compute sizes only from validated 16-bit values; allocate nothing before all ten conditions pass
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 9.8, 9.9, 10.15_

  - [ ] 12.2 Create `pcx-rle.ts`
    - `decodeRle(input, start, limit, totalBytes)` into a zero-filled buffer: literal below `0xC0`, run of `byte & 0x3F`, runs may cross scanlines but never the total, a lone final run byte discarded, returning the data, the filled count and the consumed position
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 12.3_

  - [ ] 12.3 Create `pcx-palette.ts`
    - `choosePalette`: monochrome black and white, version 3 fixed EGA palette versus the header palette for 16-colour images, the 769-byte VGA trailer test using the decoder's consumed position, and the grayscale fallback with `missing`
    - _Requirements: 10.6, 10.7, 10.8, 10.9, 10.10, 10.12_

  - [ ] 12.4 Create `pcx-pixels.ts`
    - `expandToRgba` with one tight loop per pixel format (1-bit, 4-plane 1-bit, 4-bit with high nibble first, 8-bit indexed, 24-bit planar), alpha 255, padding ignored, no per-pixel allocation
    - _Requirements: 10.6, 10.7, 10.8, 10.9, 10.11, 10.13_

  - [ ] 12.5 Create `pcx.ts` with `convertPcx`
    - Order: type check, `limitInput`, header parse, then a helper that runs the RLE decode, adds `pcx-data-truncated` with the number of complete rows, picks the palette, adds `pcx-palette-missing`, and returns the RGBA array so the decoded planes are unreachable before the PNG buffer is allocated
    - Encode with `encodePng` and return `image/png` and `.png`
    - _Requirements: 9.7, 10.4, 10.14, 10.15, 1.6, 12.12_

  - [ ] 12.6 Write PCX example tests
    - `pcx.examples.test.ts`: each of the five modes once with a known small image, version 3 EGA, input lengths 0 to 127 give `too short`
    - _Requirements: 9.3, 10.6, 10.7, 10.8, 10.11, 10.12, 14.10_

  - [ ] 12.7 Write property test for header acceptance
    - **Property 26: PCX header acceptance matches the oracle**
    - In `src/core/formats/pcx.header.test.ts`
    - **Validates: Requirements 9.1, 9.2, 9.4, 9.5, 9.6, 9.7, 10.15**

  - [ ] 12.8 Write property test for the RLE decoder
    - **Property 27: The RLE decoder agrees with a reference model**
    - In `src/core/formats/pcx.rle.test.ts`; target lengths 1 to 4,096
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5**

  - [ ] 12.9 Write property test for the PCX to PNG round trip
    - **Property 28: PCX to PNG round trip**
    - In `src/core/formats/pcx.roundtrip.test.ts`; all five modes, padding, random DPI bytes, runs across scanlines
    - **Validates: Requirements 9.9, 10.6, 10.7, 10.8, 10.11, 10.13, 10.16, 13.3**

  - [ ] 12.10 Write property test for palette selection and truncation
    - **Property 29: Palette selection**
    - Add to `pcx.roundtrip.test.ts`
    - **Validates: Requirements 10.4, 10.9, 10.10, 10.12**

- [ ] 13. Auto conversion and public API
  - [ ] 13.1 Create `auto.ts` and `index.ts`
    - `convertAuto(input, fileName?)`: detector, then the matching converter; for `unknown` return `no converter for this format` with an empty `warnings` array
    - `index.ts` exports `convertWordStar`, `convertDBase`, `convertPcx`, `encodePng`, `detectFormat`, `convertAuto`, all Limits, `ConversionWarningCode` and the public types; `runWordStar` and `runDBase` stay internal
    - _Requirements: 1.3, 2.11_

  - [ ] 13.2 Write the public API test
    - `src/core/formats/index.test.ts`: import every public name; each public function except `encodePng` throws the exact `TypeError` for `null`, `undefined`, a string, a number, an array, an `ArrayBuffer` and a `DataView`, and accepts a `Buffer`; `encodePng` returns a failure for bad objects instead of throwing
    - _Requirements: 1.3, 1.8, 11.8_

  - [ ] 13.3 Write property test for the result contract
    - **Property 1: Result contract**
    - In `src/core/formats/contract.test.ts`, using `checkResultInvariants`; the callback throws a plain `Error` joining the violations
    - **Validates: Requirements 1.4, 1.5, 1.13, 1.14, 8.7, 10.14, 12.7, 14.7, 14.8**

  - [ ] 13.4 Write property test for determinism and Buffer equivalence
    - **Property 3: Determinism and Buffer equivalence**
    - Add to `contract.test.ts`
    - **Validates: Requirements 1.10, 1.11, 11.11**

  - [ ] 13.5 Write `convertAuto` example tests
    - `auto.test.ts`: one valid sample of each format converts through `convertAuto`, an unknown input returns the fixed failure with an empty `warnings` array, and the extension fallback routes a headerless sample
    - _Requirements: 2.11, 14.10_

- [ ] 14. Purity and import smoke tests
  - [ ] 14.1 Create `src/test-support/formats-purity.test.ts`
    - Reuse the scanners from `scan.ts` over the non-test files in `src/core/formats/`: no Node built-in import, no `document`, `window`, `fetch`, `XMLHttpRequest`, `WebSocket`, `eval`, `new Function`, `createElement` or dynamic `import()`, no `any` type, no regular expression literal and no `RegExp`
    - The only import from outside `formats` is `decodeCp437` from `../fat12`; no import from `src/test-support/`
    - No numeric literal equal to an exported Limit value of 4,096 or more outside `limits.ts`, taking the values from the live exports so the list cannot drift
    - Static check that no `expect(` call appears inside an `fc.property(...)` callback in the formats test files
    - `package.json` `dependencies` stays empty
    - _Requirements: 12.1, 12.2, 12.4, 12.6, 12.8, 12.9, 14.2, 14.11_

- [ ] 15. Hostile-input and fuzz tests (`*.hostile.test.ts`)
  - [ ] 15.1 Write property test for totality on hostile input
    - **Property 2: Totality on hostile input**
    - In `src/core/formats/formats.hostile.test.ts` so `test:fuzz` selects it; cover `detectFormat`, `convertWordStar`, `convertDBase`, `convertPcx` and `convertAuto` over random, grammar-aware, mutated and fuzzed-header inputs of 0 to 2,097,152 bytes. Generate every input first, outside the timer; wrap only the converter call in `timed(() => ...)`; after the timer stops, check no throw, that the input bytes are unchanged, and `checkResultInvariants`. Use `numRuns(100)` so `test:fuzz` gives at least ten times the default.
    - **Validates: Requirements 1.7, 1.9, 12.3, 12.5, 12.11, 14.3, 14.4**

  - [ ] 15.2 Write the targeted hostile cases
    - In `src/core/formats/formats.targeted.hostile.test.ts`; build each input first, then time only the converter call
    - PCX: a 65,535 by 65,535 header; bytes per line 65,535; a 4 MiB RLE stream of `0xFF 0x00` pairs behind a small valid header; the 769-byte trailer overlapping pixel data; 2049 by 2048 and 4097 wide give `PCX image too large` with nothing decoded
    - dBase: record count 4,294,967,295; record length and header length 65,535; 255 descriptors with no terminator; field names and `C` values starting with `=`, `+`, `-` and `@` (no parsed cell begins with those characters unescaped)
    - WordStar: 4 MiB of style-toggle bytes; 100,000 dot-command lines
    - Each case must not throw, must finish within `CONVERT_TIME_BUDGET_MS`, must respect the output caps and warning limits, and must return a failure or at least one warning
    - _Requirements: 1.15, 9.4, 9.5, 12.11, 12.12, 14.5, 14.6, 14.7, 14.8, 14.13_

- [ ] 16. Timing and size tests for the largest images
  - [ ] 16.1 Write the largest-image timing tests
    - In `src/core/formats/largest-images.test.ts`: build with the PCX encoder (outside the timer) a valid 24-bit 2048 by 2048 image, a valid 24-bit 4096 by 1024 image and a valid 24-bit 1024 by 4096 image, each with content that RLE-encodes to at most `MAX_CONVERT_INPUT_BYTES`
    - Time only the `convertPcx` call with `timed()`; each returns `ok: true` with no warnings within `CONVERT_TIME_BUDGET_MS` and a PNG of at most `MAX_PNG_BYTES`; the 1024 by 4096 PNG length equals `MAX_PNG_BYTES` exactly
    - _Requirements: 1.16, 12.5, 11.16, 11.17, 14.5, 14.6_

  - [ ] 16.2 Write the independent `MAX_PNG_BYTES` recompute test
    - In `src/core/formats/max-png-bytes.test.ts`: recompute from first principles with the pixel cap 4,194,304, dimension cap 4,096, block size 65,535 and the overhead constants 8, 12, 13, 5 and 6 written as literals in the test, not imported from `limits.ts`; assert the result equals the exported `MAX_PNG_BYTES` (16,782,660)
    - Encode 1024 by 4096 and assert the length equals `MAX_PNG_BYTES`; encode 4096 by 1024 and 2048 by 2048 and assert each length is at most `MAX_PNG_BYTES`
    - _Requirements: 1.17, 11.9, 11.16, 11.17, 14.16_

- [ ] 17. Final checkpoint - Ensure all tests pass
  - Run `npm test`, `npm run test:fuzz` and `npm run typecheck`. Ensure all tests pass, ask the user if questions arise.

## Notes

- No task in this plan is optional. The full suite of unit, property, hostile and timing tests is required.
- No `package.json` change is needed: Vitest and fast-check are already installed and pinned, and the module adds no runtime dependency. If a change ever turns out to be needed, it must become its own task that stops for explicit user approval before anything is installed.
- Task 1.1 and task 1.2 are the approved prerequisites and run before any formats code.
- `timed()` measures only the converter call. Generate and build inputs first, start the timer immediately before the call and stop it immediately after.
- Property callbacks return nothing or a boolean and never call `expect(...)`. Each property is tagged with `// Feature: format-resurrection, Property N: <title>` and uses `numRuns(100)`.
- Some property groups are split across more test files than the design's file table lists, so tasks in the same wave never write to the same file. The properties themselves are unchanged.
- Each task references the requirements it satisfies; checkpoints give incremental validation.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "2.1"] },
    { "id": 1, "tasks": ["2.2", "4.1"] },
    { "id": 2, "tasks": ["2.3", "3.1", "4.2"] },
    { "id": 3, "tasks": ["2.4", "2.5", "3.2", "4.3", "7.1", "8.1", "10.1", "10.2", "12.1", "12.2"] },
    { "id": 4, "tasks": ["3.3", "4.4", "4.5", "5.1", "8.2", "10.3", "12.3", "12.4"] },
    { "id": 5, "tasks": ["5.2", "5.4", "5.6", "7.2", "7.5", "8.3", "8.4", "8.7", "8.8", "8.11", "10.4", "10.6", "12.5"] },
    { "id": 6, "tasks": ["5.3", "5.5", "7.3", "8.5", "8.9", "10.5", "10.7", "10.8", "10.10", "10.12", "10.14", "12.6", "12.7", "12.8", "12.9", "13.1"] },
    { "id": 7, "tasks": ["7.4", "8.6", "8.10", "10.9", "10.11", "10.13", "10.15", "12.10", "13.2", "13.3", "13.5", "14.1", "15.1", "15.2", "16.1", "16.2"] },
    { "id": 8, "tasks": ["13.4"] }
  ]
}
```
