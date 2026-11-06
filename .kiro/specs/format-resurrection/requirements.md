# Requirements Document

## Introduction

The format resurrection module turns the bytes of a recovered file into a format people use today. It lives in `src/core/formats/` and has three converters and one encoder:

- **WordStar** documents become Markdown text.
- **dBase III** tables (`.dbf`) become CSV text.
- **PCX** images become PNG images, through a PNG encoder written for this project.

A detector picks the converter from the file content first and from the file name second. Files that match no converter are not converted, and the caller offers them as raw downloads.

The input is a `Uint8Array`, usually the bytes returned by the FAT12 core for one Grave. The bytes are untrusted. Every header field, record length, run length, dimension and text byte is attacker-controlled. The module follows the same conventions as the completed `fat12-core` spec: it is pure TypeScript with zero runtime dependencies, every numeric limit is a named constant in one limits module, a defect produces a warning or a failure result instead of an exception, and tests use Vitest and fast-check with `numRuns()` and `timed()` from `src/test-support/`.

Out of scope: the web page, the MCP server, the demo disk generator script, and reading files out of a disk image (that is `fat12-core`). Also out of scope are other WordStar-family formats (WordStar 2000 and Windows versions), dBase memo (`.dbt`) files, dBase index files, dBase II and IV variants, PCX files with a bit depth of 2 bits per pixel, and PNG decoding in production code.

## Glossary

- **Format_Converters**: The set of modules in `src/core/formats/` made up of the WordStar_Converter, the DBase_Converter, the PCX_Converter, the PNG_Encoder and the Format_Detector.
- **WordStar_Converter**: The function that converts WordStar document bytes to Markdown_Text.
- **DBase_Converter**: The function that converts dBase III table bytes to CSV_Text.
- **PCX_Converter**: The function that decodes PCX image bytes into an RGBA_Image and encodes it as a PNG_File through the PNG_Encoder.
- **PNG_Encoder**: The function that turns an RGBA_Image into a PNG_File without any compression library.
- **Format_Detector**: The function that names the format of a byte array as `wordstar`, `dbase`, `pcx` or `unknown`.
- **Input_Bytes**: The `Uint8Array` that a caller passes to a converter or to the Format_Detector.
- **Conversion_Result**: The value a converter returns. On success it is `{ ok: true, output, mime, extension, warnings }`. On failure it is `{ ok: false, error, warnings }`.
- **Conversion_Warning**: A structured entry in the `warnings` array of a Conversion_Result, with a machine-readable `code` and a `message`. The `message` is a fixed template that holds numbers only and never holds text taken from Input_Bytes.
- **Markdown_Text**: A string of Markdown produced by the WordStar_Converter.
- **CSV_Text**: A string in RFC 4180 form produced by the DBase_Converter, with CRLF line endings.
- **PNG_File**: A `Uint8Array` that holds a valid PNG file.
- **RGBA_Image**: A value `{ width, height, rgba }` where `rgba` is a `Uint8Array` of `width * height * 4` bytes in row-major order, one byte each for red, green, blue and alpha.
- **Limits**: The numeric bounds in the single module `src/core/formats/limits.ts`. See Requirement 1 for the values.
- **Hard_Return**: In WordStar text, the byte pair `0x0D 0x0A`.
- **Soft_Return**: In WordStar text, the byte pair `0x8D 0x0A` (carriage return with the high bit set), which the word processor inserted when it wrapped a line.
- **Style_Toggle**: A WordStar control byte that switches a text style on or off: `0x02` (bold, Ctrl-B), `0x13` (underline, Ctrl-S) and `0x19` (italic, Ctrl-Y).
- **Dot_Command**: A line in WordStar text whose first character is `.` followed by two ASCII letters. It is a layout instruction such as `.PA` and not document text.
- **Dot_Comment**: A line in WordStar text whose first two characters are `..`.
- **Markdown_Special**: A character that Markdown treats as markup: `\`, `` ` ``, `*`, `_`, `<`, `>`, `[` and `]`, and also `#`, `+`, `-` and a digit followed by `.` or `)` when it is the first character of a line.
- **Plain_ASCII_Text**: Text made of lines of bytes `0x20` to `0x7E` that contain no Markdown_Special character and do not start with `.`, with the lines joined by Hard_Returns.
- **DBF_Header**: The first `headerLength` bytes of a dBase III file: a 32-byte table header, one 32-byte descriptor for each field, and a terminator byte `0x0D`.
- **DBF_Field**: One column of a dBase table, described by a name, a type letter (`C`, `N`, `F`, `D`, `L` or `M`), a length and a decimal count.
- **DBF_Record**: One row of a dBase table: a deletion flag byte (`0x20` active, `0x2A` deleted) followed by the field values at fixed widths.
- **Cell_Text**: The string the DBase_Converter writes for one value, before CSV quoting.
- **Formula_Prefix_Character**: One of `=`, `+`, `-`, `@`, tab (`0x09`) or carriage return (`0x0D`) at the start of a text cell. A spreadsheet can read such a cell as a formula.
- **PCX_Header**: The first 128 bytes of a PCX file.
- **PCX_Scanline**: The decoded bytes of one image row, `planeCount * bytesPerLine` bytes long.
- **RLE_Stream**: The run-length encoded pixel data of a PCX file, where a byte of `0xC0` or more starts a run whose length is the low 6 bits and whose value is the next byte.
- **Format_Test_Support**: Test-only modules in `src/test-support/formats/`: a WordStar fixture writer, a dBase table writer, a PCX encoder, a CSV parser, and a PNG decoder that cross-checks against Node's `zlib`. They live outside `src/core/`.
- **Core_Purity_Rule**: The constraint that `src/core/` has zero runtime dependencies and uses no DOM, Node API, network or I/O.

## Requirements

### Requirement 1: Conversion contract and limits

**User Story:** As a developer of the web page, MCP server or Crew app, I want every converter to follow one contract and one set of limits, so that I handle all formats in the same way and a hostile file cannot break any of them.

#### Acceptance Criteria

1. THE Format_Converters SHALL define every numeric Limit as a named exported constant in `src/core/formats/limits.ts` and SHALL repeat no Limit value as a literal in another non-test module under `src/core/formats/`.
2. THE limits module SHALL define these Limits with these values:
   - `MAX_CONVERT_INPUT_BYTES` = 4,194,304;
   - `DETECT_SAMPLE_BYTES` = 4,096;
   - `MAX_WARNINGS` = 100;
   - `MAX_MARKDOWN_OUTPUT_BYTES` = 8,388,608;
   - `MAX_DBF_FIELDS` = 128;
   - `MAX_DBF_RECORDS` = 100,000;
   - `MAX_CSV_OUTPUT_BYTES` = 16,777,216;
   - `MAX_IMAGE_DIMENSION` = 4,096;
   - `MAX_IMAGE_PIXELS` = 4,194,304 (so 2048 by 2048 and 4096 by 1024 fit, and 2049 by 2048 does not);
   - `MAX_PCX_BYTES_PER_LINE` = 4,096;
   - `MAX_PCX_DECODED_BYTES` = 16,777,216;
   - `MAX_PNG_BYTES` = 16,782,660 (derived, see criterion 17);
   - `PNG_STORED_BLOCK_MAX` = 65,535;
   - `PNG_SIGNATURE_BYTES` = 8, `PNG_CHUNK_OVERHEAD_BYTES` = 12, `PNG_IHDR_DATA_BYTES` = 13, `PNG_STORED_BLOCK_OVERHEAD_BYTES` = 5 and `PNG_ZLIB_WRAPPER_BYTES` = 6 (the inputs of the `MAX_PNG_BYTES` derivation);
   - `CONVERT_TIME_BUDGET_MS` = 2,000 (used by tests only).
3. THE Format_Converters SHALL export their public API from `src/core/formats/index.ts`, including the Conversion_Result, Conversion_Warning and RGBA_Image types, the Limits, `detectFormat`, `convertWordStar`, `convertDBase`, `convertPcx`, `encodePng` and a `convertAuto` function that runs the Format_Detector and then the matching converter.
4. WHEN a converter returns a Conversion_Result with `ok: true`, THE converter SHALL include the output, a `mime` of exactly `text/markdown`, `text/csv` or `image/png`, a file `extension` of exactly `.md`, `.csv` or `.png` that matches the `mime`, and a `warnings` array that is empty when no warning applies.
5. IF a converter returns a Conversion_Result with `ok: false`, THEN THE converter SHALL include an `error` string that is a fixed template of 1 to 200 characters with numbers only, and a `warnings` array.
6. IF the Input_Bytes are longer than `MAX_CONVERT_INPUT_BYTES`, THEN THE converter SHALL process only the first `MAX_CONVERT_INPUT_BYTES` bytes and SHALL add one Conversion_Warning with code `input-truncated`.
7. WHEN any `Uint8Array` of 0 to 8,388,608 bytes is passed to a converter or to the Format_Detector, THE Format_Converters SHALL return a result without throwing an exception.
8. IF the argument of a converter or of the Format_Detector is not a `Uint8Array`, THEN THE Format_Converters SHALL throw a `TypeError` with the message `invalid input type: expected Uint8Array` before creating any state.
9. WHEN any converter or the Format_Detector returns or throws, THE Format_Converters SHALL leave every byte of the Input_Bytes identical to its value before the call.
10. WHEN a Node `Buffer` and a plain `Uint8Array` hold identical bytes, THE converter SHALL return deeply equal Conversion_Results for both.
11. WHEN a converter is called twice with identical Input_Bytes, THE converter SHALL return deeply equal Conversion_Results, using no clock value and no random value.
12. IF more than `MAX_WARNINGS` defects occur in one conversion, THEN THE converter SHALL keep the first `MAX_WARNINGS` Conversion_Warnings and SHALL replace all later ones with one final Conversion_Warning with code `warnings-capped`, so that the `warnings` array holds at most `MAX_WARNINGS + 1` entries.
13. THE converter SHALL write every Conversion_Warning `message` and every failure `error` from a fixed template that holds numbers only, so that no text from Input_Bytes reaches a message an agent could read as an instruction.
14. THE Conversion_Result SHALL contain only strings, numbers, booleans, null, arrays, plain objects and `Uint8Array` values.
15. IF a limit from this document is exceeded while converting, THEN THE converter SHALL stop work on the affected item, add one Conversion_Warning that names the exceeded limit by its constant name, return the output produced so far when this document defines a partial output for the format, and otherwise return a result with `ok: false` and an `error` that meets criterion 5.
16. WHEN a converter runs on Input_Bytes of up to `MAX_CONVERT_INPUT_BYTES` bytes in a test, including an input that decodes to the largest accepted image, THE converter SHALL return its result within `CONVERT_TIME_BUDGET_MS` milliseconds.
17. THE limits module SHALL define `MAX_PNG_BYTES` as a computed exported constant derived from `MAX_IMAGE_PIXELS`, `MAX_IMAGE_DIMENSION`, `PNG_STORED_BLOCK_MAX`, `PNG_SIGNATURE_BYTES`, `PNG_CHUNK_OVERHEAD_BYTES`, `PNG_IHDR_DATA_BYTES`, `PNG_STORED_BLOCK_OVERHEAD_BYTES` and `PNG_ZLIB_WRAPPER_BYTES`, and SHALL NOT define it as a free-standing numeric literal. The derivation is the worst case over every accepted image, which has the maximum pixel count and the maximum height (1024 wide by 4096 tall, since the height is capped at `MAX_IMAGE_DIMENSION`):
   - filtered data = `MAX_IMAGE_PIXELS` * 4 + `MAX_IMAGE_DIMENSION` = 16,777,216 + 4,096 = 16,781,312 bytes;
   - stored blocks = ceil(16,781,312 / 65,535) = 257, each with 5 bytes of overhead, which is 1,285 bytes;
   - zlib stream = 16,781,312 + 1,285 + 6 (2-byte zlib header and 4-byte Adler-32) = 16,782,603 bytes, which is the payload of the single IDAT chunk (Requirement 11 criterion 1);
   - file = 8 (signature) + 25 (IHDR chunk: 12 + 13) + 16,782,615 (IDAT chunk: 12 + 16,782,603) + 12 (IEND chunk) = 16,782,660 bytes.

### Requirement 2: Format detection

**User Story:** As a user, I want the right converter chosen for each file, so that a click on a tombstone works without my naming the format.

#### Acceptance Criteria

1. THE Format_Detector SHALL accept Input_Bytes and an optional file name string, and SHALL return `{ format, source }` where `format` is one of `wordstar`, `dbase`, `pcx` or `unknown`, and `source` is one of `content`, `extension` or `none`.
2. THE Format_Detector SHALL examine at most the first `DETECT_SAMPLE_BYTES` bytes of the Input_Bytes, plus the Input_Bytes length.
3. WHEN the Input_Bytes hold at least 4 bytes, the first byte is `0x0A`, the version byte (byte offset 1) is 0, 2, 3, 4 or 5, the encoding byte (byte offset 2) is 1 and the bits-per-pixel byte (byte offset 3) is 1, 2, 4 or 8, THE Format_Detector SHALL return `{ format: 'pcx', source: 'content' }`.
4. WHEN the Input_Bytes hold at least 12 bytes, the first byte is `0x03` or `0x83`, the header length (unsigned 16-bit little-endian at byte offset 8) is from 65 to 4,129, the record length (unsigned 16-bit little-endian at byte offset 10) is at least 2, and the header length is less than the Input_Bytes length, THE Format_Detector SHALL return `{ format: 'dbase', source: 'content' }`.
5. WHEN criteria 3 and 4 do not match and the sample holds at least one Soft_Return, or at least one line that is a Dot_Command, or at least one Style_Toggle byte together with at least one Hard_Return, THE Format_Detector SHALL return `{ format: 'wordstar', source: 'content' }`.
6. IF content detection finds no format and a file name is given, THEN THE Format_Detector SHALL compare the file name extension, ignoring case, against `.WS`, `.WS4`, `.WS5`, `.WS6`, `.WS7` and `.WSD` for `wordstar`, `.DBF` for `dbase`, and `.PCX` for `pcx`, and SHALL return the matching format with `source: 'extension'`. The extension is the text after the last `.` in the file name, and a file name with no `.` has no extension.
7. IF content detection finds a format and the file name extension names a different format, THEN THE Format_Detector SHALL return the format found from the content.
8. IF no content rule and no extension rule matches, THEN THE Format_Detector SHALL return `{ format: 'unknown', source: 'none' }`.
9. IF the Input_Bytes are empty or shorter than the bytes a content rule needs, THEN THE Format_Detector SHALL treat that content rule as not matching, SHALL NOT throw an exception, and SHALL continue with criteria 6 and 8.
10. IF the file name argument is absent, is not a string, or is longer than 255 characters, THEN THE Format_Detector SHALL ignore the file name and SHALL decide from the content alone.
11. WHEN `convertAuto` receives Input_Bytes whose detected format is `unknown`, THE `convertAuto` function SHALL return a failure result with `ok: false`, the error `no converter for this format`, and an empty `warnings` array.
12. THE Format_Detector SHALL use the file name for the extension comparison in criterion 6 and for nothing else, so that a hostile file name cannot change behavior in any other way.

### Requirement 3: WordStar text decoding

**User Story:** As a writer with old WordStar files, I want the text of my document back, so that I can read what I wrote.

#### Acceptance Criteria

1. WHEN the WordStar_Converter reads a byte in the range `0x80` to `0xFF` that is not part of a Soft_Return, THE WordStar_Converter SHALL clear the high bit and process the resulting 7-bit byte (range `0x00` to `0x7F`) under criteria 2 to 8 and 13.
2. WHEN the WordStar_Converter reads a Hard_Return, THE WordStar_Converter SHALL write exactly one line feed (`\n`) to the Markdown_Text.
3. WHEN the WordStar_Converter reads a Soft_Return, THE WordStar_Converter SHALL write exactly one space (`U+0020`), unless the output is empty or already ends in a space or a line feed, in which case the WordStar_Converter SHALL write nothing.
4. WHEN the WordStar_Converter reads a bare carriage return (`0x0D` or `0x8D` not followed by `0x0A` or `0x8A`) or a bare line feed (`0x0A`), THE WordStar_Converter SHALL treat it as a Hard_Return.
5. WHEN the WordStar_Converter reads the byte `0x1A`, THE WordStar_Converter SHALL stop reading, ignore all later bytes, and return `ok: true` with the output written so far and no warning for the ignored bytes.
6. WHEN the WordStar_Converter reads a tab (`0x09`), THE WordStar_Converter SHALL write exactly one space (`U+0020`).
7. WHEN the WordStar_Converter reads the soft hyphen byte `0x1F` or a null byte `0x00`, THE WordStar_Converter SHALL write nothing and SHALL NOT count the byte as dropped under criterion 8.
8. WHEN the WordStar_Converter reads any other byte below `0x20` that is not a Style_Toggle, THE WordStar_Converter SHALL write nothing, and after the conversion SHALL add exactly one Conversion_Warning with code `control-codes-dropped` that holds the total number of dropped bytes (1 or more), and SHALL add no such warning if the count is 0.
9. THE WordStar_Converter SHALL write only the characters `U+0020` to `U+007E`, the line feed and the style markers of Requirement 4 to the Markdown_Text, so that the output holds no other control character.
10. WHEN the Markdown_Text reaches `MAX_MARKDOWN_OUTPUT_BYTES` bytes, THE WordStar_Converter SHALL stop reading, return the output so far with `ok: true` and a length of at most `MAX_MARKDOWN_OUTPUT_BYTES` bytes, and add exactly one Conversion_Warning with code `output-capped`.
11. WHEN the Input_Bytes are empty (length 0), THE WordStar_Converter SHALL return `ok: true` with an empty Markdown_Text and no warnings.
12. FOR ALL Plain_ASCII_Text, THE WordStar_Converter SHALL return a Markdown_Text equal to the same text with each Hard_Return replaced by a line feed, with no warnings (pass-through property).
13. WHEN the WordStar_Converter reads the byte `0x7F` (or `0xFF` after high-bit clearing), THE WordStar_Converter SHALL write nothing and SHALL count the byte as dropped under criterion 8, so that criterion 9 holds.

### Requirement 4: WordStar styles and Markdown escaping

**User Story:** As a writer, I want bold and underlined text to stay marked, and I want the converted text to be safe to display, so that the page looks right and the document cannot inject markup.

#### Acceptance Criteria

1. WHEN the WordStar_Converter reads a bold Style_Toggle, THE WordStar_Converter SHALL switch bold on if it is off and off if it is on, and SHALL wrap each run of text written while bold is on in a pair of `**` markers.
2. WHEN the WordStar_Converter reads an underline Style_Toggle or an italic Style_Toggle, THE WordStar_Converter SHALL switch the shared emphasis state (on becomes off, off becomes on), and SHALL wrap each run of text written while emphasis is on in a pair of `*` markers.
3. WHEN the WordStar_Converter reads a Hard_Return while a style is on, THE WordStar_Converter SHALL close that style's markers before the line feed and reopen them at the start of the next output line that holds at least one non-space character, so that the markers are balanced within each output line.
4. IF a style is still on at the end of the Input_Bytes, THEN THE WordStar_Converter SHALL close its markers before the end of the output.
5. IF a style span holds only spaces, THEN THE WordStar_Converter SHALL write the span without markers.
6. WHEN a style span begins or ends with spaces, THE WordStar_Converter SHALL place those leading and trailing spaces outside its markers, so that each opening marker is followed by a non-space character and each closing marker is preceded by a non-space character.
7. THE WordStar_Converter SHALL write a backslash before every Markdown_Special character taken from the text, so that the output holds no unescaped `<`, `>`, `[`, `]`, `` ` ``, `*` or `_` that came from the document.
8. WHEN a Style_Toggle sequence yields no visible text, THE WordStar_Converter SHALL write no marker for it.
9. IF both bold and emphasis are on over the same text, THEN THE WordStar_Converter SHALL write the markers as properly nested pairs (the inner pair closes before the outer pair), so that no pair of markers overlaps another.
10. FOR ALL byte arrays of 0 to 1,048,576 bytes, THE number of unescaped `**` markers and the number of unescaped `*` markers in each output line SHALL be even (balance property).
11. FOR ALL byte arrays of 0 to 1,048,576 bytes, THE Markdown_Text SHALL contain no `<` or `>` character that is not preceded by a backslash, so that the web page can never receive HTML or autolink markup from a document.

### Requirement 5: WordStar dot commands

**User Story:** As a writer, I want layout instructions left out of my text, so that the converted document holds only what I wrote.

#### Acceptance Criteria

1. WHEN a line starts with a Dot_Command, THE WordStar_Converter SHALL remove the whole line, including its terminating Hard_Return, from the Markdown_Text and SHALL leave the lines before and after it unchanged.
2. WHEN a line is a Dot_Comment, THE WordStar_Converter SHALL remove the whole line, including its terminating Hard_Return, from the Markdown_Text and SHALL leave the lines before and after it unchanged.
3. WHEN a line is the page break Dot_Command `.PA`, THE WordStar_Converter SHALL replace the line with a blank line, then the line `---`, then a blank line.
4. WHEN the WordStar_Converter removes at least one Dot_Command line other than `.PA`, THE WordStar_Converter SHALL add exactly one Conversion_Warning with code `dot-commands-ignored` that holds the count of removed Dot_Command lines as a whole number from 1 upward, and the count SHALL exclude `.PA` lines and Dot_Comment lines.
5. THE WordStar_Converter SHALL read a Dot_Command only at the start of a line, where a line starts after the start of the Input_Bytes or after a Hard_Return.
6. WHEN a line starts with `.` followed by fewer than two ASCII letters, THE WordStar_Converter SHALL treat the line as document text.
7. THE WordStar_Converter SHALL compare Dot_Command letters without regard to case and SHALL apply the high-bit clearing of Requirement 3 criterion 1 before the comparison.
8. WHEN a `.` appears anywhere in a line other than its first byte, THE WordStar_Converter SHALL treat that `.` as document text and SHALL NOT remove or alter the line because of it.
9. WHEN the Input_Bytes end with a Dot_Command line that has no terminating Hard_Return, THE WordStar_Converter SHALL remove that line and SHALL still count it toward the `dot-commands-ignored` warning.
10. WHEN the Input_Bytes contain no Dot_Command lines, THE WordStar_Converter SHALL NOT add a Conversion_Warning with code `dot-commands-ignored`.

### Requirement 6: dBase III header parsing

**User Story:** As a small-business owner with an old customer table, I want the table structure read correctly, so that every column lands in the right place.

#### Acceptance Criteria

1. WHEN the DBase_Converter reads Input_Bytes of at least 32 bytes, THE DBase_Converter SHALL read from the DBF_Header the version byte, the 32-bit little-endian record count at offset 4, the 16-bit little-endian header length at offset 8, the 16-bit little-endian record length at offset 10, and one 32-byte field descriptor from offset 32 onward until the terminator byte `0x0D`.
2. THE DBase_Converter SHALL read from each field descriptor the name (bytes 0 to 10, ended at the first `0x00` byte, or after 11 bytes if no `0x00` byte is present), the type letter (byte 11), the length (byte 16) and the decimal count (byte 17).
3. THE DBase_Converter SHALL accept a table only when all of these hold, numbered 1 to 5 in the order listed:
   1. the version byte is `0x03` or `0x83`;
   2. the header length is at least 65 and at most 4,129 and at most the Input_Bytes length;
   3. the terminator byte `0x0D` is found at an offset below the header length, directly after at least 1 and at most `MAX_DBF_FIELDS` whole 32-byte descriptors;
   4. every field length is from 1 to 255;
   5. the record length is at least 1 plus the sum of all field lengths.
4. IF the Input_Bytes length is below 32 bytes, THEN THE DBase_Converter SHALL return a failure result with `ok: false` and the error `dBase header invalid` with failed condition number 2, and SHALL read no further bytes.
5. IF the version byte is not `0x03` or `0x83`, THEN THE DBase_Converter SHALL return a failure result with `ok: false` and the error `unsupported dBase version` and the version number, and SHALL not evaluate conditions 2 to 5 of criterion 3.
6. IF the version byte is `0x03` or `0x83` and the header fails any of conditions 2 to 5 in criterion 3, THEN THE DBase_Converter SHALL return a failure result with `ok: false` and the error `dBase header invalid` and the number of the lowest-numbered failed condition.
7. IF the record length is greater than 1 plus the sum of all field lengths, THEN THE DBase_Converter SHALL read each record with the declared record length as the stride, and SHALL add exactly one Conversion_Warning with code `record-length-mismatch`.
8. IF a field type letter is not one of `C`, `D`, `F`, `L`, `M` or `N`, THEN THE DBase_Converter SHALL treat the field as type `C` and SHALL add one Conversion_Warning with code `field-type-unknown` that holds the 1-based field number, once for each such field.
9. THE DBase_Converter SHALL decode field names with code page 437 using the single CP437 table that the FAT12 core already holds, and SHALL define no second copy of that table.
10. THE DBase_Converter SHALL replace each control character below `0x20` and each `0x7F` in a field name with `_`.
11. THE DBase_Converter SHALL derive the number of records to read as the smaller of the declared record count, `MAX_DBF_RECORDS`, and the number of whole records that fit between the header length and the end of the Input_Bytes (zero is a valid result and SHALL return `ok: true`).
12. IF the declared record count is greater than the number of records read, THEN THE DBase_Converter SHALL add exactly one Conversion_Warning with code `records-truncated` that holds the declared count and the count read.
13. IF the declared record count is greater than `MAX_DBF_RECORDS`, THEN THE DBase_Converter SHALL add exactly one Conversion_Warning with code `record-limit`, in addition to any `records-truncated` warning, and SHALL return the records read up to the limit with `ok: true`.
14. THE DBase_Converter SHALL allocate no buffer whose size comes from the declared record count, the header length or the record length before those values pass the checks in this requirement.

### Requirement 7: dBase records to CSV cells

**User Story:** As a small-business owner, I want every value in the table written in a clear text form, so that I can open the table in a spreadsheet.

#### Acceptance Criteria

1. THE DBase_Converter SHALL write one header row of field names, followed by one row for each active DBF_Record in on-disk order.
2. WHEN a DBF_Record has the deletion flag `0x2A`, THE DBase_Converter SHALL leave the record out of the CSV_Text and SHALL count it.
3. WHEN at least one deleted record was left out, THE DBase_Converter SHALL add one Conversion_Warning with code `deleted-records-skipped` that holds the count.
4. WHEN a DBF_Record has a deletion flag other than `0x20` and `0x2A`, THE DBase_Converter SHALL treat the record as active and SHALL add one Conversion_Warning with code `record-flag-unknown`, at most once per conversion.
5. WHEN a field has type `C`, THE DBase_Converter SHALL write the bytes decoded with code page 437, with trailing spaces and trailing `0x00` bytes removed and with each control character below `0x20` and each `0x7F` replaced by a space.
6. WHEN a field has type `N` or `F`, THE DBase_Converter SHALL remove leading and trailing spaces and, IF the remaining value is an optional `-`, followed by 1 or more digits, followed by an optional `.` and 1 or more digits, THEN THE DBase_Converter SHALL write the value unchanged.
7. IF a field has type `N` or `F` and the value after space removal does not match the form in criterion 6 (including a value that is empty after space removal), THEN THE DBase_Converter SHALL write an empty Cell_Text and add one Conversion_Warning with code `field-value-invalid` that holds the field number.
8. WHEN a field has type `D` and holds eight ASCII digits `YYYYMMDD` that form a valid calendar date from year 0001 to year 9999, THE DBase_Converter SHALL write the date as `YYYY-MM-DD`.
9. WHEN a field has type `D` and holds only spaces, THE DBase_Converter SHALL write an empty Cell_Text.
10. IF a field has type `D` and holds any other content, THEN THE DBase_Converter SHALL write an empty Cell_Text and add one Conversion_Warning with code `field-value-invalid` that holds the field number.
11. WHEN a field has type `L`, THE DBase_Converter SHALL write `TRUE` for `T`, `t`, `Y` and `y`, `FALSE` for `F`, `f`, `N` and `n`, and an empty Cell_Text for `?` or a space.
12. IF a field has type `L` and holds any other byte, THEN THE DBase_Converter SHALL write an empty Cell_Text and add one Conversion_Warning with code `field-value-invalid` that holds the field number.
13. WHEN a field has type `M`, THE DBase_Converter SHALL write an empty Cell_Text, because the memo file is not available, and SHALL add one Conversion_Warning with code `memo-not-available` at most once per conversion.
14. THE DBase_Converter SHALL add at most one Conversion_Warning with code `field-value-invalid` for each field in one conversion, so that a table with many damaged values does not exhaust `MAX_WARNINGS`.
15. WHEN the CSV_Text reaches `MAX_CSV_OUTPUT_BYTES` bytes, THE DBase_Converter SHALL end the CSV_Text after the last complete row, return it with `ok: true`, and add one Conversion_Warning with code `output-capped`.
16. WHEN the table holds no active records, THE DBase_Converter SHALL return `ok: true` with the header row only.

### Requirement 8: CSV serialization and cell safety

**User Story:** As a user who opens the converted table in a spreadsheet, I want the file to load correctly and to run nothing, so that a hostile table cannot make my spreadsheet execute a formula.

#### Acceptance Criteria

1. THE DBase_Converter SHALL end each CSV_Text row with CRLF (bytes `0x0D 0x0A`), including the last row, and SHALL separate cells within a row with a comma, so that a table of R rows (header row included) produces exactly R CRLF terminators.
2. WHEN a Cell_Text contains a comma, a double quote, a carriage return or a line feed, THE DBase_Converter SHALL enclose the Cell_Text in double quotes and SHALL double every double quote inside it.
3. WHEN a Cell_Text does not contain any of the characters in criterion 2, THE DBase_Converter SHALL write the Cell_Text without quotes.
4. WHEN the first character of a Cell_Text of a field of type `C`, or of a field name, is a Formula_Prefix_Character, THE DBase_Converter SHALL put a single quote `'` before the Cell_Text.
5. WHEN criteria 2 and 4 both apply to the same Cell_Text, THE DBase_Converter SHALL apply criterion 4 first and criterion 2 second, so that the `'` is inside the enclosing double quotes.
6. THE DBase_Converter SHALL write Cell_Text values for types `N`, `F`, `D` and `L` only in the forms listed in Requirement 7, so that these cells never start with a Formula_Prefix_Character other than the `-` of a negative number.
7. WHEN the conversion completes, THE DBase_Converter SHALL return the CSV_Text as a string of Unicode text, with the mime `text/csv` and the extension `.csv`.
8. IF the table has zero active records, THEN THE DBase_Converter SHALL return a CSV_Text that contains only the header row terminated by CRLF.
9. FOR ALL tables written by the Format_Test_Support dBase writer with field values that need no repair, parsing the CSV_Text with the Format_Test_Support CSV parser SHALL return a table whose header row equals the field names and whose rows equal the active records, with each cell equal to the Cell_Text rules of Requirement 7 and criterion 4 (round-trip property).
10. FOR ALL cell lists, writing a row with the CSV serializer and parsing it with the Format_Test_Support CSV parser SHALL return the original cells (serializer round-trip property).
11. FOR ALL byte arrays, THE number of rows in the CSV_Text, counted by a conforming parser, SHALL be at most 1 plus `MAX_DBF_RECORDS`.

### Requirement 9: PCX header validation

**User Story:** As an archivist, I want old PCX images read safely, so that a damaged or hostile image gives a clear message instead of a crash.

#### Acceptance Criteria

1. WHEN the PCX_Converter reads Input_Bytes that hold at least 128 bytes, THE PCX_Converter SHALL read from the PCX_Header the manufacturer byte (offset 0), the version (1), the encoding (2), the bits per pixel (3), the 16-bit little-endian values xmin, ymin, xmax and ymax (4 to 11), the 16-color palette (16 to 63), the number of planes (65) and the 16-bit little-endian bytes per line (66).
2. THE PCX_Converter SHALL accept an image only when all of these numbered conditions hold, where width is `xmax - xmin + 1` and height is `ymax - ymin + 1`:
   1. the Input_Bytes hold at least 128 bytes;
   2. the manufacturer byte is `0x0A`;
   3. the version is 0, 2, 3, 4 or 5;
   4. the encoding is 1;
   5. xmax is at least xmin and ymax is at least ymin;
   6. the width and the height are each from 1 to `MAX_IMAGE_DIMENSION`;
   7. the product of width and height is at most `MAX_IMAGE_PIXELS`;
   8. the combination of bits per pixel and number of planes is one of 1 and 1 (monochrome), 1 and 4 (16-color planar), 4 and 1 (16-color packed), 8 and 1 (256-color) or 8 and 3 (24-bit);
   9. bytes per line is at least `ceil(width * bitsPerPixel / 8)` and at most `MAX_PCX_BYTES_PER_LINE`;
   10. the product of number of planes, bytes per line and height is at most `MAX_PCX_DECODED_BYTES`.
3. IF the Input_Bytes hold fewer than 128 bytes, THEN THE PCX_Converter SHALL return a failure result with the error `PCX header too short` and the number of bytes received, and SHALL read no header field.
4. IF condition 5 holds and the width or height is greater than `MAX_IMAGE_DIMENSION`, or the pixel count is greater than `MAX_IMAGE_PIXELS`, THEN THE PCX_Converter SHALL return a failure result with the error `PCX image too large` and the width and height, and SHALL decode no pixel.
5. IF conditions 1 to 7 hold and the bits per pixel and number of planes form a combination that condition 8 does not list, THEN THE PCX_Converter SHALL return a failure result with the error `PCX format not supported` and the two numbers.
6. IF the header fails a condition of criterion 2 that criteria 3, 4 and 5 do not cover, THEN THE PCX_Converter SHALL return a failure result with the error `PCX header invalid` and the number of the first failed condition, counted from 1 in the order of criterion 2.
7. IF the header fails more than one condition of criterion 2, THEN THE PCX_Converter SHALL report only one error, chosen by the lowest failed condition number in criterion 2, and SHALL return no image data and no partial pixels.
8. THE PCX_Converter SHALL allocate no pixel buffer until conditions 1 to 10 have all passed.
9. THE PCX_Converter SHALL leave the DPI and screen-size header fields unused, because they do not change the pixels.

### Requirement 10: PCX pixel decoding

**User Story:** As an archivist, I want the pixels and colors of an old image decoded correctly, so that the PNG looks like the original.

#### Acceptance Criteria

1. WHEN the PCX_Converter decodes the RLE_Stream, THE PCX_Converter SHALL read a byte below `0xC0` as one literal data byte, and a byte of `0xC0` or more as a run of `byte & 0x3F` copies of the next byte.
2. WHEN the PCX_Converter decodes the RLE_Stream, THE PCX_Converter SHALL decode it as one continuous stream, so that a run may continue across a PCX_Scanline boundary, and SHALL produce exactly `height` PCX_Scanlines of `planeCount * bytesPerLine` bytes each and ignore any decoded bytes beyond them.
3. THE PCX_Converter SHALL stop decoding after `planeCount * bytesPerLine * height` decoded bytes, no matter how many bytes remain in the RLE_Stream, so that a run-length bomb cannot produce more than `MAX_PCX_DECODED_BYTES` bytes.
4. IF the RLE_Stream ends before all PCX_Scanlines are decoded, THEN THE PCX_Converter SHALL fill the missing bytes with zero, return the image with `ok: true`, and add one Conversion_Warning with code `pcx-data-truncated` that holds the number of complete rows read (an integer from 0 to `height - 1`).
5. IF a run byte of `0xC0` or more is the last byte of the RLE_Stream, THEN THE PCX_Converter SHALL discard the run and handle the stream as truncated under criterion 4.
6. WHEN the image has 1 bit per pixel and 1 plane, THE PCX_Converter SHALL map pixel value 0 to black `(0, 0, 0)` and pixel value 1 to white `(255, 255, 255)`, reading pixels from the most significant bit of each byte first.
7. WHEN the image has 1 bit per pixel and 4 planes, THE PCX_Converter SHALL build each pixel index (0 to 15) from bit k of each of the 4 planes, with plane 0 as the least significant bit and the most significant bit of each byte as the first pixel, and SHALL look the index up in the 16-color palette of the PCX_Header.
8. WHEN the image has 4 bits per pixel and 1 plane, THE PCX_Converter SHALL read two pixels per byte, high nibble first, and SHALL look each index (0 to 15) up in the 16-color palette of the PCX_Header.
9. WHEN the image has 8 bits per pixel and 1 plane, THE PCX_Converter SHALL read the 256-color palette from the last 769 bytes of the Input_Bytes if the first of those 769 bytes is `0x0C` and the RLE_Stream does not overlap them, and SHALL look each pixel byte (0 to 255) up in that palette.
10. IF the image has 8 bits per pixel and 1 plane and no valid 256-color palette is found, THEN THE PCX_Converter SHALL use a grayscale palette where index i maps to the color `(i, i, i)`, return the image with `ok: true`, and add one Conversion_Warning with code `pcx-palette-missing`.
11. WHEN the image has 8 bits per pixel and 3 planes, THE PCX_Converter SHALL read the red values from plane 0, the green values from plane 1 and the blue values from plane 2 of each PCX_Scanline.
12. IF the version is 3 and the image is a 16-color image (1 bit per pixel with 4 planes, or 4 bits per pixel with 1 plane), THEN THE PCX_Converter SHALL use the fixed 16-color EGA palette instead of the PCX_Header palette.
13. THE PCX_Converter SHALL set the alpha of every pixel to 255 and SHALL ignore the padding bytes of each plane after the first `ceil(width * bitsPerPixel / 8)` bytes.
14. WHEN the PCX_Converter has decoded the RGBA_Image, THE PCX_Converter SHALL encode it with the PNG_Encoder and return a Conversion_Result with `ok: true`, the PNG_File as output, the mime `image/png` and the extension `.png`.
15. IF the PCX_Header holds a combination of bits per pixel and planes other than 1/1, 1/4, 4/1, 8/1 and 8/3, THEN THE PCX_Converter SHALL return a Conversion_Result with `ok: false` and the error `PCX format not supported` (as in Requirement 9 criterion 5), and SHALL produce no PNG_File.
16. FOR ALL images written by the Format_Test_Support PCX encoder in each supported combination of bits per pixel and planes, with random palettes and sizes from 1x1 to 64x64, decoding the PCX bytes with the PCX_Converter and decoding the resulting PNG_File with the Format_Test_Support PNG decoder SHALL return the pixels of the source image (round-trip property).

### Requirement 11: PNG encoder

**User Story:** As a developer, I want a small PNG encoder with no dependencies, so that the converter runs unchanged in the browser, in Node and in the MCP server.

#### Acceptance Criteria

1. WHEN given an RGBA_Image that passes the validation of criterion 8, THE PNG_Encoder SHALL return a success result holding a PNG_File that starts with the 8-byte PNG signature (`89 50 4E 47 0D 0A 1A 0A`), followed by exactly one IHDR chunk, exactly one IDAT chunk and exactly one IEND chunk, in that order, with no other chunk and no bytes after the IEND chunk. The `MAX_PNG_BYTES` bound of Requirement 1 criterion 17 assumes this single IDAT chunk, so that the chunk overhead (4-byte length, 4-byte type and 4-byte CRC, 12 bytes) is counted three times: once each for IHDR, IDAT and IEND.
2. THE PNG_Encoder SHALL write the IHDR chunk with the image width and height as 4-byte big-endian values, a bit depth of 8, color type 6 (RGBA), compression method 0, filter method 0 and interlace method 0.
3. THE PNG_Encoder SHALL write each image row as a filter byte of 0 followed by `width * 4` pixel bytes in R, G, B, A order, with rows in top-to-bottom order.
4. THE PNG_Encoder SHALL compress the filtered rows as a zlib stream made only of stored (uncompressed) deflate blocks, with a 2-byte zlib header, blocks of at most `PNG_STORED_BLOCK_MAX` bytes, a final block marked as final, and a 4-byte big-endian Adler-32 checksum of the filtered data at the end.
5. THE PNG_Encoder SHALL write a 4-byte big-endian CRC-32 over the chunk type and the chunk data for every chunk, using the PNG CRC-32 polynomial `0xEDB88320`, and SHALL write a 4-byte big-endian length of the chunk data for every chunk.
6. THE PNG_Encoder SHALL implement CRC-32 and Adler-32 in `src/core/formats/` and SHALL use no compression library, no `CompressionStream` and no Node API.
7. THE CRC-32 function SHALL return `0xCBF43926` for the ASCII bytes `123456789`, and THE Adler-32 function SHALL return `0x11E60398` for the ASCII bytes `Wikipedia`.
8. IF the width or height is not an integer, is below 1 or is above `MAX_IMAGE_DIMENSION`, or the product of width and height is above `MAX_IMAGE_PIXELS`, or the `rgba` length is not `width * height * 4`, THEN THE PNG_Encoder SHALL return a failure result with the error `PNG input invalid`, SHALL NOT throw, SHALL leave the input `rgba` bytes unchanged and SHALL allocate no output buffer.
9. THE PNG_Encoder SHALL return a PNG_File of at most `MAX_PNG_BYTES` bytes for every accepted RGBA_Image.
10. THE PNG_Encoder SHALL compute the output size from the validated width and height before it allocates the output buffer, and SHALL allocate once.
11. THE PNG_Encoder SHALL return identical bytes for identical RGBA_Images, and SHALL NOT modify the input `rgba` bytes.
12. FOR ALL RGBA_Images with width and height from 1 to 64, decoding the PNG_File with the Format_Test_Support PNG decoder SHALL return an RGBA_Image equal to the source image (round-trip property).
13. FOR ALL RGBA_Images with width and height from 1 to 64, inflating the IDAT data with Node's `zlib.inflateSync` in a Format_Test_Support check SHALL return exactly the filtered rows of criterion 3, and the CRC-32 of every chunk SHALL equal the CRC-32 that Node's `zlib.crc32` computes (independent oracle property).
14. FOR ALL RGBA_Images whose filtered data is longer than `PNG_STORED_BLOCK_MAX` bytes, THE PNG_File SHALL hold more than one stored block, every block except the last SHALL have the final flag clear, and the last block SHALL have the final flag set (block-boundary property).
15. WHEN given a 1 by 1 RGBA_Image, THE PNG_Encoder SHALL return a PNG_File whose filtered data is exactly 5 bytes long (one filter byte of 0 and 4 pixel bytes) and which the Format_Test_Support PNG decoder decodes to the source image.
16. WHEN given an RGBA_Image with width equal to `MAX_IMAGE_DIMENSION` and height 1, or with width and height whose product equals `MAX_IMAGE_PIXELS`, THE PNG_Encoder SHALL return a success result with a PNG_File of at most `MAX_PNG_BYTES` bytes.
17. WHEN given an RGBA_Image of 1024 pixels wide and 4096 pixels tall, THE PNG_Encoder SHALL return a PNG_File of exactly `MAX_PNG_BYTES` bytes, and the independent recomputation test of Requirement 14 criterion 16 SHALL verify this.

### Requirement 12: Safety and purity

**User Story:** As a maintainer, I want the converters to hold the same safety rules as the FAT12 core, so that no hostile file can hang, crash or exhaust memory.

#### Acceptance Criteria

1. THE Format_Converters SHALL compile under the TypeScript `strict` setting with zero uses of the `any` type (including `as any` and `: any`) in `src/core/formats/`, excluding test files.
2. THE Format_Converters SHALL conform to the Core_Purity_Rule, with zero imports of Node built-in modules, browser DOM globals (`window`, `document`), third-party runtime packages and network functions (`fetch`, `XMLHttpRequest`, `WebSocket`) in `src/core/formats/`, excluding test files.
3. THE Format_Converters SHALL give every loop a hard iteration cap that is derived from the Input_Bytes length or from a Limit, and SHALL use no unbounded recursion.
4. THE Format_Converters SHALL apply no regular expression to text taken from Input_Bytes, and SHALL parse text with character-level state machines.
5. WHEN Input_Bytes of up to `MAX_CONVERT_INPUT_BYTES` bytes are converted, THE Format_Converters SHALL finish the conversion within `CONVERT_TIME_BUDGET_MS` milliseconds, including the largest accepted image (`MAX_IMAGE_PIXELS` pixels), with no exception.
6. THE Format_Converters SHALL execute, evaluate or load as code no byte of Input_Bytes, with zero uses of `eval`, `Function` constructors, dynamic `import()` or script-element creation on data derived from Input_Bytes.
7. THE Format_Converters SHALL write text output (Markdown_Text and CSV_Text) that contains zero NUL (`0x00`) bytes.
8. THE Format_Converters SHALL import code from `src/core/fat12/` only for the shared CP437 decoder, and SHALL NOT import from `src/test-support/`.
9. THE Format_Converters SHALL add zero entries to the `dependencies` section of `package.json`.
10. WHEN the project build runs, THE Format_Converters SHALL compile with zero type errors alongside `src/main.ts`.
11. IF Input_Bytes are hostile (truncated, self-referencing, or declaring sizes or counts above a Limit), THEN THE Format_Converters SHALL return a failure result or a result with warnings that names the violated Limit or defect, SHALL throw no uncaught exception, and SHALL leave the caller's Input_Bytes unmodified, where partial-output cases from Requirement 1 criterion 15 stay `ok: true` with a warning.
12. IF a conversion would allocate an output or intermediate buffer larger than the applicable Limit, THEN THE Format_Converters SHALL abort before allocating that buffer and SHALL return a result that follows Requirement 1 criterion 15.

### Requirement 13: Test support writers and parsers

**User Story:** As a developer, I want test-only writers and parsers, so that property tests can build valid files and later the demo disk generator can reuse them.

#### Acceptance Criteria

1. THE Format_Test_Support SHALL reside in `src/test-support/formats/` and SHALL NOT be imported by any file under `src/core/`.
2. WHEN the dBase writer receives a table description (field names of 1 to 10 characters, field types, field lengths of 1 to 254, decimal counts of 0 to 15, 0 to 65,535 records each with an active or deleted flag), THE Format_Test_Support dBase writer SHALL return the bytes of a dBase III file with a correct DBF_Header, a `0x0D` terminator after the field descriptors, fixed-width records, and a final `0x1A` byte.
3. WHEN the PCX encoder receives an indexed or true-color source image of 1 to 65,535 pixels in width and height, THE Format_Test_Support PCX encoder SHALL return the bytes of a PCX file with run-length encoding for each supported combination of bits per pixel and planes, and SHALL append a 769-byte palette trailer for 256-color images.
4. WHEN the WordStar fixture writer receives a list of 0 to 1,000 paragraphs with bold, underline and italic spans and soft-wrapped lines, THE Format_Test_Support WordStar fixture writer SHALL return WordStar bytes with the high bit set on the last character of each word, Soft_Returns, Hard_Returns and Style_Toggle bytes.
5. WHEN the CSV parser receives RFC 4180 text with quoted cells, doubled quotes and embedded line breaks, THE Format_Test_Support CSV parser SHALL return rows of strings in which each doubled quote is one quote character and each embedded line break is preserved inside its cell.
6. WHEN the PNG decoder receives a PNG_File made of stored deflate blocks with filter type 0 and color type 6, THE Format_Test_Support PNG decoder SHALL return the decoded pixel data and SHALL return the Adler-32 and CRC-32 values it reads from the file without recomputing them.
7. THE Format_Test_Support SHALL read no clock value and no random value, and SHALL return byte-for-byte identical output for identical descriptions.
8. THE Format_Test_Support modules that the later demo disk generator may call SHALL import no Vitest and no fast-check module, so that `scripts/make-demo-disks.ts` can reuse them unchanged.
9. WHEN the WordStar_Converter converts bytes produced by the Format_Test_Support WordStar fixture writer, THE WordStar_Converter SHALL return the paragraph text of the source paragraphs with the expected `**` and `*` markers (writer and converter agreement example).
10. IF a writer or encoder receives a description outside the bounds stated in criteria 2, 3 or 4, THEN THE Format_Test_Support SHALL throw an error identifying the offending field and SHALL return no bytes.
11. IF the PNG decoder or CSV parser receives input that does not match its supported subset (a compressed deflate block, a filter type other than 0, a color type other than 6, or an unterminated quoted cell), THEN THE Format_Test_Support SHALL throw an error identifying the unsupported feature and SHALL return no partial result.

### Requirement 14: Property-based and example tests

**User Story:** As a maintainer, I want automated tests, so that regressions and hostile-input failures are caught before release.

#### Acceptance Criteria

1. THE test suite SHALL use Vitest and fast-check, SHALL place tests in `src/**/*.test.ts`, and SHALL use `numRuns()` from `src/test-support/runs.ts` for every property run count.
2. THE test suite SHALL NOT call `expect(...)` inside any fast-check property callback, and every property callback SHALL return either nothing or a boolean.
3. THE test suite SHALL include a hostile-input property for each of `detectFormat`, `convertWordStar`, `convertDBase`, `convertPcx` and `convertAuto` that generates random byte arrays of 0 to 2,097,152 bytes (inclusive, with the empty array included in the generated range) and checks that each call returns a result without throwing.
4. THE test suite SHALL include, for each of `convertWordStar`, `convertDBase` and `convertPcx`, a mutation property that takes a valid file from the Format_Test_Support and applies exactly one of two mutations per run: changing 1 to 64 bytes at random positions to random values, or truncating the file to a random length from 0 to the original length minus 1; and checks that the converter returns a result without throwing.
5. THE test suite SHALL include these targeted cases, each checked for no thrown error, and, except for the two valid-image cases (a) and (b) in the last three bullets, each checked for a result with at least one warning or a failure result:
   - a PCX header with a width and height of 65,535;
   - a PCX with bytes per line of 65,535;
   - a 4 MB (4,194,304 bytes) PCX RLE_Stream made only of maximum-length runs;
   - a PCX with the 769-byte palette trailer overlapping the pixel data;
   - a dBase header with a record count of 4,294,967,295;
   - a dBase header with a record length of 65,535 and a header length of 65,535;
   - a dBase file with 255 field descriptors and no terminator;
   - a dBase file with field names and `C` values that start with `=`, `+`, `-` and `@`, where the check additionally requires that no CSV_Text cell begins with any of those four characters unescaped, in the manner Requirement 8 criterion 4 defines;
   - a WordStar file of 4 MB (4,194,304 bytes) made only of Style_Toggle bytes;
   - a WordStar file with 100,000 Dot_Command lines;
   - (a) a valid 24-bit PCX of 2048 by 2048 and (b) a valid 24-bit PCX of 4096 by 1024 (the largest accepted images), each built with content that RLE-encodes to at most `MAX_CONVERT_INPUT_BYTES` bytes, so that no `input-truncated` warning applies. Each SHALL convert with `ok: true` and with no warning, within `CONVERT_TIME_BUDGET_MS`, to a PNG_File of at most `MAX_PNG_BYTES` bytes. These two cases are allowed to succeed with no warnings. The 4096-wide case needs 4,096 bytes per line, which equals `MAX_PCX_BYTES_PER_LINE`, and its decoded size of 12,582,912 bytes is below `MAX_PCX_DECODED_BYTES`;
   - (c) a PCX of 2049 by 2048 (one row over `MAX_IMAGE_PIXELS` pixels) and a PCX 4097 pixels wide, each rejected with the error `PCX image too large` and with no pixel decoded.
6. THE test suite SHALL check with `timed()` from `src/test-support/timed.ts`, around the converter call only, that every hostile-input case in criteria 3 and 5 completes within `CONVERT_TIME_BUDGET_MS`.
7. THE test suite SHALL check, for every converter result produced by the tests in criteria 3, 4 and 5, that the output respects its cap: Markdown_Text at most `MAX_MARKDOWN_OUTPUT_BYTES`, CSV_Text at most `MAX_CSV_OUTPUT_BYTES`, PNG_File at most `MAX_PNG_BYTES`, and a PNG image never wider or taller than `MAX_IMAGE_DIMENSION`, with sizes measured in bytes of the encoded output.
8. THE test suite SHALL check, for every Conversion_Result produced by the tests in criteria 3, 4 and 5, that the number of `warnings` is at most `MAX_WARNINGS + 1`, and that no `message` or `error` contains any character from the Input_Bytes other than the digits 0 to 9.
9. THE test suite SHALL include the pass-through property of Requirement 3 criterion 12, the balance property (Requirement 4 criterion 10) and the no-HTML property (Requirement 4 criterion 11), the CSV round-trip properties of Requirement 8 criteria 9 and 10, the PCX round-trip of Requirement 10 criterion 16, and the PNG round-trip and oracle properties of Requirement 11 criteria 12 and 13.
10. THE test suite SHALL include example tests for the CRC-32 and Adler-32 values in Requirement 11 criterion 7, for each supported PCX combination, for each dBase field type including a negative number, a date, a logical value and a memo field, for Soft_Return versus Hard_Return handling, and for the format detector on one valid sample of each format.
11. THE test suite SHALL include a smoke test that fails IF any file under `src/core/formats/` imports a Node built-in module, references `document` or `window`, calls `fetch`, contains a regular expression literal or a `RegExp` construction, or repeats a Limit value from `limits.ts` as a literal.
12. THE test suite SHALL include a check that `MAX_CONVERT_INPUT_BYTES` equals `MAX_FILE_OUTPUT_BYTES` from the FAT12 core, so that every file the FAT12 core returns fits a converter without truncation.
13. WHEN the hostile-input properties run via the `test:fuzz` script, THE test suite SHALL use at least 10 times the default run count, and SHALL name those test files `*.hostile.test.ts` so that the existing script selects them.
14. THE test suite SHALL exclude the `exhumed/` folder from every glob it uses.
15. IF a property run fails, THEN THE test suite SHALL report the fast-check seed and the shrunk counterexample so that the failing run can be reproduced with the same seed.
16. THE test suite SHALL include a test that recomputes `MAX_PNG_BYTES` from first principles, using a pixel cap of 4,194,304, a dimension cap of 4,096, a stored block size of 65,535, and the overhead constants (8, 12, 13, 5 and 6) written out as literals in the test file and not imported from `limits.ts`, and SHALL assert that the result equals the exported `MAX_PNG_BYTES` (which is 16,782,660). The same test SHALL encode a 1024 by 4096 RGBA_Image and assert that the PNG_File length equals `MAX_PNG_BYTES` exactly, and SHALL encode a 4096 by 1024 and a 2048 by 2048 RGBA_Image and assert that each PNG_File length is at most `MAX_PNG_BYTES`.
