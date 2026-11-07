# Requirements Document

## Introduction

`README.TXT` on every demo disk opens in the graveyard page as a red "no converter for this format" line above a hex dump. It is the most readable file on the disk and a judge is likely to click it first, so the page looks broken. This feature is a small follow-up to the `format-resurrection` spec. It adds a fourth converter, plain text, so that DOS text files open as text.

The Plain_Text_Converter decodes Input_Bytes as CP437 with the existing `decodeCp437` function (exported from `src/core/fat12`), normalizes line endings, drops the DOS end-of-file marker and everything after it, and returns a UTF-8 string with the mime `text/plain` and the extension `.txt`. The Format_Detector gains a `text` format. It picks `text` from the file name extension when no content rule matched, and from the content as the very last rule.

The change reaches four places beyond `src/core/formats/`: the web preview in `src/web/`, the MCP tools `read_grave` and `exhume` in `src/mcp/`, the demo disk expected checks in `src/demo-disks/checks/`, and one line in `README.md`.

The bytes are untrusted, as in `format-resurrection`. The Plain_Text_Converter uses the same limits module (`src/core/formats/limits.ts`), the same warning collector, the same input guard and the same hostile-input guarantees as the other converters. Plain text joins the existing hostile and property suites; it does not get a separate, weaker suite.

Out of scope: other formats (Word, WordPerfect, Lotus), hooks, the Crew app, deployment, and any change to `src/core/fat12` other than exporting the CP437 decoder if it is not exported yet (it is exported today, so no change is expected). The demo disk images do not change, and `make:demos --check` must still report that they match.

## Glossary

- **Plain_Text_Converter**: The function `convertPlainText` in `src/core/formats/` that converts Input_Bytes to Plain_Text_Output. It is the fourth converter of the Format_Converters, next to the WordStar_Converter, the DBase_Converter and the PCX_Converter.
- **Format_Converters**: The set of modules in `src/core/formats/` defined by the `format-resurrection` spec, extended here with the Plain_Text_Converter.
- **Format_Detector**: The function `detectFormat` that names the format of Input_Bytes. After this feature it returns `wordstar`, `dbase`, `pcx`, `text` or `unknown`.
- **Auto_Converter**: The function `convertAuto` that runs the Format_Detector and then the matching converter.
- **Input_Bytes**: The `Uint8Array` that a caller passes to a converter or to the Format_Detector.
- **Detection_Sample**: The first `DETECT_SAMPLE_BYTES` bytes of Input_Bytes (or all of them when shorter).
- **Conversion_Result**: The value a converter returns, as defined by `format-resurrection`: `{ ok: true, output, mime, extension, warnings }` or `{ ok: false, error, warnings }`.
- **Conversion_Warning**: A structured entry in the `warnings` array of a Conversion_Result with a machine-readable `code` and a fixed-template `message` that holds numbers only and never holds text taken from Input_Bytes.
- **Plain_Text_Output**: The `output` string of a successful Plain_Text_Converter result. Its `mime` is `text/plain` and its `extension` is `.txt`.
- **Text_Result**: The result type of the Plain_Text_Converter: a successful Conversion_Result with a string `output`, mime `text/plain` and extension `.txt`, or a failure.
- **Text_Extension_Set**: The file name extensions `TXT`, `BAT`, `ASC`, `LOG`, `NFO`, `DIZ`, `1ST` and `ME` (the last for `READ.ME`), compared with ASCII case folding on the text after the last dot.
- **Text_Content_Bytes**: The bytes `0x20` to `0x7E`, TAB (`0x09`), LF (`0x0A`), FF (`0x0C`), CR (`0x0D`) and the DOS end-of-file byte `0x1A`.
- **EOF_Byte**: The DOS end-of-file byte `0x1A`.
- **Control_Byte**: A byte below `0x20` that is not TAB, LF, FF, CR or the EOF_Byte, or the byte `0x7F`.
- **Text_Output_Limit**: The named constant `MAX_TEXT_OUTPUT_BYTES` in `src/core/formats/limits.ts`. It bounds the UTF-8 length of Plain_Text_Output.
- **Limits**: The numeric bounds in `src/core/formats/limits.ts`, extended here with the Text_Output_Limit.
- **Preview_Dialog**: The dialog in `src/web/` that shows a file after the visitor clicks its tombstone.
- **Read_Grave_Tool**: The MCP tool `read_grave`.
- **Exhume_Tool**: The MCP tool `exhume`, which writes into the fixed `exhumed/` folder.
- **Demo_Disks**: The three images `writers-disk.img`, `office-disk.img` and `damaged-disk.img` produced by `scripts/make-demo-disks.ts`.
- **Demo_Expected_Checks**: The expected per-disk results in `src/demo-disks/checks/expected.ts` and the checks that assert them.
- **Hostile_Suites**: The existing fast-check suites that feed random, malformed and oversized bytes to the Format_Converters, including `formats.hostile.test.ts`, `formats.targeted.hostile.test.ts` and `contract.test.ts` in `src/core/formats/`.

## Requirements

### Requirement 1: Plain text conversion

**User Story:** As a visitor with an old floppy, I want a DOS text file to open as readable text, so that I can read the most ordinary file on the disk without a hex dump.

#### Acceptance Criteria

1. WHEN Input_Bytes are passed to the Plain_Text_Converter, THE Plain_Text_Converter SHALL return a Text_Result whose `output` is the CP437 decoding of the converted bytes, produced with the `decodeCp437` function exported from `src/core/fat12`.
2. THE Plain_Text_Converter SHALL return `mime` equal to `text/plain` and `extension` equal to `.txt` on every successful Text_Result.
3. THE Format_Converters SHALL contain no second CP437 table.
4. WHEN Input_Bytes contain the byte pair CR LF, THE Plain_Text_Converter SHALL write one LF to Plain_Text_Output for that pair.
5. WHEN Input_Bytes contain a CR that is not followed by LF, THE Plain_Text_Converter SHALL write one LF to Plain_Text_Output for that CR.
6. WHEN Input_Bytes contain an LF that is not preceded by CR, THE Plain_Text_Converter SHALL write that LF to Plain_Text_Output.
7. WHEN Input_Bytes contain a TAB, THE Plain_Text_Converter SHALL write that TAB to Plain_Text_Output.
8. WHEN Input_Bytes contain an FF, THE Plain_Text_Converter SHALL write that FF to Plain_Text_Output without a warning.
9. WHEN Input_Bytes contain an EOF_Byte, THE Plain_Text_Converter SHALL stop reading at the first EOF_Byte and SHALL write neither that byte nor any later byte to Plain_Text_Output.
10. WHEN Input_Bytes contain a byte from `0x80` to `0xFF`, THE Plain_Text_Converter SHALL write the CP437 character for that byte to Plain_Text_Output.
11. WHEN Input_Bytes contain Control_Bytes before the first EOF_Byte, THE Plain_Text_Converter SHALL drop those bytes and SHALL add one Conversion_Warning with the code `control-codes-dropped` whose message holds the number of dropped bytes.
12. WHEN Input_Bytes are empty, THE Plain_Text_Converter SHALL return a successful Text_Result with an empty `output` and no warnings.
13. THE Plain_Text_Output SHALL contain no CR, no EOF_Byte and no Control_Byte.
14. WHEN the same Input_Bytes are passed twice, THE Plain_Text_Converter SHALL return equal Conversion_Results.
15. FOR ALL Plain_Text_Output strings, converting the CP437 encoding of that string through the Plain_Text_Converter SHALL produce the same string (idempotence property).

### Requirement 2: Detection of plain text

**User Story:** As a developer of the web page, MCP server or Crew app, I want the detector to name text files, so that the Auto_Converter converts them without caller code per extension.

#### Acceptance Criteria

1. THE Format_Detector SHALL return `text` as a fifth value of `DetectedFormat`, and the Auto_Converter SHALL run the Plain_Text_Converter when the Format_Detector returns `text`.
2. THE Format_Detector SHALL apply its rules in this order: PCX content rule, dBase content rule, WordStar content rule, file name extension, plain text content rule.
3. WHEN no content rule for PCX, dBase or WordStar matches and the file name extension is in the Text_Extension_Set, THE Format_Detector SHALL return the format `text` with the source `extension`.
4. WHEN the file name extension is `WS`, `WS4` to `WS7`, `WSD`, `DBF` or `PCX`, THE Format_Detector SHALL return the existing format for that extension and not `text`.
5. WHEN no other rule matched, the Detection_Sample is not empty, and the Detection_Sample holds only Text_Content_Bytes, THE Format_Detector SHALL return the format `text` with the source `content`.
6. WHEN a PCX, dBase or WordStar content rule matches Input_Bytes with the extension `TXT`, THE Format_Detector SHALL return that content format and not `text`.
7. WHEN the Detection_Sample holds any byte that is not a Text_Content_Byte, no other rule matched, and the file name extension is not in the Text_Extension_Set, THE Format_Detector SHALL return `unknown` with the source `none`.
8. WHEN the file name argument is not a string or is longer than the existing file name length bound, THE Format_Detector SHALL ignore the file name and apply the content rules only.
9. WHEN Input_Bytes chosen by extension contain Control_Bytes, THE Auto_Converter SHALL convert them with the Plain_Text_Converter and the `control-codes-dropped` warning from Requirement 1.
10. THE Format_Detector SHALL read at most `DETECT_SAMPLE_BYTES` bytes for the plain text content rule.
11. THE Format_Detector SHALL apply the plain text content rule with one bounded pass and no regular expression.
12. THE Format_Detector SHALL return the same result for the same Input_Bytes and file name on every call.

### Requirement 3: Limits and hostile-input guarantees

**User Story:** As a maintainer, I want the plain text converter to obey the same limits as the other converters, so that a hostile file cannot break it.

#### Acceptance Criteria

1. THE limits module SHALL define `MAX_TEXT_OUTPUT_BYTES` as a named exported constant equal to `MAX_MARKDOWN_OUTPUT_BYTES` (8,388,608 bytes of UTF-8), and the Plain_Text_Converter SHALL contain no other numeric limit as a literal.
2. THE Plain_Text_Converter SHALL read at most `MAX_CONVERT_INPUT_BYTES` bytes of Input_Bytes and, WHEN Input_Bytes are longer, SHALL add the existing `input-truncated` Conversion_Warning.
3. WHEN the UTF-8 length of Plain_Text_Output would exceed the Text_Output_Limit, THE Plain_Text_Converter SHALL stop at a character boundary, SHALL return the text written so far, and SHALL add one Conversion_Warning with the code `output-capped` whose message names the Text_Output_Limit.
4. THE Plain_Text_Converter SHALL return at most `MAX_WARNINGS` plus one Conversion_Warnings, using the existing warning collector.
5. THE Plain_Text_Converter SHALL use no regular expression and no recursion, and every loop step SHALL consume at least one byte of Input_Bytes.
6. IF Input_Bytes are not a `Uint8Array`, THEN THE Plain_Text_Converter SHALL reject them with the same guard behavior as the other converters.
7. IF an unexpected internal defect occurs during conversion, THEN THE Plain_Text_Converter SHALL return a failure Conversion_Result and SHALL NOT throw.
8. THE Conversion_Warning messages of the Plain_Text_Converter SHALL be fixed templates in `src/core/formats/templates.ts` that hold numbers only.
9. THE Plain_Text_Converter SHALL import nothing outside `src/core/` and SHALL use no DOM API, no Node API and no I/O.
10. THE Hostile_Suites SHALL include the Plain_Text_Converter and the `text` detection, and SHALL assert that random bytes, bytes with no EOF_Byte, bytes made only of Control_Bytes, bytes made only of CR, and inputs at and above the input and output limits never make the converter throw, hang or exceed its output cap.
11. THE format test suites SHALL include a property test that compares the Plain_Text_Converter with an independent model written in `src/test-support/formats/`, for random byte arrays, and SHALL include example tests for CRLF, lone CR, tab, EOF_Byte truncation, high-half CP437 bytes, an empty file and a control-byte file.
12. THE format test suites SHALL update the existing tests that expect `no converter for this format` or `unknown` for text files, so that no test expects the old behavior.

### Requirement 4: Web preview

**User Story:** As a visitor, I want to click README.TXT and read it, so that the page does not look broken.

#### Acceptance Criteria

1. WHEN the Auto_Converter returns a successful Text_Result for the clicked file, THE Preview_Dialog SHALL show the converted text in a scrollable, keyboard-focusable region with an accessible label.
2. THE Preview_Dialog SHALL insert the converted text into the DOM with `textContent` only, in the same way as the Markdown preview.
3. WHEN the converted text is longer than the existing preview length bound, THE Preview_Dialog SHALL show the shortened text with the same shortened-text notice as the Markdown preview.
4. WHEN the converted text is shown, THE Preview_Dialog SHALL offer a "Download .txt" action and a "Download raw bytes" action.
5. WHEN the visitor activates "Download .txt", THE graveyard page SHALL create a Blob with the mime `text/plain` and a sanitized file name that ends in `.txt`.
6. WHEN the visitor activates "Download raw bytes", THE graveyard page SHALL create a Blob with the mime `application/octet-stream` and a sanitized file name.
7. WHEN a conversion of a text file produced warnings, THE Preview_Dialog SHALL list those warnings in the same way as for the other converters.
8. THE graveyard page SHALL NOT show the "no converter" line for a file that the Auto_Converter converts as text.
9. WHEN the Auto_Converter returns a failure with no converter for the clicked file, THE Preview_Dialog SHALL keep showing the existing "no converter" line and the hex view.
10. THE graveyard page SHALL add `text/plain` to its fixed download mime allowlist, and the worker message validation SHALL accept a `text` result only with its fixed mime and extension taken from the result kind, never from the message.
11. IF a worker message claims the kind `text` with a body that is not a string, THEN THE graveyard page SHALL reject that message in the same way as for the other result kinds.
12. THE Content Security Policy of the page SHALL remain the policy defined in the safety rules.

### Requirement 5: MCP server

**User Story:** As Kiro's agent, I want to read and exhume a text file from a floppy image, so that the demo's second act works on the most common file.

#### Acceptance Criteria

1. WHEN the Auto_Converter returns a successful Text_Result for the selected Grave, THE Read_Grave_Tool SHALL return the converted text with the `format` value `text`, the mime `text/plain` and the extension `.txt`.
2. THE Read_Grave_Tool SHALL wrap the text as labeled untrusted content from the disk, strip control characters and apply the existing text length cap, in the same way as for the other text formats.
3. WHEN the Exhume_Tool exhumes a Grave that the Auto_Converter converts as text, THE Exhume_Tool SHALL write one new file with the extension `.txt` into the fixed `exhumed/` folder and SHALL return the `format` value `text`.
4. THE Exhume_Tool SHALL rebuild the file name of a text file from the allowlist `[A-Za-z0-9._-]` with at most 64 characters, SHALL choose the extension `.txt` itself, and SHALL NOT overwrite an existing file.
5. THE extension union type in `src/mcp/exhume-writer.ts` (`exhumeBase`), in `src/mcp/tools/read-grave.ts` and in `src/mcp/tools/exhume.ts` SHALL include `.txt`.
6. THE MCP tests SHALL assert the `text` format and the `.txt` file for `read_grave` and `exhume`, and SHALL replace the existing expectations of the error code `NO_CONVERTER` for `.TXT` files.
7. THE MCP tool descriptions and error messages SHALL NOT hold text taken from a disk.
8. THE committed build `power/server/exhume-mcp.mjs` SHALL be rebuilt with `npm run build:mcp` so that it contains the Plain_Text_Converter.
9. THE shipped `mcp.json` SHALL keep an empty auto-approve list.

### Requirement 6: Demo disks

**User Story:** As a judge, I want README.TXT on every demo disk to open as text, so that the first click works.

#### Acceptance Criteria

1. WHEN the Auto_Converter runs on `/README.TXT` of each of the three Demo_Disks, THE Auto_Converter SHALL return a successful Text_Result with no warnings.
2. THE Demo_Expected_Checks SHALL assert that `/README.TXT` converts to text on each Demo_Disk, and SHALL stop listing `/README.TXT` as a file with no converter.
3. THE Demo_Expected_Checks SHALL assert that `/INVOICES/INV8903.TXT` on `office-disk.img` converts to text, because the extension `TXT` makes it a text file, and SHALL stop listing it as a file with no converter.
4. THE Demo_Expected_Checks SHALL assert that the converted `/README.TXT` text of each Demo_Disk contains the existing generated-by marker phrase and written-for-the-demo marker phrase.
5. THE Demo_Disks SHALL keep their bytes, so that `npm run make:demos -- --check` reports that all three images match.
6. THE Demo_Expected_Checks SHALL keep every other existing expectation (Grave list, states, sizes, dates, warning codes) unchanged.

### Requirement 7: Documentation

**User Story:** As a reader of the project, I want the README to list the text conversion, so that the documented conversions match the product.

#### Acceptance Criteria

1. THE `README.md` SHALL list plain text files rising as `.txt` text among the conversions, in one added line or one added list entry next to WordStar, dBase and PCX.
2. THE `power/POWER.md` description of the Read_Grave_Tool SHALL list plain text among the formats of the returned preview.
