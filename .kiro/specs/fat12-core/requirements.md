# Requirements Document

## Introduction

The FAT12 core reads a FAT12 floppy disk image, supplied as a `Uint8Array`, and produces a `DiskReport` that lists every file and directory entry, including deleted entries graded for recoverability. It lives in `src/core/fat12/` and is the foundation for the Exhume web page, MCP server and Crew app.

A disk image is untrusted input. Every name, size, date and cluster number in it is attacker-controlled. The reader therefore enforces the bounds from `safety.md` and reports problems as warnings. A problem with one item stops that item only. The rest of the disk is still read.

Out of scope: format converters (WordStar, dBase, PCX), the web UI, the MCP server and the demo disk generator script.

## Glossary

- **FAT12_Reader**: The function and modules in `src/core/fat12/` that turn a `Uint8Array` disk image into a `DiskReport`.
- **Disk_Image**: A `Uint8Array` holding the raw bytes of a floppy disk.
- **DiskReport**: The result object `{ volume, files: Grave[], warnings[] }`.
- **Volume**: The `volume` field of the DiskReport. It holds the volume label, the geometry in use and the geometry source.
- **Grave**: One directory entry in the DiskReport, with fields `path`, `size`, `date`, `state`, `kind` and optional `reason`.
- **State**: The Grave `state` value: `alive`, `recovered`, `partial` or `lost`.
- **Kind**: The Grave `kind` value: `file` or `directory`.
- **Warning**: A structured entry in the DiskReport `warnings` array, with a machine-readable code, a human-readable message and the affected path when one exists.
- **BPB**: The BIOS Parameter Block in the boot sector.
- **Geometry**: The set of bytes per sector, sectors per cluster, reserved sectors, FAT count, root entry count, total sectors and sectors per FAT used to read the image.
- **Fallback_Geometry**: A standard DOS geometry for one of the sizes 160 KB, 180 KB, 320 KB, 360 KB, 720 KB, 1.2 MB, 1.44 MB and 2.88 MB, chosen from the Disk_Image length when the BPB fails validation.
- **FAT**: The File Allocation Table, decoded as 12-bit entries.
- **Cluster_Chain**: The ordered list of clusters reached by following FAT entries from a start cluster.
- **Directory_Entry**: A 32-byte record in the root directory or a subdirectory.
- **Deleted_Entry**: A Directory_Entry whose first name byte is `0xE5`.
- **Placeholder_Character**: The character `_` that the FAT12_Reader puts in place of the lost first character of a deleted name.
- **Contiguous_Unallocated_Run**: A run of consecutive clusters starting at the start cluster of a Deleted_Entry, long enough for the declared size, where every cluster is marked free in the FAT.
- **Limits**: The numeric bounds from `safety.md`. See Requirement 2 and the other requirements that cite them.
- **Image_Writer**: A test-only module that builds a FAT12 Disk_Image from a description of files and directories.
- **File_Tree**: A description of files, directories, names, contents, dates and attributes that the Image_Writer accepts.
- **Core_Purity_Rule**: The constraint that `src/core/` has zero runtime dependencies and uses no DOM, Node API, network or I/O.

## Requirements

### Requirement 1: Report shape

**User Story:** As a developer of the web page, MCP server or Crew app, I want one stable report shape, so that all three consumers read disks the same way.

#### Acceptance Criteria

1. WHEN a Disk_Image is passed to the FAT12_Reader, THE FAT12_Reader SHALL return a DiskReport containing exactly three top-level members: a `volume` object, a `files` array of Grave objects (one Grave per reported entry, in directory traversal order) and a `warnings` array (empty when no warnings apply).
2. THE FAT12_Reader SHALL set the `path` of each Grave to an absolute path that starts with `/`, uses `/` as the separator, and has no trailing `/` except for the root path `/`.
3. THE FAT12_Reader SHALL set the `size` of each Grave of kind `file` to the declared size in bytes from the Directory_Entry, as an integer from 0 to 4,294,967,295.
4. THE FAT12_Reader SHALL set the `state` of each Grave to exactly one of `alive`, `recovered`, `partial` or `lost`.
5. THE FAT12_Reader SHALL set the `kind` of each Grave to exactly one of `file` or `directory`.
6. WHEN a Grave has a `state` of `recovered`, `partial` or `lost`, THE FAT12_Reader SHALL set a `reason` on that Grave that is a string of 1 to 200 characters.
7. WHEN a caller requests the bytes of a Grave of kind `file`, THE FAT12_Reader SHALL return a success result holding a `Uint8Array` of the recoverable bytes, with a length no greater than the Grave's `size`.
8. IF a caller requests the bytes of a Grave of kind `directory` or of a Grave that does not exist in the Disk_Image, THEN THE FAT12_Reader SHALL return a failure result `{ ok: false, error }` without throwing, and SHALL leave the Disk_Image and DiskReport unchanged.
9. THE FAT12_Reader SHALL return the DiskReport as plain data containing only strings, numbers, booleans, null, arrays and plain objects, such that `JSON.parse(JSON.stringify(report))` is deeply equal to the original report.

### Requirement 2: Safe handling of untrusted input

**User Story:** As a user opening a disk image from a stranger, I want the reader to survive any bytes, so that a hostile or damaged disk never crashes or hangs the tool.

#### Acceptance Criteria

1. WHEN any `Uint8Array` with a length from 0 to 2,949,120 bytes is passed to the report-building function, THE FAT12_Reader SHALL return a DiskReport and SHALL NOT throw an exception, so that consumers need no try/catch for hostile data.
2. WHEN the Disk_Image length is greater than 2,949,120 bytes (2.88 MB), THE FAT12_Reader SHALL return a DiskReport with an empty `files` array and a Warning with code `image-too-large`, without parsing any byte of the Disk_Image.
3. WHEN the Disk_Image length is 0 bytes, THE FAT12_Reader SHALL return a DiskReport with an empty `files` array and a Warning with code `image-empty`.
4. IF a limit from this document is exceeded while reading one item, THEN THE FAT12_Reader SHALL stop reading that item, add one Warning that names the exceeded limit and the path of the affected item, keep data already read for other items unchanged, and continue reading the remaining items.
5. THE FAT12_Reader SHALL give every loop a hard iteration cap that does not exceed the Disk_Image length in bytes or the applicable Limit, and SHALL finish reading any Disk_Image of at most 2,949,120 bytes within 2 seconds.
6. THE FAT12_Reader SHALL track directory depth with an explicit counter and SHALL NOT use unbounded recursion.
7. WHERE the FAT12_Reader applies a regular expression to text taken from a Disk_Image, THE FAT12_Reader SHALL use a linear-time pattern on input of at most 255 characters.
8. THE FAT12_Reader SHALL read only from the supplied `Uint8Array` and SHALL NOT modify any byte of it, so that its content is identical before and after the call.
9. THE FAT12_Reader SHALL NOT execute, evaluate or load as code any byte of a Disk_Image.
10. IF a read would fall outside the Disk_Image, THEN THE FAT12_Reader SHALL treat the missing bytes as unavailable, add a Warning with code `out-of-bounds-read` naming the affected path, and continue with the remaining items.
11. IF a Cluster_Chain or directory structure contains a cycle, THEN THE FAT12_Reader SHALL stop at the first repeated cluster, add a Warning naming the affected path, and continue.

### Requirement 3: Boot sector and BPB validation

**User Story:** As a user, I want the reader to understand the disk layout, so that files are found even when the boot sector is damaged.

#### Acceptance Criteria

1. WHEN a Disk_Image is read, THE FAT12_Reader SHALL parse the BPB fields bytes per sector, sectors per cluster, reserved sector count, FAT count, root entry count, total sectors, media descriptor and sectors per FAT from the boot sector.
2. THE FAT12_Reader SHALL accept a BPB as valid only when all of the following hold:
   - bytes per sector is 512, 1024, 2048 or 4096;
   - sectors per cluster is a power of two from 1 to 128;
   - reserved sector count is at least 1;
   - FAT count is 1 or 2;
   - root entry count is greater than 0;
   - sectors per FAT is greater than 0;
   - total sectors is greater than 0;
   - total sectors multiplied by bytes per sector does not exceed the Disk_Image length;
   - the computed data area starts inside the Disk_Image.
3. WHEN the BPB is valid, THE FAT12_Reader SHALL use the BPB as the Geometry and SHALL set the geometry source in the Volume to `bpb`.
4. IF the BPB fails validation and the Disk_Image length equals the size of a Fallback_Geometry, THEN THE FAT12_Reader SHALL use that Fallback_Geometry, set the geometry source in the Volume to `fallback`, and add a Warning with code `bpb-invalid`.
5. THE FAT12_Reader SHALL provide a Fallback_Geometry for each of these Disk_Image lengths: 163,840 bytes (160 KB), 184,320 bytes (180 KB), 327,680 bytes (320 KB), 368,640 bytes (360 KB), 737,280 bytes (720 KB), 1,228,800 bytes (1.2 MB), 1,474,560 bytes (1.44 MB) and 2,949,120 bytes (2.88 MB).
6. IF the BPB fails validation and the Disk_Image length matches no Fallback_Geometry, THEN THE FAT12_Reader SHALL return a DiskReport with an empty `files` array and a Warning with code `geometry-unknown`, and SHALL NOT throw an exception.
7. IF the Disk_Image length is less than 512 bytes, THEN THE FAT12_Reader SHALL return a DiskReport with an empty `files` array and a Warning with code `geometry-unknown`, and SHALL NOT throw an exception.
8. IF the media descriptor in the BPB differs from the first byte of the first FAT, THEN THE FAT12_Reader SHALL add a Warning with code `media-mismatch` and continue with the selected Geometry.
9. IF the number of data clusters computed from the Geometry is 4085 or more, THEN THE FAT12_Reader SHALL add a Warning with code `not-fat12` and return an empty `files` array.
10. WHEN the boot sector contains a volume label, THE FAT12_Reader SHALL report it in the Volume as the 11-byte label field with trailing spaces removed, and as an empty string when the field is all spaces.
11. IF the boot signature bytes at offsets 510 and 511 are not `0x55 0xAA`, THEN THE FAT12_Reader SHALL add a Warning with code `boot-signature-missing` and continue with BPB validation unchanged.

### Requirement 4: FAT12 entry decoding

**User Story:** As a developer, I want correct 12-bit FAT decoding, so that cluster chains are followed accurately.

#### Acceptance Criteria

1. WHEN the FAT12_Reader decodes the FAT entry for cluster N (an integer from 0 to the number of FAT entries minus 1), THE FAT12_Reader SHALL read the 12-bit value at byte offset floor(N × 3 / 2), using the low 12 bits of the 16-bit little-endian word when N is even and the high 12 bits when N is odd.
2. THE FAT12_Reader SHALL classify a FAT value of `0x000` as free, `0x001` as reserved, `0x002` to `0xFEF` as a next-cluster link, `0xFF0` to `0xFF6` as reserved, `0xFF7` as bad, and `0xFF8` to `0xFFF` as end of chain.
3. IF the bytes required for cluster N (at offsets floor(N × 3 / 2) and floor(N × 3 / 2) + 1) do not lie entirely inside the first FAT copy, THEN THE FAT12_Reader SHALL treat that entry as unavailable, add a Warning with code `out-of-bounds-read` identifying N, let the caller stop that chain, not throw an error, and leave previously decoded entries unchanged.
4. IF the FAT count is 2 and the two FAT copies differ in at least one byte, THEN THE FAT12_Reader SHALL add one Warning with code `fat-copies-differ`, decode all entries from the first FAT copy, and continue.
5. FOR ALL 12-bit values from 0x000 to 0xFFF written at any valid cluster index by the Image_Writer, decoding the entry SHALL return the written value and SHALL leave the adjacent entry that shares the same byte unchanged (round-trip property).

### Requirement 5: Cluster chain traversal

**User Story:** As a user, I want files with broken chains to be handled safely, so that one bad file does not stop the scan.

#### Acceptance Criteria

1. WHEN the FAT12_Reader follows a Cluster_Chain, THE FAT12_Reader SHALL stop after at most as many steps as there are data clusters in the Geometry.
2. IF a Cluster_Chain visits a cluster a second time, THEN THE FAT12_Reader SHALL stop that chain, keep the bytes read before the repeat, add a Warning with code `chain-cycle` and the affected path, and report the file as damaged.
3. IF a Cluster_Chain contains a link to a cluster number below 2 or above the highest data cluster number, THEN THE FAT12_Reader SHALL stop that chain, keep the earlier bytes, add a Warning with code `cluster-out-of-range` and the affected path, and report the file as damaged.
4. IF a Cluster_Chain reaches a bad or reserved FAT value (`0xFF0` to `0xFF7`), THEN THE FAT12_Reader SHALL stop that chain, keep the earlier bytes, add a Warning with code `chain-bad-cluster` and the affected path, and report the file as damaged.
5. IF a Cluster_Chain reaches a free FAT value (`0x000`) before an end-of-chain value (`0xFF8` to `0xFFF`), THEN THE FAT12_Reader SHALL stop that chain, keep the earlier bytes, add a Warning with code `chain-truncated` and the affected path, and report the file as damaged.
6. IF a Cluster_Chain ends with an end-of-chain value and holds fewer bytes than the declared size, THEN THE FAT12_Reader SHALL return the available bytes and add a Warning with code `chain-short` and the affected path.
7. THE FAT12_Reader SHALL return at most the declared size in bytes when reading a file, and no more than 4,194,304 bytes (4 MB) for any one file.
8. IF the declared size of a file exceeds 4,194,304 bytes, THEN THE FAT12_Reader SHALL stop reading that file at 4,194,304 bytes and add a Warning with code `output-capped` and the affected path.
9. IF the declared size of a file exceeds the total bytes of all data clusters in the Geometry, THEN THE FAT12_Reader SHALL read only the chain-reachable bytes and add a Warning with code `size-exceeds-disk` and the affected path.
10. IF a file has a damaged Cluster_Chain or any chain Warning, THEN THE FAT12_Reader SHALL continue scanning the remaining files and directories and SHALL leave their results unaffected.
11. FOR ALL file contents of 0 bytes up to the data capacity of the chosen Geometry (the total bytes of all data clusters in that Geometry) written by the Image_Writer, reading the file back through its Cluster_Chain SHALL return bytes equal to the contents written (round-trip property).

### Requirement 6: Directory traversal

**User Story:** As a user, I want every folder on the disk listed, so that I can see all of my files.

#### Acceptance Criteria

1. WHEN the FAT12_Reader reads the root directory, THE FAT12_Reader SHALL read at most the root entry count of Directory_Entry records, in on-disk order from the first root entry.
2. WHEN a Directory_Entry has the directory attribute and a start cluster from 2 to the highest valid data cluster number, THE FAT12_Reader SHALL read that subdirectory by following its Cluster_Chain until end of chain.
3. WHEN a Directory_Entry has a first name byte of `0x00`, THE FAT12_Reader SHALL stop reading that directory and SHALL read no later entries in it.
4. WHEN a Directory_Entry is named `.` or `..`, THE FAT12_Reader SHALL skip it without adding it to the `files` array and without counting it as a reported entry.
5. IF a subdirectory is nested deeper than 16 levels below the root, THEN THE FAT12_Reader SHALL NOT read that subdirectory, add a Warning with code `depth-exceeded` and the affected path, and continue.
6. IF a subdirectory start cluster is already on the path from the root to that subdirectory, THEN THE FAT12_Reader SHALL NOT read that subdirectory again, add a Warning with code `directory-loop` and the affected path, and continue.
7. IF a subdirectory start cluster was already read through another entry that is not on the path from the root, THEN THE FAT12_Reader SHALL NOT read that subdirectory again, add a Warning with code `directory-duplicate` and the affected path, and continue.
8. IF the total number of Directory_Entry records read from the whole Disk_Image reaches 4,096, THEN THE FAT12_Reader SHALL stop reading further entries, keep the entries already reported, and add exactly one Warning with code `entry-limit`.
9. IF a Directory_Entry has the directory attribute and a start cluster of 0, 1 or above the highest valid data cluster number, THEN THE FAT12_Reader SHALL add a Warning with code `cluster-out-of-range` and the affected path, NOT read that subdirectory, and continue.
10. THE FAT12_Reader SHALL set the `kind` to `directory` for a Directory_Entry with the directory attribute and to `file` for every other reported entry.
11. THE FAT12_Reader SHALL omit entries with the volume-label attribute from the `files` array.
12. THE FAT12_Reader SHALL give each entry read from a subdirectory a `path` that begins with the `path` of that subdirectory followed by a path separator.

### Requirement 7: Names, dates and attributes

**User Story:** As a user, I want correct file names and dates, so that I can recognise my files.

#### Acceptance Criteria

1. WHEN a Directory_Entry has an 8.3 name, THE FAT12_Reader SHALL build the name from the 8-byte base and the 3-byte extension, with trailing spaces removed from each part and a `.` inserted only when the extension is not empty after trimming.
2. THE FAT12_Reader SHALL decode name bytes at or above `0x80` using code page 437 into Unicode text.
3. WHEN a Directory_Entry has a first name byte of `0x05`, THE FAT12_Reader SHALL decode that byte as `0xE5` in the name.
4. WHEN a name contains a control character below `0x20`, a `/`, or a `\`, THE FAT12_Reader SHALL replace each such character with `_` in the Grave `path`.
5. WHERE VFAT long-name entries precede a Directory_Entry, IF the checksum matches the 8.3 name and the sequence numbers are in order and complete, THEN THE FAT12_Reader SHALL use the assembled long name (UTF-16 decoded, with criterion 4 applied) in the `path`.
6. IF VFAT long-name entries are out of order, incomplete or have a checksum that does not match the 8.3 name, THEN THE FAT12_Reader SHALL use the 8.3 name, add one Warning with code `lfn-invalid` and the affected path, and continue.
7. IF an assembled long name exceeds 255 UTF-16 code units, THEN THE FAT12_Reader SHALL discard the long-name entries, use the 8.3 name, and add one Warning with code `lfn-invalid` and the affected path.
8. WHEN the modification date and time of a Directory_Entry are valid, THE FAT12_Reader SHALL report them as an ISO 8601 string in the Grave `date` at 2-second resolution, for years 1980 to 2107, without time zone conversion.
9. IF the modification date or time of a Directory_Entry is invalid (month outside 1 to 12, day invalid for the month and year, hour outside 0 to 23, minute outside 0 to 59, or double-second value outside 0 to 29), THEN THE FAT12_Reader SHALL set the Grave `date` to `null`, add one Warning with code `date-invalid` and the affected path, and continue.
10. THE FAT12_Reader SHALL report the attributes read-only (`0x01`), hidden (`0x02`), system (`0x04`) and archive (`0x20`) as separate booleans for each Grave.
11. FOR ALL valid 8.3 names and valid dates written by the Image_Writer, reading the image back SHALL return the same name and the same date (round-trip property).

### Requirement 8: Undelete grading

**User Story:** As a user with an old disk, I want deleted files graded honestly, so that I know what can really be brought back.

#### Acceptance Criteria

1. THE FAT12_Reader SHALL report a Deleted_Entry as a Grave of kind `directory` when the directory attribute bit is set and of kind `file` otherwise, with the first character of its name replaced by the Placeholder_Character.
2. WHEN a Directory_Entry is not deleted, THE FAT12_Reader SHALL report it with the State `alive`.
3. WHEN a deleted non-directory Directory_Entry has a declared size of 0, THE FAT12_Reader SHALL report the State `recovered` with a reason that states the file is empty, without evaluating its start cluster.
4. WHEN a deleted non-directory Directory_Entry has a declared size greater than 0 and the N = ceil(size / cluster size) clusters form a Contiguous_Unallocated_Run from the start cluster that ends at or before the highest data cluster, THE FAT12_Reader SHALL report the State `recovered` with a reason that states the clusters are contiguous and unallocated.
5. WHEN the start cluster of a Deleted_Entry is unallocated and at least one later cluster of its N-cluster run is allocated to another file, THE FAT12_Reader SHALL report the State `partial` with a reason that states the number of clusters, from the start cluster up to the first allocated cluster, that are still free.
6. WHEN the start cluster of a Deleted_Entry is from 2 to the highest data cluster number and is allocated, THE FAT12_Reader SHALL report the State `lost` with a reason that states the start cluster has been reused.
7. IF a Deleted_Entry has a declared size greater than 0 and a start cluster below 2 or above the highest data cluster number, THEN THE FAT12_Reader SHALL report the State `lost` with a reason that states the start cluster is invalid.
8. IF the start cluster of a Deleted_Entry is unallocated and valid but its N-cluster run extends beyond the highest data cluster, THEN THE FAT12_Reader SHALL report the State `partial` when at least one cluster of the run lies within the disk and is unallocated and the State `lost` otherwise, with a reason that states the run exceeds the disk.
9. WHEN the FAT12_Reader reads the bytes of a Grave with State `recovered` or `partial`, THE FAT12_Reader SHALL read only the clusters of the Contiguous_Unallocated_Run and SHALL return at most the declared size in bytes.
10. WHEN a caller requests the bytes of a Grave with State `lost`, THE FAT12_Reader SHALL return a failure result `{ ok: false, error }` stating the data is not recoverable, return no bytes, and not throw an exception.
11. THE FAT12_Reader SHALL grade each Deleted_Entry from the FAT and the Directory_Entry only, and SHALL give the same States and reasons for the same Disk_Image on every run.
12. IF two Deleted_Entries claim a common cluster, THEN THE FAT12_Reader SHALL report the State `partial` for the later entry in directory order when it still has at least one non-overlapping unallocated cluster at its start and the State `lost` otherwise, with a reason that names the overlap, and SHALL keep the grade of the earlier entry.
13. WHEN a Deleted_Entry is a directory, THE FAT12_Reader SHALL NOT read the entries inside it, and SHALL report the State `lost` with a reason that states its contents are not listed.
14. FOR ALL File_Trees in which the Image_Writer marks a file as deleted and leaves its clusters contiguous and unallocated, THE FAT12_Reader SHALL report that file with the State `recovered` and contents byte-identical to the original, with only the first name character differing (undelete property).

### Requirement 9: Test-only image writer

**User Story:** As a developer, I want a FAT12 image writer for tests, so that I can generate disks for property tests and later for demo disks.

#### Acceptance Criteria

1. WHEN given a File_Tree and a standard Geometry (160 KB, 180 KB, 320 KB, 360 KB, 720 KB, 1.2 MB, 1.44 MB or 2.88 MB), THE Image_Writer SHALL return a Disk_Image whose length equals the Geometry total size and that contains every file, nested directory, 8.3 name, content, date and attribute set of the File_Tree, with normal nesting up to 8 levels.
2. WHERE a test requests a depth-limit disk, THE Image_Writer SHALL support nesting of at least 17 levels.
3. THE Image_Writer SHALL write a boot sector with a BPB matching the Geometry and the signature `0x55 0xAA` at offsets 510 and 511.
4. THE Image_Writer SHALL write two byte-identical FAT copies, followed by the root directory and the data area at the offsets and sizes declared in the BPB.
5. WHERE a File_Tree entry is marked deleted, THE Image_Writer SHALL write a first name byte of `0xE5`, retain the remaining Directory_Entry bytes, and set the FAT entries of its clusters to `0x000` in both FAT copies.
6. WHERE a test requests a damaged disk, THE Image_Writer SHALL provide one option per defect, each producing only its own defect: a cyclic Cluster_Chain; a cluster link outside the valid data range; a subdirectory whose first cluster refers to its own directory; a BPB with at least one invalid field; and a declared file size exceeding the chain size.
7. IF a File_Tree does not fit the chosen Geometry, THEN THE Image_Writer SHALL throw an error naming the exceeded limit (root entry count, data cluster count or file name format) with the limit value and the requested value, and SHALL return no Disk_Image.
8. THE Image_Writer SHALL reside in a test-support location outside the production entry point of `src/core/fat12/`, so that it is not included in the web or MCP builds.
9. THE Image_Writer SHALL expose a public interface that accepts a File_Tree, a Geometry and options and returns a Disk_Image, has no test-runner dependency, and is usable by a later script unchanged.
10. THE Image_Writer SHALL produce identical bytes for the same File_Tree, Geometry and options, using only dates from the File_Tree and no current time or random values.

### Requirement 10: Core purity and project constraints

**User Story:** As a maintainer, I want the core to stay dependency-free and portable, so that it runs unchanged in the browser, Node and the MCP server.

#### Acceptance Criteria

1. THE FAT12_Reader SHALL compile under the TypeScript `strict` setting with zero uses of the `any` type in `src/core/fat12/`.
2. THE FAT12_Reader SHALL conform to the Core_Purity_Rule, with zero imports of Node built-in modules, browser DOM globals (`window`, `document`) or third-party runtime packages in `src/core/fat12/`.
3. THE FAT12_Reader SHALL accept its input as a `Uint8Array` and SHALL NOT require a Node `Buffer`.
4. WHEN a plain `Uint8Array` and a Node `Buffer` hold identical bytes, THE FAT12_Reader SHALL return the same DiskReport for both.
5. THE FAT12_Reader SHALL make zero network calls.
6. THE FAT12_Reader SHALL export its public API from `src/core/fat12/index.ts`, including the DiskReport, Grave, Warning and Volume types.
7. WHEN the project build runs, THE FAT12_Reader SHALL compile with zero type errors alongside `src/main.ts`.
8. THE FAT12_Reader SHALL define every numeric Limit as a named exported constant in a single module under `src/core/fat12/`, with no duplicate definition of a Limit value elsewhere in the reader.
9. IF the input is not a `Uint8Array`, THEN THE FAT12_Reader SHALL reject it with an error indicating an invalid input type and SHALL modify no state.

### Requirement 11: Property-based and unit tests

**User Story:** As a maintainer, I want automated property tests, so that regressions and hostile-input failures are caught before release.

#### Acceptance Criteria

1. THE test suite SHALL use Vitest and fast-check, and SHALL place tests in `src/**/*.test.ts`.
2. THE test suite SHALL include a round-trip property that generates random File_Trees (0 to 64 files, depth 0 to 4, names of 1 to 8 characters in the 8.3 character set, sizes 0 to 65,536 bytes), builds each with the Image_Writer, reads it with the FAT12_Reader, and checks that each file's name, size and bytes equal the input and that the file count equals the number generated. THE File_Tree generator SHALL keep the total cluster usage (file contents plus subdirectory clusters), the file count and the root entry count within the chosen Geometry, either by choosing the Geometry from the generated size or by shrinking sizes, so that the Image_Writer never throws during the property.
3. THE test suite SHALL include a hostile-input property over random byte arrays of length 0 to 2,097,152 that checks the FAT12_Reader returns a DiskReport without throwing.
4. THE test suite SHALL include hostile-input properties over images with a cyclic chain, out-of-range links, a self-referencing directory, and an oversized declared size (greater than the image size), and SHALL check that each returns a DiskReport with at least one Warning and no thrown error.
5. THE test suite SHALL check that every hostile-input case completes within 2,000 ms on the CI machine.
6. THE test suite SHALL check that the bytes returned for any single file never exceed 4,194,304 and never exceed the declared size.
7. THE test suite SHALL check that no `files` path is deeper than 16 levels.
8. THE test suite SHALL check that the `files` array never holds more than 4,096 entries.
9. WHEN a fast-check property callback runs, THE callback SHALL return nothing or a boolean and SHALL NOT call `expect(...)`.
10. THE test suite SHALL include example tests for each Fallback_Geometry size, for each grading case (`recovered`, `partial` and `lost`) with the expected grade asserted, and for a VFAT long name with the expected decoded name asserted.
11. THE test suite SHALL fail IF any file under `src/core/` imports a Node built-in module, references `document` or `window`, or calls `fetch`.
12. THE test suite SHALL fail IF the `dependencies` of `package.json` list a package that any file under `src/core/` imports.
13. THE test suite SHALL exclude the `exhumed/` folder from every glob it uses.
14. WHEN the hostile-input property runs via the `test:fuzz` script, THE test suite SHALL use at least 10 times the default run count.
15. IF any property fails, THEN THE test suite SHALL include the fast-check seed and the shrunk counterexample in the failing result.
