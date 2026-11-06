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
