# Implementation Plan: FAT12 Core

## Overview

The plan builds the FAT12 reader in `src/core/fat12/` bottom-up (limits, types, bytes, geometry, FAT, chains, names, dates, grader, directory walker, `openDisk`), and the test-only image writer in `src/test-support/fat12/` alongside it so round-trip and hostile-input properties can use it. All code is TypeScript under `strict`. Tests use Vitest 3.2.4 and fast-check 4.3.0. Property callbacks return nothing or a boolean and never call `expect(...)`.

The first task is the only task that edits `package.json`. It lists every change in one place for review before any `npm install` runs. No later task edits `package.json`.

Design decisions 1 to 11 in `design.md` are approved and are followed as written. Limits from `.kiro/steering/safety.md` live only in `src/core/fat12/limits.ts`.

## Tasks

- [x] 1. Project setup and package.json review
  - [x] 1.1 Edit `package.json` (the ONLY task that edits it) and wait for approval before installing
    - Make exactly these changes and no others:
      - `devDependencies.vitest`: `"^3.2.4"` becomes `"3.2.4"`
      - `devDependencies.fast-check`: `"^4.3.0"` becomes `"4.3.0"`
      - `devDependencies.@types/node`: add `"22.20.5"` (exact; Node 22 line, the minimum supported runtime per `tech.md`)
      - `devDependencies.typescript` (`~5.9.3`) and `devDependencies.vite` (`^7.1.7`): leave unchanged
      - `dependencies`: stays absent or empty (no runtime dependencies)
      - `scripts.test`: keep `vitest run`
      - `scripts.test:fuzz`: add `FC_RUNS_MULTIPLIER=10 vitest run hostile`
      - `scripts.typecheck`: add `tsc --noEmit && tsc -p src/core/tsconfig.json --noEmit`
      - `scripts.build`: change `tsc && vite build` to `npm run typecheck && vite build`
      - Leave `dev`, `preview` and `test:watch` unchanged
    - Present the resulting diff of `package.json` to the user and STOP. Wait for explicit approval.
    - Only after approval, run `npm install` once to update `package-lock.json`. Do not run `npm install` in any other task.
    - _Requirements: 10.2, 11.1, 11.12, 11.14_

  - [x] 1.2 Add TypeScript, Vitest and shared test-support configuration (no `package.json` edits)
    - Edit `tsconfig.json`: change `types` to `["vite/client", "node"]` so test files type-check
    - Create `src/core/tsconfig.json`: `lib: ["ES2022"]`, `types: []`, `strict: true`, `noEmit`, `erasableSyntaxOnly`, `verbatimModuleSyntax`, `moduleResolution: "bundler"`, include `src/core/**/*.ts`, exclude `**/*.test.ts`. Any use of `document`, `window`, `fetch`, `Buffer` or `process` in core must fail to compile.
    - Create `vitest.config.ts`: `test.include: ['src/**/*.test.ts']`, `test.exclude: ['**/node_modules/**', '**/dist/**', '**/exhumed/**']`, `test.setupFiles: ['src/test-support/setup.ts']`, `test.testTimeout: 60_000`
    - Create `src/test-support/runs.ts`: `numRuns(base)` returns `base * m`, where `m` is `Number(process.env.FC_RUNS_MULTIPLIER)` when it is an integer from 1 to 100 and 1 otherwise
    - Create `src/test-support/setup.ts`: `fc.configureGlobal({ numRuns: numRuns(100) })`
    - Create `src/test-support/timed.ts` exporting `timed<T>(fn: () => T, budgetMs = 2000): T`. It MUST measure ONLY the closure passed to it. It reads `performance.now()` immediately before calling `fn()` and immediately after it returns, and fails (throws a plain `Error` with the elapsed milliseconds) if the difference exceeds `budgetMs`. Callers must pass a closure that contains nothing but the `readDisk` / `readGraveBytes` (or `openDisk` / `readBytes`) call. Input generation, image building with the writer and fast-check shrinking happen outside the closure, so they are never timed and the check does not flake. Document this contract in a comment at the top of the file.
    - Keep `src/test/smoke.test.ts` passing
    - _Requirements: 10.1, 10.2, 11.1, 11.5, 11.9, 11.13, 11.14_

- [x] 2. Core foundations
  - [x] 2.1 Create `src/core/fat12/limits.ts` and `src/core/fat12/types.ts`
    - `limits.ts`: export every named constant listed in the design (`MAX_IMAGE_BYTES`, `MIN_IMAGE_BYTES`, `MAX_DIR_DEPTH`, `MAX_TOTAL_ENTRIES`, `MAX_FILE_OUTPUT_BYTES`, `MAX_NAME_UTF16`, `MAX_LFN_ENTRIES`, `MAX_REASON_CHARS`, `FAT12_MAX_DATA_CLUSTERS`, `DIR_ENTRY_BYTES`, `SCAN_TIME_BUDGET_MS`). No other module defines these values.
    - `types.ts`: `GraveState`, `GraveKind`, `GeometrySource`, `Attributes`, `Grave` (with `id`, `attributes`, `startCluster` per decision 1), `GeometryInfo`, `Volume`, `WarningCode` (full union from the design), `Warning`, `DiskReport`, `ReadResult`
    - Use `as const` objects, not `enum` (`erasableSyntaxOnly`)
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.6, 1.9, 10.1, 10.8_

  - [x] 2.2 Create `src/core/fat12/bytes.ts` and `src/core/fat12/warnings.ts`
    - `makeByteView(image)` returning a `ByteView` with `length`, `u8`, `u16`, `u32`, `copy`. Every read returns `undefined` for non-negative-safe-integer misuse or out-of-range access. Reads index one byte at a time. `copy` returns a fresh array.
    - `WarningSink` with `add(code, message, path?)` and `list()`. Messages are fixed templates with numbers only. Support the per-scan and per-walk dedupe the design describes (`fat-copies-differ`, `media-mismatch`, `boot-signature-missing`, `entry-limit` once per scan).
    - Add a helper that clamps reasons and messages to `MAX_REASON_CHARS`
    - _Requirements: 1.6, 2.8, 2.10, 4.3, 10.4_

  - [x]* 2.3 Write unit tests for `ByteView` and `WarningSink`
    - Out-of-range, negative, fractional and `NaN` offsets return `undefined`
    - `copy` does not alias the image; the image bytes are unchanged after reads
    - A `Buffer` and a `Uint8Array` with the same bytes give the same reads
    - Dedupe and length-clamp behavior of the sink
    - _Requirements: 2.8, 2.10, 10.3, 10.4_

- [x] 3. Test-only image writer, part 1 (types and independent encoders)
  - [x] 3.1 Create `src/test-support/fat12/types.ts` and `src/test-support/fat12/errors.ts`
    - `StandardGeometryName`, `DosDateTime`, `NodeBase`, `FileNode`, `DirNode`, `TreeNode`, `FileTree`, `DamageSpec`, `WriteOptions`, `Measure`, `Capacity`
    - `FitError` (fields `limit`, `limitValue`, `requestedValue`; no constructor parameter properties because of `erasableSyntaxOnly`)
    - No imports from `vitest`, `fast-check` or Node
    - _Requirements: 9.1, 9.6, 9.7, 9.8, 9.9_

  - [x] 3.2 Create `src/test-support/fat12/encode.ts` with independent encoders
    - FAT12 entry writer (the inverse of the reader codec), DOS date and time word encoder, 8.3 name encoder and validator, long-name record builder and VFAT checksum
    - Written independently of `src/core/` so the tests are not circular; literal constants only for on-disk layout
    - _Requirements: 4.5, 7.5, 7.8, 7.11, 9.1, 9.10_

- [x] 4. Geometry and FAT decoding
  - [x] 4.1 Create `src/core/fat12/geometry.ts`
    - `Geometry`, `Layout`, `FALLBACK_GEOMETRIES` (keyed by `totalSectors * bytesPerSector`, expressed in sector counts, eight entries from the design table)
    - `parseBpb` (16-bit total sectors, falling back to the 32-bit field when zero), `isValidBpb` (the nine conditions of 3.2 as one pure predicate), `deriveLayout`, `chooseGeometry`
    - Apply the boot-signature check, `not-fat12` (4085 or more data clusters, for both `bpb` and `fallback` sources, decision 11), the media check against the selected Geometry (decision 6) and the `bpb-invalid` / `geometry-unknown` warnings
    - Volume label read from the boot sector at offset 43, CP437-decoded later in `disk.ts`
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.10, 3.11_

  - [x] 4.2 Write example tests in `src/core/fat12/geometry.test.ts`
    - One test per Fallback_Geometry size with expected values written as literals independent of the table in `geometry.ts`
    - `image-empty`, length below 512, unknown length with invalid BPB, `not-fat12`, `boot-signature-missing`, `media-mismatch`
    - _Requirements: 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 3.11, 11.10_

  - [x]* 4.3 Write property test for BPB validation and geometry selection
    - **Property 7: BPB validation and geometry selection**
    - Add to `geometry.test.ts` with an independent oracle for the nine conditions
    - **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.6, 3.7**

  - [x] 4.4 Create `src/core/fat12/fat.ts`
    - `FatClass`, `readFatEntry` (first FAT copy only; `undefined` unless both bytes lie inside the FAT), `classifyFat`, `fatCopiesDiffer`
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [x]* 4.5 Write property test for the FAT12 entry codec round trip
    - **Property 5: FAT12 entry codec round trip**
    - In `src/core/fat12/fat.test.ts`, using the independent encoder from task 3.2
    - **Validates: Requirements 4.1, 4.5**

  - [x]* 4.6 Write property test for FAT value classification
    - **Property 6: FAT value classification partitions the 12-bit range**
    - Add to `fat.test.ts`
    - **Validates: Requirements 4.2**

- [x] 5. Cluster chain walker
  - [x] 5.1 Create `src/core/fat12/chain.ts`
    - `ScanContext` (view, layout, sink, `Uint32Array` stamps sized from the validated layout, `nextWalkId`) and `walkChain(ctx, start, wantClusters, path)` returning `{ clusters, end }`
    - Loop capped at `layout.dataClusters` steps; stamp-based cycle detection; range, bad/reserved, free (truncated) and out-of-bounds stops; at most one warning per walk
    - _Requirements: 2.10, 2.11, 5.1, 5.2, 5.3, 5.4, 5.5_

  - [x] 5.2 Write unit tests in `src/core/fat12/chain.test.ts`
    - Cyclic chain, link below 2, link above max, bad cluster, reserved value, free value mid-chain (`chain-truncated`), truncated FAT (`out-of-bounds-read`), chain longer than needed (`enough`)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 4.3_

- [x] 6. Text decoding: CP437, names, long names, dates
  - [x] 6.1 Create `src/core/fat12/cp437.ts` and `src/core/fat12/names.ts`
    - `decodeCp437` (ASCII below 0x80, 128-entry table above)
    - `decodeShortName` (trim, extension rule, `0x05` to `0xE5`), `sanitizeComponent` (control chars, `/`, `\`, `0x7F`, dots-only and empty components become `_`, decision 9)
    - Long-name state machine: `lfnReset`, `lfnFeed`, `lfnTake`, `lfnChecksum`. Character-level code only; no regular expressions and no `RegExp` (2.7). Lone surrogates become U+FFFD. Names over 255 UTF-16 units are invalid.
    - _Requirements: 2.7, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [x] 6.2 Create `src/core/fat12/dates.ts`
    - `decodeDosDateTime(dateWord, timeWord)` returning `YYYY-MM-DDTHH:MM:SS` or `null`, with the Gregorian leap-year rule and the validity limits from 7.9
    - _Requirements: 7.8, 7.9_

  - [x] 6.3 Write example tests in `src/core/fat12/names.test.ts`
    - CP437 spot checks (`0x80` is `Ç`, `0xE1` is `ß`) and a check that all 128 high entries are non-control characters
    - VFAT fixture "Long File Name.txt" with a checksum computed by a test-side function, asserting the decoded name
    - Invalid long-name sequences (wrong checksum, wrong order, missing last record, 256 units) fall back to the 8.3 name signal `invalid`
    - _Requirements: 7.2, 7.3, 7.5, 7.6, 7.7, 11.10_

  - [x]* 6.4 Write property test for DOS date decoding
    - **Property 10: DOS date decoding matches an oracle**
    - In `src/core/fat12/dates.test.ts`, with an independent oracle; the reader-level `date-invalid` warning is covered in task 13.6
    - **Validates: Requirements 7.8, 7.9**

  - [x]* 6.5 Write property test for short-name decoding
    - **Property 11: Short-name decoding is safe**
    - Add to `names.test.ts`
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4**

- [x] 7. Checkpoint - Ensure all tests pass
  - Run `npm test` and `npm run typecheck`. Ensure all tests pass, ask the user if questions arise.

- [x] 8. Undelete grader
  - [x] 8.1 Create `src/core/fat12/grade.ts`
    - `gradeDeleted(ctx, claimed, entry, path)` implementing the grading flow in the design in this order: directory (`lost`, contents not listed), size 0 (`recovered`, empty), invalid start (`lost`), start allocated / unreadable / claimed (`lost`), then the free-run scan bounded by `min(N, maxCluster - start + 1)` giving `partial` or `recovered`. Mark the usable run in the `claimed` bitmap. Never allocate from `N`.
    - `gradeLive(chain, size, ctx)` per decision 2 (damaged live entries become `partial` when at least one cluster was read, `lost` otherwise; zero-length files are never damaged)
    - Reasons are templates with numbers only and at most `MAX_REASON_CHARS` characters
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.11, 8.12, 8.13, 1.6_

- [x] 9. Directory walker
  - [x] 9.1 Create `src/core/fat12/directory.ts`
    - `walkDirectories(ctx)` with an explicit `DirFrame` stack, depth counter and global `recordsRead` counter (decision 5: every examined 32-byte record counts; the warning fires when a 4,097th read is attempted)
    - Per-record order from the design: budget, fetch, end marker, long-name record, volume label, `.` / `..`, build entry (decision 8: deleted entries use the 8.3 name with `_`), grade and descend
    - Descent order: invalid start (`cluster-out-of-range`, `lost`), depth (decision 4, `depth-exceeded`), loop (`directory-loop`), duplicate (`directory-duplicate`) using a `readDirs` set, otherwise `walkChain` with `Infinity` and push a frame. Orphan long-name records give one `lfn-invalid` (decision 10).
    - Build `Grave` objects (path join, `date`, attributes, `startCluster`, `id`) and the internal `EntryRecord[]` with read plans
    - _Requirements: 2.4, 2.6, 2.11, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10, 6.11, 6.12, 7.1, 7.4, 7.5, 7.6, 7.8, 7.9, 7.10, 8.1, 8.2_

- [x] 10. Public API
  - [x] 10.1 Create `src/core/fat12/guard.ts` and `src/core/fat12/guard.test.ts`
    - `guarded(label, fn, onError)` is the documented last-resort catch; the test calls it with a function that throws and checks that an `internal-error` warning is produced and earlier results are kept
    - _Requirements: 2.1, 2.4_

  - [x] 10.2 Create `src/core/fat12/disk.ts`
    - `openDisk(image)`: `TypeError` check via `Object.prototype.toString.call(x) === "[object Uint8Array]"` before any state; length checks (empty, too large, below 512) in the order shown in the scan flow, before parsing; geometry selection; `ScanContext`; directory walk inside `guarded`; volume label (CP437, trailing spaces removed, control chars to `_`); `DiskHandle`
    - `readBytes(grave)`: look up `grave.id` and check `path`, `size`, `startCluster`; return the three fixed failure strings; recovered / partial deleted reads copy only the stored run; live reads re-run `walkChain` with a local sink; apply the 4 MB and declared-size caps and `size-exceeds-disk` / `output-capped` warnings (decision 7); allocate the output only after the minimum is known
    - `readDisk` and `readGraveBytes` convenience functions
    - _Requirements: 1.1, 1.7, 1.8, 1.9, 2.1, 2.2, 2.3, 2.5, 2.8, 2.9, 3.6, 3.7, 3.9, 3.10, 5.6, 5.7, 5.8, 5.9, 5.10, 8.9, 8.10, 10.3, 10.4, 10.5, 10.9_

  - [x] 10.3 Create `src/core/fat12/index.ts` and `src/core/fat12/index.test.ts`
    - Re-export `openDisk`, `readDisk`, `readGraveBytes`, `FALLBACK_GEOMETRIES`, all limits and all public types
    - The test imports every public name (fails to compile if one is missing) and checks that `openDisk`, `readDisk` and `readGraveBytes` throw `TypeError` for `null`, `undefined`, a string, a number, a plain array, an `ArrayBuffer` and a `DataView`, and accept a `Buffer`
    - _Requirements: 10.6, 10.7, 10.9_

- [x] 11. Checkpoint - Ensure all tests pass
  - Run `npm test` and `npm run typecheck`. Ensure all tests pass, ask the user if questions arise.

- [x] 12. Test-only image writer, part 2 (layout, damage, public API, arbitraries)
  - [x] 12.1 Create `src/test-support/fat12/measure.ts`
    - `standardGeometry(name)` (independent literal table), `capacityOf`, `measureTree` (root entries, clusters including directory clusters and long-name records), `pickGeometry(tree)` (smallest standard geometry that fits, or `undefined`), `fitTree(tree)` (halve file sizes until the tree fits `2880K`)
    - _Requirements: 9.1, 9.7, 11.2_

  - [x] 12.2 Create `src/test-support/fat12/layout.ts`
    - Deterministic bump allocation from cluster 2 in depth-first pre-order, directory sizing with `.` and `..`, boot sector (OEM `EXHUME  `, BPB, label at offset 43, signature), two identical FAT copies, root directory, data area, FAT[0] / FAT[1]
    - Deleted nodes keep their clusters reserved, write `0xE5`, clear FAT entries in both copies; `placement.startCluster` support with deleted data written first
    - Dates come only from the tree (default 1980-01-01 00:00:00); no clock or random values
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.10_

  - [x] 12.3 Create `src/test-support/fat12/damage.ts`
    - One function per `DamageSpec` variant (`cyclic-chain`, `cluster-out-of-range`, `self-referencing-directory`, `invalid-bpb`, `size-exceeds-chain`), each producing only its own defect; long-name corruption hooks (`corrupt-checksum`, `swap-order`, `drop-last`); a damage spec naming a missing path throws a plain `Error` naming the path
    - _Requirements: 9.6_

  - [x] 12.4 Create `src/test-support/fat12/index.ts`
    - `writeFat12Image`, `measureTree`, `capacityOf`, `pickGeometry`, `fitTree`, `standardGeometry`, `FitError`, and the public types. All checks run before any byte is written. No imports of `vitest`, `fast-check` or Node.
    - _Requirements: 9.1, 9.2, 9.7, 9.8, 9.9, 9.10_

  - [x] 12.5 Create `src/test-support/fat12/arbitraries.ts` (not exported from `index.ts`)
    - File-tree arbitrary: 0 to 64 files, nesting 0 to 4, at most 32 directories, unique 8.3 names per directory (`fc.uniqueArray`), sizes 0 to 65,536, valid dates, random attribute flags, optional volume label; file contents expanded from a `{ seed, length }` pair by a small deterministic PRNG
    - Helper that applies `pickGeometry` and `fitTree` so the writer never throws during the round-trip property, and returns the tree after fitting
    - _Requirements: 11.2_

  - [x]* 12.6 Write property test for writer layout and determinism
    - **Property 20: Writer layout is valid and deterministic**
    - In `src/test-support/fat12/writer.test.ts`
    - **Validates: Requirements 9.1, 9.3, 9.4, 9.10**

  - [x]* 12.7 Write property test for fit errors
    - **Property 21: The writer refuses trees that do not fit**
    - Add to `writer.test.ts`; also an example test for 17-level nesting (9.2)
    - **Validates: Requirements 9.7, 9.2**

- [x] 13. Round-trip and undelete properties
  - [x] 13.1 Write property test for the file tree round trip
    - **Property 8: File tree round trip**
    - In `src/core/fat12/reader.roundtrip.test.ts`; compare against the tree after `fitTree`; check path, size, bytes, ISO date, attributes, `state: 'alive'`, file count, directory kinds, no `.`, `..` or label entries, depth-first order, `volume.label` and geometry
    - **Validates: Requirements 1.7, 3.10, 6.1, 6.2, 6.4, 6.10, 6.11, 7.1, 7.8, 7.10, 7.11, 8.2, 11.2**

  - [x] 13.2 Write property test for single-file content round trip up to capacity
    - **Property 9: Single file content round trip up to capacity**
    - Add to `reader.roundtrip.test.ts`; weight cluster-multiple boundaries and the capacity itself
    - **Validates: Requirements 5.11**

  - [x] 13.3 Write property test for undelete of contiguous deleted files
    - **Property 13: Undelete restores contiguous deleted files**
    - Add to `reader.roundtrip.test.ts`
    - **Validates: Requirements 8.1, 8.14, 9.5**

  - [x]* 13.4 Write property test for long-name handling
    - **Property 12: Valid VFAT names are used and invalid ones fall back**
    - Add to `names.test.ts`, using the writer's `longName` and `lfn` corruption options
    - **Validates: Requirements 7.5, 7.6, 7.7**

  - [x]* 13.5 Write property test for grading against a reference model
    - **Property 14: Grading matches the reference model and is deterministic**
    - Add to `grade.test.ts`; build occupancy patterns with the writer's `placement` option; independent reference model; run twice and compare
    - **Validates: Requirements 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.11, 8.12**

  - [x] 13.6 Write reader example tests in `src/core/fat12/reader.examples.test.ts`
    - `image-empty`, `fat-copies-differ`, truncated FAT, `chain-bad-cluster`, `chain-truncated`, `chain-short`, `output-capped` (declared size `0xFFFFFFFF`), `size-exceeds-disk`, entries after a `0x00` terminator ignored, `directory-duplicate`, directory start cluster 0 or above maximum, volume label entry omitted, `date-invalid` with `date: null`, 17-level nesting
    - _Requirements: 2.3, 4.4, 5.4, 5.5, 5.6, 5.8, 5.9, 6.3, 6.7, 6.9, 6.11, 7.9, 9.2, 11.10_

  - [x] 13.7 Write grading example tests in `src/core/fat12/grade.test.ts`
    - One fixture per case using the image writer: `recovered` (contiguous), `partial` (run cut by a live file, with the free count in the reason), `lost` (start cluster reused), empty deleted file, invalid start cluster, run beyond the disk, deleted directory, overlap with an earlier deleted file
    - _Requirements: 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.12, 8.13, 11.10_

- [x] 14. Checkpoint - Ensure all tests pass
  - Run `npm test` and `npm run typecheck`. Ensure all tests pass, ask the user if questions arise.

- [x] 15. Hostile-input properties (`src/core/fat12/reader.hostile.test.ts`)
  - [x] 15.1 Create `src/test-support/hostile.ts` with hostile-input generators
    - Families from the design: random bytes (length 0 to 2,097,152, plus lengths just above and below each fallback size), writer-built images with 1 to 64 random byte writes, images with a randomized FAT region, images with a randomized directory region, and targeted-defect images from the writer's `damage` option
    - Large inputs are `{ seed, length }` pairs expanded by a deterministic PRNG, not `fc.uint8Array` of 2 MB
    - Generators only produce inputs. They never call the reader and never use `timed()`.
    - _Requirements: 11.3, 11.4_

  - [x] 15.2 Write property test for totality on hostile input
    - **Property 1: Totality on hostile input**
    - Create `reader.hostile.test.ts`. In each case, generate the input and build any image first, outside the timer. Then wrap ONLY the `readDisk` call in `timed(() => readDisk(image))` so the timer starts immediately before the reader call and stops immediately after it. Do not include generation, writer calls, mutation or shrinking in the timed closure. Assert no throw, a `DiskReport` result and no `internal-error` warning. Use `numRuns(100)` so `test:fuzz` gives at least 1,000 runs.
    - **Validates: Requirements 2.1, 2.5, 2.10, 5.1, 11.3, 11.5**

  - [x] 15.3 Write property test for report invariants
    - **Property 2: Report invariants**
    - Add to `reader.hostile.test.ts`. Build the image first; time only the `readDisk` call with `timed()`; run the invariant checks (path shape, depth at most 16, sizes, unions, reasons 1 to 200 characters, at most 4,096 files, JSON round trip) after the timer has stopped.
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.9, 6.8, 6.10, 6.12, 7.4, 11.7, 11.8**

  - [x] 15.4 Write property test for oversized images
    - **Property 4: Oversized images are rejected unparsed**
    - Add to `reader.hostile.test.ts`. Generate the oversized array first, outside the timer; wrap only the `readDisk` call in `timed()`.
    - **Validates: Requirements 2.2**

  - [x] 15.5 Write property test for damaged-file isolation
    - **Property 17: A damaged file is isolated**
    - Add to `reader.hostile.test.ts`. Build the undamaged and the damaged image with the writer first. Time only the reader calls (`readDisk` and `readGraveBytes` on the damaged image) with `timed()`. Compare states and bytes of the other files outside the timer.
    - **Validates: Requirements 2.4, 2.11, 5.2, 5.3, 5.6, 5.8, 5.9, 5.10, 9.6, 11.4**

  - [x] 15.6 Write property test for directory structure limits
    - **Property 18: Directory structure limits hold**
    - Add to `reader.hostile.test.ts`. Depth 1 to 24, `directory-loop` and `directory-duplicate` images are built first; only the `readDisk` call is timed.
    - **Validates: Requirements 2.6, 6.5, 6.6, 6.7, 9.6, 11.4**

  - [x] 15.7 Write property test for the entry limit
    - **Property 19: Entry limit**
    - Add to `reader.hostile.test.ts`. Build images with N records around 4,096 first; only the `readDisk` call is timed. Check exactly one `entry-limit` warning iff N is above 4,096.
    - **Validates: Requirements 6.8, 11.8**

- [x] 16. File-read properties (`src/core/fat12/reader.reads.test.ts`)
  - [x] 16.1 Write property test for bounded reads
    - **Property 15: File reads are bounded**
    - Create `reader.reads.test.ts`. For any image and any Grave in its report, `readGraveBytes` does not throw and, on success, returns at most `min(size, 4,194,304)` bytes. Time only the `readGraveBytes` call with `timed()`; generate and build the image, and run `readDisk` to get the Graves, outside the timer.
    - **Validates: Requirements 1.7, 5.7, 8.9, 11.6**

  - [x]* 16.2 Write property test for failed reads
    - **Property 16: Failed reads are failures, not exceptions**
    - Add to `reader.reads.test.ts`; directory Graves, `lost` Graves and forged Graves return `{ ok: false, error }` with one of the three fixed strings and leave the report and the image unchanged
    - **Validates: Requirements 1.8, 8.10, 8.13**

  - [x]* 16.3 Write property test for input immutability and `Buffer` equivalence
    - **Property 3: Input is not modified and `Buffer` is equivalent**
    - Add to `reader.reads.test.ts`
    - **Validates: Requirements 2.8, 10.3, 10.4**

- [x] 17. Purity, dependency and configuration checks
  - [x] 17.1 Create `src/test-support/purity.test.ts`
    - Parse sources with the `typescript` compiler API. Walk `src/core/`, skipping `exhumed/` and `node_modules/`.
    - Fail on imports of Node built-ins (with or without `node:`), identifiers `document`, `window`, `fetch`, `eval`, `new Function`; non-relative imports in non-test core files; any type `any` in non-test files under `src/core/fat12/`; the literals `2949120` and `4194304` outside `limits.ts`; any `RegExp` literal or construction in `names.ts`; any import from `src/test-support/` inside `src/core/`; any transitive import of `vitest` or `fast-check` from `src/test-support/fat12/index.ts` (arbitraries excluded); any package imported under `src/core/` that is listed in `package.json` `dependencies`
    - _Requirements: 2.7, 2.9, 9.8, 9.9, 10.1, 10.2, 10.5, 10.8, 11.11, 11.12_

  - [x] 17.2 Create `src/test-support/meta.test.ts`
    - Import the Vitest config and assert `exclude` contains `**/exhumed/**` and `include` is `src/**/*.test.ts`
    - Check `numRuns` for multiplier values undefined, `'abc'`, `'0'`, `'10'` and `'1000'`
    - Run a deliberately failing `fc.assert` inside a `try`/`catch` and check that the message contains the seed and the counterexample
    - Check that `timed()` throws when the closure exceeds the budget and does not count time spent outside the closure
    - _Requirements: 11.1, 11.5, 11.13, 11.14, 11.15_

- [x] 18. Final checkpoint - Ensure all tests pass
  - Run `npm test` and `npm run typecheck`. Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP. The round-trip properties (8, 9, 13), the hostile-input properties (1, 2, 4, 17, 18, 19), the bounded-read property (15), the example tests required by 11.10 and the purity checks are not optional.
- Task 1.1 is the only task that touches `package.json`. Do not run `npm install` before the user approves that diff.
- `timed()` measures only the reader call. Generate and build inputs first, start the timer immediately before the call and stop it immediately after.
- Property callbacks return nothing or a boolean and never call `expect(...)`. Each property is tagged with `// Feature: fat12-core, Property N: <title>` and uses `numRuns(100)`.
- Each task references the requirements it satisfies; checkpoints give incremental validation.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2.1", "3.1"] },
    { "id": 3, "tasks": ["2.2", "3.2"] },
    { "id": 4, "tasks": ["2.3", "4.1", "6.1", "6.2", "10.1", "12.1"] },
    { "id": 5, "tasks": ["4.2", "4.4", "6.3", "6.4", "12.2"] },
    { "id": 6, "tasks": ["4.3", "4.5", "5.1", "6.5", "12.3"] },
    { "id": 7, "tasks": ["4.6", "5.2", "8.1", "12.4"] },
    { "id": 8, "tasks": ["9.1", "12.5", "12.6"] },
    { "id": 9, "tasks": ["10.2", "12.7"] },
    { "id": 10, "tasks": ["10.3"] },
    { "id": 11, "tasks": ["13.1", "13.4", "13.6", "13.7", "15.1", "17.1", "17.2"] },
    { "id": 12, "tasks": ["13.2", "13.5", "15.2", "16.1"] },
    { "id": 13, "tasks": ["13.3", "15.3", "16.2"] },
    { "id": 14, "tasks": ["15.4", "16.3"] },
    { "id": 15, "tasks": ["15.5"] },
    { "id": 16, "tasks": ["15.6"] },
    { "id": 17, "tasks": ["15.7"] }
  ]
}
```
