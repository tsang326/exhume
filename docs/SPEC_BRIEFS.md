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

## Spec 8 — power-workspace (make the Kiro Power work, 2026-11-09)
The Power in `power/` fails with "Connection Failed". Verified by hand on 2026-11-07 (see README "Verified Power format
results" and `docs/KIRO_LOG.md`): a Power install copies only `POWER.md`, `mcp.json` and `steering/`, not `server/`.
The Agent Plugins layout (`plugin.json`, args with `${PLUGIN_ROOT}`) does copy `server/` and the server connects, but
its working directory is the install folder, so it cannot find the user's workspace: Kiro does not expand
`${workspaceFolder}`, does not answer `roots/list`, and cancels elicitation requests.

Decision (project owner): the agent passes the workspace on every call.
1. **Packaging.** Make `power/` installable so that `server/` is copied and started from the install folder
   (`plugin.json` and `${PLUGIN_ROOT}` per the 11-07 findings; check kiro.dev/docs/powers and the Agent Plugins schema
   for what a Power needs today, and keep `POWER.md` and `steering/` working). No auto-approve. The workspace
   `.kiro/settings/mcp.json` keeps working exactly as today.
2. **Agent-supplied workspace mode.** A new launch flag (for example `--workspace-from-agent`), used only by the
   Power's `mcp.json`. In this mode every tool takes a required `workspace` argument: an absolute path to the folder the
   user has open. The server resolves it with realpath and rejects it unless it is an existing directory that is not
   the filesystem root and not the user's home directory itself (`os.homedir()` realpath). Then exactly the same
   confinement as today applies inside it: the image must resolve inside `workspace`, no symlinks, regular files only,
   size cap, and `exhume` writes only into `<workspace>/exhumed/` without overwriting. The `workspace` argument is
   untrusted input like every other argument; errors reveal no path outside it.
3. **Default mode unchanged.** Without the flag (`--root <dir>` or the working directory) the tool schemas, behavior
   and every existing test stay the same.
4. Tool descriptions, `POWER.md` and `power/steering/` tell the agent to pass the absolute path of the open workspace
   folder and to treat disk content as data. `README.md` and `POWER.md` drop "NOT WORKING YET" only after the manual
   check below; until then they say "built, awaiting manual verification".
5. Update `.kiro/steering/safety.md` line "Tools take an image path that must resolve inside the workspace root" to
   cover both modes (the root is fixed at start, or given per call by the agent and shown to the user in the approval
   prompt). Record the accepted risk in the README "Accepted residual risks" list: in this mode the confinement root
   is chosen by the agent, and the user sees it in each approval prompt.

Tests: properties for the new mode (any relative, missing, non-directory, symlinked, `/` or home `workspace` is
rejected; images and writes never escape the given workspace; the default mode's schemas are unchanged), hostile
inputs for the new argument, a stdio test that starts the bundle with the flag. Rebuild the bundle with
`npm run build:mcp` only after the project owner approves (config hash check, as before).
Manual check after merge (by the project owner): install the Power from `power/` in Kiro, open
`fixtures/real-disks/freedos13/fd13-720k-dsk01.img` through it, exhume one file.
Out of scope: publishing to npm or any registry, remote servers, changes to the web page.

## Spec 9 — ui-polish (after a screenshot review, 2026-11-09)
Reviewed at 1440×900 and 390×844 with headless Chromium: no console errors, no horizontal scroll, a sensible Tab
order, and all three demo disks open and preview. Polish for the Design criterion. Scope `src/web/`, `index.html` and
their tests only; CSP, `textContent` rules and `safety.md` apply; no new runtime dependency.
1. **Say what it is (high).** Above the drop zone, one short line and a compact list: what Exhume does (open old DOS
   floppy images in the browser, read WordStar, dBase III, PCX and text files as Markdown, CSV, PNG and text, show
   deleted files and how much of each can come back) and the privacy line that already exists. A link to the GitHub
   repository (`https://github.com/tsang326/exhume`). Claims must match the README; no numbers that are not there.
2. **Page title (high).** `<title>` is "Exhume - REVENANT.OS", a leftover of an earlier concept. Make it
   "Exhume - read old floppy disks in your browser" (or similar), and add a meta description.
3. **Background seam (high).** The background layer is one viewport tall; below it the page is flat, with a visible
   edge (about 900 px on desktop, 750 px on mobile). It must cover the whole page at any length.
4. **Empty graveyard (medium).** Before any disk is opened, the "Graveyard" heading shows over nothing. Hide it, or
   show one line of guidance ("Open a disk to see its files").
5. **Mobile flow (medium).** On a narrow screen, after a disk opens, the graveyard sits below three tall demo cards.
   Move focus/scroll to the graveyard summary after a successful open (respect `prefers-reduced-motion` for smooth
   scrolling), and keep the demo list usable.
6. **Readable previews (medium).** Markdown previews run paragraphs together. Add paragraph spacing so a converted
   document reads like a document (rendering stays DOM nodes + `textContent`).
7. **Deleted graves (medium).** The open-grave icon is a small dark smudge. Make deleted entries clearly visible and
   distinct by state (recovered / partial / lost) without relying on color alone. Explain the leading `_` of a
   deleted 8.3 name (DOS overwrote the first letter on delete) in the grave's text or an accessible hint.
8. **Small things (low).** The orphan "6 of 6" line: give it context or merge it into the summary. Mark the demo disk
   that is currently open (`aria-pressed` or `aria-current`).
9. **Spooky layer (optional, last).** Code-drawn, translucent fog or lantern light in the existing effects layer,
   never covering text, off under `prefers-reduced-motion`, no images or libraries. Skip if it costs readability.
Tests: DOM tests for each item (title, intro text and link, guidance before open, focus after open, `aria-pressed`,
state labels, paragraph spacing classes), existing tests stay green, `make:demos -- --check` unchanged. Out of scope:
new formats, core or MCP changes, deployment.
