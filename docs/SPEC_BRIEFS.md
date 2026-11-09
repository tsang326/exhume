# Spec briefs (paste into Kiro, one spec at a time)

Kiro writes requirements/design/tasks and the code. These briefs state intent and constraints only.
Steering (`product.md`, `tech.md`, `safety.md`) applies to all.

## Spec 1 — fat12-core
`src/core/fat12/`: read a FAT12 floppy image into a `DiskReport`.
- Boot sector/BPB validation (with fallbacks for common DOS geometries when the BPB is junk), FAT12 12-bit entry
  decoding, root directory + subdirectories, 8.3 names (+ VFAT long names if cheap), dates/times, attributes.
- Undelete grading for deleted entries: first-character recovery placeholder, contiguous-unallocated heuristic →
  `recovered`; partially overwritten → `partial`; start cluster reused → `lost`; always with a reason.
- A test-only FAT12 **image writer** (also used later by the demo-disk generator) so properties can round-trip.
- PBT: round-trip random file trees; hostile inputs (random bytes, cyclic chains, out-of-range clusters,
  self-referencing dirs, huge sizes) → never throws, terminates fast, bounded memory, warnings present.

## Spec 2 — format-resurrection
`src/core/formats/`: `wordstar` → Markdown (high-bit stripping, dot commands, control codes for bold/underline,
soft vs hard returns), `dbase` (dBase III `.dbf` header + fields → CSV, RFC 4180 quoting, code page 437 → UTF-8),
`pcx` (RLE decode, 1/4/8/24-bit, palette) → RGBA → PNG encoder.
- Type detection by content first, extension second.
- PBT: never throws on random bytes; CSV round-trips through a CSV parser; PCX encode→decode round-trip (test-only
  encoder); WordStar: plain ASCII input passes through unchanged.

## Spec 3 — graveyard-ui (the web page)
`src/web/`: drop zone → graveyard. Tombstones for files, open graves for deleted entries, a lantern/fog look,
code-drawn effects (CSS/canvas), translucent, never covering text. Click → "rising" animation → preview
(Markdown rendered safely as text-with-formatting via DOM nodes, CSV table, PNG image) + download.
- Demo disks one click away (from spec 5). `prefers-reduced-motion` respected; keyboard accessible; mobile width.
- CSP and `textContent` rules from `safety.md`.

## Spec 4 — mcp-server + Kiro Power
`src/mcp/` + `power/`:
- Tools: `open_disk {image}` → DiskReport (capped); `read_grave {image, path}` → converted text/CSV preview
  (capped, labeled untrusted) or image metadata; `exhume {image, path}` → writes the converted file into
  `exhumed/` and returns its workspace path; `explain_state {state}` → fixed catalogue text.
- Workspace confinement, naming, caps and labeling exactly per `safety.md`. Tests drive the server in-process,
  including hostile file names and images.
- `power/`: manifest, `mcp.json` (pinned committed build, no auto-approve), a skill doc ("when the user mentions an
  old floppy image, open it with open_disk before guessing"). Also `.kiro/settings/mcp.json` for this workspace.

## Spec 5 — demo disks
`scripts/make-demo-disks.ts`: deterministic generator producing 2–3 images in `public/disks/`:
a writer's disk (WordStar chapters, one deleted draft that is recoverable, one partially overwritten),
a small-business disk (dBase customer table, a PCX logo), and a damaged disk (bad BPB, a cyclic chain) to show
warnings. All content written by us; README states it.

## Spec 6 — Crew app (separate repo `exhume-crew`, after spec 4)
Crew app manifest (`app.json`), an "undertaker" agent, a skill, the Exhume MCP server (pinned build), and a
dashboard page showing the graveyard for disks in a watched folder. Follow kiro.dev/docs/crew/apps.

## Hooks (create in Kiro's hook UI, commit `.kiro/hooks/`)
1. On save of `src/**/*.ts` → `npm test`.
2. On save of `src/core/**` → run the hostile-input property suite with a higher run count (`npm run test:fuzz`).
3. Agent stop → append 2–3 lines to `docs/KIRO_LOG.md` (what was done, which spec/steering helped, what was fixed by hand).

## Spec 7 — real-disk-hardening (after testing 35 real DOS disks, 2026-11-09)
Exhume was tested on real disks, not our own generated ones: 24 FreeDOS 1.3 floppy images and 11 disks from the
PCjs archive (dBASE II/III sample disks, WordStar 3.20, PC-SIG shareware disks from 1983–1993; 160K to 1.44M).
The FAT12 reader matched two independent readers byte for byte on all 942 files, PCX matched Pillow pixel for pixel
(63/63), and dBase III matched `dbfread` (39/39). Four bugs make real disks look broken. Fix them and keep the
real disks as regression tests.

Fixtures (already in the working tree, see `fixtures/real-disks/freedos13/NOTICE.md`): three unmodified FreeDOS
images and `manifest.json`. The manifest's file lists come from a macOS read-only mount, not from Exhume. Commit
them with the spec. They are GPL/other-licensed third-party files: keep `NOTICE.md` next to them, never modify the
images, and do not move them under `public/` (they are not demo disks and the page must not offer them).

1. **WordStar false positives (high).** `isWordStar` in `src/core/formats/detect.ts` runs before the extension rule
   and fires on binaries: 147 files on the 24 FreeDOS disks and about 45 on the PCjs disks (`.COM`, `.EXE`, `.SYS`,
   `.OVR`, BGI drivers, `.CHR` fonts, dBase `.NDX` indexes, dBase II `.DBF` files, split archives `FREEDOS.001`…).
   They "rise" as garbage Markdown. On the three fixtures it fires 39 times.
   Wanted: zero WordStar detections on every file of the three fixtures, while every WordStar document produced by
   the existing fixture writer and every demo disk still converts exactly as today (`make:demos --check` unchanged).
   Real WordStar text is mostly 7-bit text with the high bit set on word-final letters, `0x8D 0x0A` soft returns,
   `0xA0` soft spaces, `0x1F` soft hyphens, dot-command lines and style toggles; executables start with `MZ` or are
   dense with NUL and non-text bytes. Design the rule (for example a text-like ratio after clearing the high bit, a
   NUL/`MZ` veto, and letting a known binary extension win over weak content evidence); keep it one bounded pass.
   A file that only the content rule could have called WordStar and that the new rule rejects becomes `unknown`
   (hex view), which is the right answer for a program.
2. **Phantom graves (high).** DOS 1.x/2.x `FORMAT` fills unused directory slots with `0xE5` followed by 31 bytes of
   `0xF6`; some tools use `0xE5` followed by 31 zero bytes. The reader treats each slot as a deleted file: 641
   phantom graves on 9 of the 11 PCjs disks (for example 58 "deleted directories" of 4,143,380,214 bytes named
   `_÷÷÷÷÷÷÷.÷÷÷`, or 71 empty files named `________.___`), plus one `date-invalid` warning each.
   Wanted: a `0xE5` slot whose other 31 bytes are all `0xF6` or all `0x00` is "never used", not a grave, and gives no
   warning. A real deleted entry (any other content) is still a grave. Build test images for both fill patterns with
   the test-only image writer (no PCjs bytes in the repo). Add a property: never-used slots anywhere in the root or a
   subdirectory never produce a grave or a warning.
3. **Date noise (medium).** DOS 1.x files have date and time words of zero. Today each gives `date-invalid`.
   Wanted: zero date and zero time → `date: null` with no warning; other invalid values keep the warning.
4. **WordStar soft hyphen and soft space (low).** `cor` `0x1F` `0x8D 0x0A` `rected` comes out as "cor rected", and
   justified text keeps double spaces from `0xA0` soft spaces. Wanted: a soft hyphen at a soft line break joins the
   word ("corrected"); a soft hyphen elsewhere is dropped; a soft space (`0xA0`, high bit on a space) inside a
   paragraph becomes nothing when it sits next to an ordinary space (justification padding).
5. **Deleted long names (optional, only if cheap).** A deleted 8.3 entry preceded by deleted VFAT long-name entries
   whose checksum still matches can show the long name, which restores the lost first character (FreeDOS fixture:
   `_REEDOS.012` → `freedos.012`). Keep the underscore form when the checksum does not match.

Tests:
- `src/core/**/realdisks.test.ts` (any name): for each fixture, check the image SHA-256 against the manifest, read
  it, and require (a) every manifest file present as `alive` with the same size and SHA-256 of `readGraveBytes`,
  (b) no alive file that the manifest does not list, (c) the listed directories, (d) zero warnings, (e) zero
  `wordstar` detections, (f) the deleted entries listed in the manifest and no others. Compare paths with ASCII case
  folding: the mount reports VFAT long names in lower case (`/freedos.001`). `deletedEntries` were read from the raw
  directory bytes (an `0xE5` 8.3 entry of size 0 after deleted long-name entries for `freedos.012` / `freedos.020`);
  if item 5 is done, accept the long name in place of the underscore form. Do not regenerate the manifest from Exhume.
- Optional extra corpus, local only: when `EXHUME_EXTRA_DISKS` points to a folder of `.img` files, a separate test
  reads each one and prints counts (files, graves, warnings, detections by format); it never fails on content and
  is skipped when the variable is unset. Nothing from that folder is committed.
- Update `README.md`: one short "Tested on real disks" paragraph with the numbers above, naming FreeDOS and PCjs as
  sources; the demo disks text stays as it is.
Out of scope: new formats (dBase II, WordPerfect, Lotus), `.IMD`/`.TD0` containers, UI changes beyond what the fixes
need, the Crew app, deployment.
