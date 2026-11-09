# Requirements Document

## Introduction

Exhume was tested on 35 real DOS disks instead of our own generated ones: 24 FreeDOS 1.3 floppy images and 11 disks from the PCjs archive (dBASE II/III sample disks, WordStar 3.20, PC-SIG shareware disks from 1983 to 1993; 160 KB to 1.44 MB). Each real disk was checked against one independent reference: the FreeDOS files against the macOS msdos driver (read-only mount), and the PCjs files against the per-file MD5 table that PCjs publishes with each disk. All 942 files matched an independent reference byte for byte. 63 of the 63 PCX images that Pillow could open matched pixel for pixel; Pillow refused the other 25, which Exhume renders. 39 of 39 dBase III tables matched `dbfread` (dates and logicals compared after normalising Exhume's ISO date and TRUE/FALSE output). Four bugs still make real disks look broken. This spec fixes them, keeps real disks as regression tests, and records the result in the README.

The four bugs are:

1. The WordStar detection rule `isWordStar` in `src/core/formats/detect.ts` runs before the extension rule and fires on binaries. It fires on 147 files across the 24 FreeDOS disks and on about 45 files across the PCjs disks, and on 39 files of the three committed fixtures. Programs, drivers, fonts, dBase indexes, dBase II tables and split archives "rise" as garbage Markdown.
2. DOS 1.x/2.x `FORMAT` fills unused directory slots with `0xE5` followed by 31 bytes of `0xF6`, and some tools use `0xE5` followed by 31 zero bytes. The reader treats each slot as a deleted file. This produced 641 phantom graves on 9 of the 11 PCjs disks, each with a `date-invalid` warning.
3. DOS 1.x files have date and time words of zero. Each one gives a `date-invalid` warning.
4. The WordStar converter turns a soft hyphen at a soft line break into a space and keeps double spaces from soft spaces.

A fifth item, restoring long names of deleted files, is optional and is marked as such.

A disk image is untrusted input, so all new code obeys `safety.md`: bounded loops, linear-time patterns and no exceptions on hostile bytes. The three FreeDOS fixtures are third-party, GPL or otherwise licensed files. They are read-only test input and are never modified, regenerated or offered by the web page.

Out of scope: new formats (dBase II, WordPerfect, Lotus), `.IMD` and `.TD0` containers, UI changes beyond what the fixes need, the Crew app and deployment.

## Glossary

- **Format_Detector**: The `detectFormat` function and its helpers in `src/core/formats/detect.ts`, including `isWordStar`.
- **WordStar_Rule**: The content-based rule `isWordStar` in the Format_Detector that decides whether a file is a WordStar document.
- **WordStar_Converter**: The module in `src/core/formats/` that converts a WordStar document to Markdown.
- **FAT12_Reader**: The function and modules in `src/core/fat12/` that turn a `Uint8Array` disk image into a `DiskReport`.
- **DiskReport**: The result object `{ volume, files: Grave[], warnings[] }`.
- **Grave**: One directory entry in the DiskReport, with fields `path`, `size`, `date`, `state`, `kind` and optional `reason`.
- **Warning**: A structured entry in the DiskReport `warnings` array, with a machine-readable code, a message and the affected path when one exists.
- **Directory_Slot**: A 32-byte Directory_Entry position in the root directory or a subdirectory.
- **Never_Used_Slot**: A Directory_Slot whose first byte is `0xE5` and whose other 31 bytes are all `0xF6` or all `0x00`.
- **Deleted_Entry**: A Directory_Slot whose first byte is `0xE5` and that is not a Never_Used_Slot.
- **Zero_Date_Time**: A Directory_Entry whose date word and time word are both zero.
- **Soft_Return**: The byte pair `0x8D 0x0A` in a WordStar document.
- **Soft_Hyphen**: The byte `0x1F` in a WordStar document.
- **Soft_Space**: The byte `0xA0` in a WordStar document, which is a space with the high bit set.
- **Known_Binary_Extension**: A file name extension, compared without regard to case, that belongs to this closed list: `COM`, `EXE`, `SYS`, `OVR`, `BIN`, `DLL`, `DRV`, `BGI`, `CHR`, `FON`, `CPI`, `NDX`, `NTX`, `MDX`, `DBF`, `ZIP`, `ARC`, `LZH`, or an extension made only of digits such as `.001`. A file with a Known_Binary_Extension is never a WordStar document by content.
- **Disk_Image**: A `Uint8Array` holding the bytes of a floppy disk image, treated as untrusted input.
- **Directory_Entry**: The 32 bytes of one Directory_Slot that describe a file, a subdirectory, a volume label or a VFAT long-name part.
- **File_Tree**: A test-only description of files and directories, with names, sizes and bytes, that the Image_Writer turns into a Disk_Image.
- **Fixture_Disks**: The three unmodified FreeDOS 1.3 images `fd13-720k-dsk01.img`, `fd13-1200k-dsk01.img` and `fd13-1440k-boot.img` in `fixtures/real-disks/freedos13/`.
- **Manifest**: The file `fixtures/real-disks/freedos13/manifest.json`. Its file lists come from a macOS read-only mount and not from Exhume.
- **Notice_File**: The file `fixtures/real-disks/freedos13/NOTICE.md`.
- **Image_Writer**: The existing test-only module that builds a FAT12 disk image from a description of files and directories.
- **Fixture_Writer**: The existing test-only code that produces WordStar documents for tests.
- **Demo_Disks**: The images in `public/disks/` produced by `scripts/make-demo-disks.ts`.
- **Demo_Check**: The command `npm run make:demos -- --check`, which compares the generated demo disks with the committed ones.
- **Realdisks_Test**: The test file under `src/core/**/realdisks.test.ts` that grades the FAT12_Reader and the Format_Detector against the Fixture_Disks and the Manifest.
- **Extra_Corpus_Test**: The local-only test that reads every `.img` file in the folder named by the environment variable `EXHUME_EXTRA_DISKS`.
- **Case_Folded_Path**: A path in which ASCII letters `A` to `Z` are mapped to `a` to `z` and every other character is unchanged.
- **README**: The file `README.md` at the repository root.
- **Safety_Rules**: The rules in `.kiro/steering/safety.md` and `.kiro/steering/tech.md`.

## Requirements

### Requirement 1: No WordStar detections on binaries

**User Story:** As a user opening a real DOS floppy, I want programs, drivers and data files shown as hex instead of garbage Markdown, so that only real WordStar documents rise as text.

#### Acceptance Criteria

1. WHEN the Format_Detector is run on every alive file of every Fixture_Disk, THE Format_Detector SHALL report zero files as `wordstar`.
2. WHEN a file begins with the bytes `MZ`, THE WordStar_Rule SHALL reject the file as WordStar.
3. WHEN the sampled bytes of a file contain NUL bytes or non-text bytes at a density above a threshold defined in the design, THE WordStar_Rule SHALL reject the file as WordStar.
4. THE WordStar_Rule SHALL decide on the text-like ratio of the sampled bytes after clearing the high bit of each byte.
5. WHEN a file name has a Known_Binary_Extension, THE Format_Detector SHALL report the file as not WordStar, whatever its content.
6. WHEN a file is rejected by the WordStar_Rule and no other format rule matches, THE Format_Detector SHALL report the format `unknown`, so that the consumer offers the hex view.
7. THE WordStar_Rule SHALL accept a file as WordStar when the sampled bytes are mostly 7-bit text and show WordStar traits, such as the high bit set on word-final letters, Soft_Return pairs, Soft_Space bytes, Soft_Hyphen bytes, dot-command lines and style toggle control codes.
8. THE WordStar_Rule SHALL examine the sampled bytes of a file in one pass whose iteration count does not exceed the sample length.
9. THE WordStar_Rule SHALL use no regular expression, or only a linear-time regular expression on an input of at most the existing detection sample length.
10. WHEN any `Uint8Array` is passed to the Format_Detector, THE Format_Detector SHALL return a result and SHALL NOT throw an exception.
11. WHEN a file has the extension `.TXT`, the extension `.DOC` or no extension, and its sampled bytes show WordStar traits under criterion 7, THE Format_Detector SHALL report the file as `wordstar`, so that `EXAMPLE.TXT` on the WordStar 3.20 master disk is detected as a WordStar document.
12. WHEN a file has the extension `.DBF`, THE WordStar_Rule SHALL reject the file as WordStar, whether the table is dBase II or dBase III.
13. WHEN a file has the extension `.DBF` and holds a dBase III table, THE Format_Detector SHALL report the same non-WordStar format as before this spec, so that the existing dBase III to CSV conversion path is unchanged and only the WordStar content rule is vetoed.

### Requirement 2: Existing WordStar output is unchanged

**User Story:** As a maintainer, I want the new detection rule to leave known-good documents untouched, so that the demo disks and existing tests keep working.

#### Acceptance Criteria

1. WHEN a WordStar document produced by the Fixture_Writer is passed to the Format_Detector, THE Format_Detector SHALL report the format `wordstar`, exactly as before this spec.
2. WHEN a WordStar document on a Demo_Disk is passed to the Format_Detector, THE Format_Detector SHALL report the format `wordstar`, exactly as before this spec.
3. WHEN the Demo_Check is run after the changes in this spec, THE Demo_Check SHALL report that every generated demo disk is byte-identical to the committed demo disk.
4. THE existing tests in `src/**/*.test.ts` SHALL pass without edits to their expected values, except for the expected values that Requirement 1, Requirement 3, Requirement 4 and Requirement 5 explicitly change.
5. THE WordStar_Converter SHALL produce for each WordStar document from the Fixture_Writer and from the Demo_Disks the same Markdown as before this spec, except for the differences caused by Requirement 5.

### Requirement 3: Never-used directory slots are not graves

**User Story:** As a user opening a DOS 1.x or 2.x disk, I want empty directory slots ignored, so that the graveyard lists only files that really existed.

#### Acceptance Criteria

1. WHEN the FAT12_Reader meets a Never_Used_Slot in the root directory or in a subdirectory, THE FAT12_Reader SHALL add no Grave for that slot.
2. WHEN the FAT12_Reader meets a Never_Used_Slot, THE FAT12_Reader SHALL add no Warning for that slot, including no `date-invalid` Warning.
3. WHEN a Directory_Slot begins with `0xE5` and is not a Never_Used_Slot, THE FAT12_Reader SHALL report that slot as a Deleted_Entry Grave, as before this spec, for example a slot whose other 31 bytes mix `0xF6` and `0x00`.
4. THE FAT12_Reader SHALL decide whether a slot is a Never_Used_Slot with one pass over at most 31 bytes of that slot.
5. WHEN a Never_Used_Slot is met, THE FAT12_Reader SHALL continue reading the remaining slots of the same directory, so that Directory_Entries after a Never_Used_Slot are still reported.
6. THE Image_Writer SHALL be able to place a Never_Used_Slot with the `0xF6` fill and a Never_Used_Slot with the `0x00` fill at a chosen position in the root directory and in a subdirectory.
7. FOR ALL generated File_Trees that contain Never_Used_Slots of either fill at any positions in the root directory or in a subdirectory, THE FAT12_Reader SHALL return a DiskReport with no Grave and no Warning that originates from a Never_Used_Slot, and with the other Graves equal to those of the same File_Tree without those slots (property test).
8. THE hostile-input properties of the FAT12_Reader SHALL continue to pass, so that random bytes, cyclic chains and out-of-range clusters still give a DiskReport without a thrown exception, a hang or unbounded allocation.
9. THE test images for both fill patterns SHALL be built with the Image_Writer, and THE repository SHALL contain no bytes copied from PCjs disks.

### Requirement 4: Zero dates are null without warning

**User Story:** As a user opening a DOS 1.x disk, I want files without a date shown as undated, so that I am not flooded with warnings about a normal condition.

#### Acceptance Criteria

1. WHEN a Directory_Entry is a Zero_Date_Time, THE FAT12_Reader SHALL set the `date` of its Grave to `null`.
2. WHEN a Directory_Entry is a Zero_Date_Time, THE FAT12_Reader SHALL add no `date-invalid` Warning and no other Warning for the date.
3. WHEN a Directory_Entry has a date word or a time word that is non-zero and decodes to an invalid calendar date or time of day, THE FAT12_Reader SHALL add a `date-invalid` Warning naming the affected path, as before this spec.
4. WHEN a Directory_Entry has a date word of zero and a time word that is non-zero, or a date word that is non-zero and a time word of zero, THE FAT12_Reader SHALL apply the existing validity rules to the pair, so that only the pair of two zero words is exempt.
5. FOR ALL pairs of 16-bit date and time words, THE FAT12_Reader SHALL satisfy all of the following (property test):
   - (a) WHEN both words are zero, THE FAT12_Reader SHALL give `date: null` and no Warning.
   - (b) WHEN the pair is not both zero and the existing rules decode it to a valid date, THE FAT12_Reader SHALL give the same date string as before this spec and no Warning.
   - (c) WHEN the pair is not both zero and the existing rules do not decode it to a valid date, THE FAT12_Reader SHALL give exactly the result of before this spec, which is a `date-invalid` Warning and the existing date value.

### Requirement 5: Soft hyphens and soft spaces in WordStar output

**User Story:** As a user reading a converted WordStar document, I want words broken by the line layout joined again and justification padding removed, so that the Markdown reads like the original text.

#### Acceptance Criteria

1. WHEN a Soft_Hyphen is immediately followed by a Soft_Return in a WordStar document, THE WordStar_Converter SHALL join the text before the Soft_Hyphen and the text after the Soft_Return without any character between them, so that the input `cor` `0x1F` `0x8D 0x0A` `rected` produces `corrected`.
2. WHEN a Soft_Hyphen is not followed by a Soft_Return, THE WordStar_Converter SHALL drop the Soft_Hyphen and emit no character for it.
3. WHEN a Soft_Space is adjacent to an ordinary space inside a paragraph, THE WordStar_Converter SHALL emit no character for the Soft_Space, so that justification padding does not produce double spaces.
4. THE WordStar_Converter SHALL examine the document with loops whose iteration count does not exceed the document length.
5. WHEN any `Uint8Array` is passed to the WordStar_Converter, THE WordStar_Converter SHALL return a result and SHALL NOT throw an exception.
6. THE WordStar_Converter SHALL keep the existing handling of Soft_Return, hard returns, dot commands and style toggles for documents that contain no Soft_Hyphen and no adjacent Soft_Space, so that their Markdown is unchanged.

### Requirement 6: Real-disk regression test on the fixtures

**User Story:** As a maintainer, I want the three real FreeDOS images graded against an independent oracle, so that Exhume is not graded against itself and real-disk regressions are caught.

#### Acceptance Criteria

1. THE Realdisks_Test SHALL run once for each Fixture_Disk listed in the Manifest, and SHALL read each image from `fixtures/real-disks/freedos13/`.
2. WHEN the Realdisks_Test loads a Fixture_Disk, THE Realdisks_Test SHALL compute the SHA-256 of the image bytes and require that it equals the `sha256` of the matching Manifest entry before reading the image.
3. WHEN the FAT12_Reader has read a Fixture_Disk, THE Realdisks_Test SHALL require that every file listed in the Manifest is present in the DiskReport as a Grave of kind `file` with state `alive`, with the same size as in the Manifest.
4. WHEN a Manifest file is present, THE Realdisks_Test SHALL require that the SHA-256 of the bytes returned by `readGraveBytes` for that Grave equals the Manifest `sha256` of that file.
5. THE Realdisks_Test SHALL require that the DiskReport contains no alive file that the Manifest does not list.
6. THE Realdisks_Test SHALL require that the directories in the DiskReport equal the directories listed in the Manifest for that image.
7. THE Realdisks_Test SHALL require that the DiskReport of each Fixture_Disk contains zero Warnings.
8. THE Realdisks_Test SHALL require that the Format_Detector reports zero files as `wordstar` on every alive file of each Fixture_Disk.
9. THE Realdisks_Test SHALL require that the Deleted_Entry Graves in the DiskReport equal the `deletedEntries` of the Manifest for that image, with no other Deleted_Entry present.
10. THE Realdisks_Test SHALL compare paths as Case_Folded_Paths, because the macOS mount reports VFAT long names in lower case.
11. THE Realdisks_Test SHALL take its expected results only from the Manifest and SHALL NOT regenerate, edit or overwrite the Manifest, the Notice_File or any Fixture_Disk.
12. THE Realdisks_Test SHALL NOT use the network, SHALL NOT use secrets and SHALL NOT write any file.
13. THE Realdisks_Test SHALL run under `npm test` together with the other tests.

### Requirement 7: Fixture handling and licensing

**User Story:** As a maintainer, I want third-party floppy images kept clearly separate from our own demo disks, so that licensing is respected and the page never offers them.

#### Acceptance Criteria

1. THE repository SHALL contain the three Fixture_Disks and the Manifest committed with this spec, byte-identical to the copies in the working tree at the start of this spec.
2. THE repository SHALL keep the Notice_File in the same directory as the Fixture_Disks.
3. THE repository SHALL contain no Fixture_Disk, and no copy of one, under `public/`.
4. THE web page SHALL NOT list or offer any Fixture_Disk as a demo disk.
5. THE repository SHALL contain no bytes copied from PCjs disks.
6. THE implementation of this spec SHALL NOT edit, rename, reformat or regenerate any file in `fixtures/real-disks/freedos13/`.

### Requirement 8: Optional local corpus test

**User Story:** As a maintainer, I want to run Exhume over my own folder of real disks and see counts, so that I can spot regressions on disks that cannot be committed.

#### Acceptance Criteria

1. WHERE the environment variable `EXHUME_EXTRA_DISKS` names a folder, THE Extra_Corpus_Test SHALL read each `.img` file in that folder with the FAT12_Reader and the Format_Detector.
2. WHERE the environment variable `EXHUME_EXTRA_DISKS` names a folder, THE Extra_Corpus_Test SHALL print for each image, and in total, the number of files, the number of graves, the number of Warnings and the number of detections by format.
3. WHILE the environment variable `EXHUME_EXTRA_DISKS` is unset, THE Extra_Corpus_Test SHALL be skipped.
4. THE Extra_Corpus_Test SHALL NOT fail because of the content of an image, including the number of Warnings or the formats detected.
5. IF a file in the folder cannot be read or is larger than 2,949,120 bytes, THEN THE Extra_Corpus_Test SHALL print a note for that file and continue with the next file.
6. THE Extra_Corpus_Test SHALL NOT write, copy or commit any file from the folder, and THE repository SHALL contain nothing taken from that folder.
7. THE Extra_Corpus_Test SHALL NOT use the network.

### Requirement 9: README paragraph "Tested on real disks"

**User Story:** As a judge or visitor reading the README, I want to see that Exhume was checked on real disks with independent readers, so that I can trust it on my own floppies.

#### Acceptance Criteria

1. THE README SHALL contain one short paragraph titled or introduced as "Tested on real disks".
2. THE paragraph SHALL state that 35 real disks were tested: 24 FreeDOS 1.3 floppy images and 11 disks from the PCjs archive.
3. THE paragraph SHALL name FreeDOS and PCjs as the sources of the disks, and SHALL state that the FreeDOS files were checked against the macOS msdos driver (read-only mount) and the PCjs files against the per-file MD5 table that PCjs publishes with each disk.
4. THE paragraph SHALL state that all 942 files matched an independent reference byte for byte.
5. THE paragraph SHALL state that 63 of the 63 PCX images that Pillow could open matched pixel for pixel, and that Pillow refused the other 25, which Exhume renders.
6. THE paragraph SHALL state that 39 of 39 dBase III tables matched `dbfread`, with dates and logicals compared after normalising Exhume's ISO date and TRUE/FALSE output.
7. THE README SHALL keep its existing demo disks text unchanged.
8. THE README SHALL keep the honesty rules of `product.md`, and THE paragraph SHALL NOT claim that PCjs or FreeDOS files are part of Exhume or are offered by the web page.

### Requirement 10: Optional long names for deleted files

**User Story:** As a user, I want a deleted file to show its real long name when the disk still holds it, so that I can recognise the file, such as `freedos.012` instead of `_REEDOS.012`.

This requirement is OPTIONAL. It is implemented only if it is cheap. If it is skipped, all other requirements still hold and the Realdisks_Test accepts the underscore form.

#### Acceptance Criteria

1. WHERE this optional requirement is implemented, WHEN a Deleted_Entry with an 8.3 name is preceded by deleted VFAT long-name entries whose checksum matches the 8.3 name, THE FAT12_Reader SHALL use the long name as the path of that Grave, which restores the lost first character.
2. WHERE this optional requirement is implemented, IF the checksum of the preceding deleted long-name entries does not match the 8.3 name, THEN THE FAT12_Reader SHALL keep the underscore form of the 8.3 name as the path of that Grave.
3. WHERE this optional requirement is implemented, THE FAT12_Reader SHALL assemble the long name with loops capped by the number of slots in the directory and SHALL NOT throw an exception on any long-name bytes.
4. WHERE this optional requirement is implemented, THE FAT12_Reader SHALL sanitise the assembled long name as it sanitises other names read from a Disk_Image.
5. THE Realdisks_Test SHALL accept either the underscore form or the long name for the deleted entries `freedos.012` and `freedos.020`, whose Manifest paths are `/_REEDOS.012` and `/_REEDOS.020`, each with size 0.
6. WHEN this optional requirement is not implemented, THE FAT12_Reader SHALL report those deleted entries in the underscore form, as before this spec.

### Requirement 11: Safety and purity are preserved

**User Story:** As a maintainer, I want the hardening to respect the project's safety rules, so that fixing real disks does not open new holes.

#### Acceptance Criteria

1. THE changes in `src/core/` SHALL add no runtime dependency, and SHALL use no DOM, Node API, network or I/O.
2. THE new and changed core code SHALL bound every loop with a hard iteration cap and SHALL use no recursion without a depth counter.
3. THE new and changed core code SHALL NOT run a regular expression over an untrusted file without a length cap, and SHALL use linear-time patterns only.
4. WHEN a limit from Safety_Rules is exceeded while reading one item, THE FAT12_Reader SHALL stop that item, add a Warning and continue with the rest, as before this spec.
5. AMONG the tests added by this spec, THE Realdisks_Test and THE Extra_Corpus_Test SHALL be the only tests that read files, and THE Realdisks_Test SHALL read only from `fixtures/real-disks/freedos13/`.
6. THE `exhumed/` folder SHALL remain excluded from every hook glob and test glob.
7. THE changes of this spec SHALL make no change to the web page, the MCP server tool contracts or the CSP, except for those that follow from Requirement 1, Requirement 3, Requirement 4 and Requirement 5.
