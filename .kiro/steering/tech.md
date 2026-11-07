---
inclusion: always
---
# Tech rules

- TypeScript, strict, no `any`. Vite for the web page, no UI framework. Node 22+ for the MCP server.
- Layout:
  - `src/core/` — pure, dependency-free: FAT12 reader (boot sector/BPB, FAT, root dir, subdirs, cluster chains),
    undelete grading, format converters (`wordstar`, `dbase`, `pcx`), PNG encoder (stored/deflate via
    `CompressionStream` or a tiny pure encoder). Input is `Uint8Array`. No DOM, no Node APIs, no I/O.
  - `src/web/` — the graveyard page. Uses `core` only.
  - `src/mcp/` — a hand-written JSON-RPC 2.0 stdio server (one message per line), no SDK and no runtime
    dependency; a thin wrapper over `core` plus a workspace-confined file reader and writer, built with
    `npm run build:mcp` into the committed `power/server/exhume-mcp.mjs`.
  - `power/` — Kiro Power packaging (manifest, `mcp.json`, skill docs).
  - `scripts/make-demo-disks.ts` — deterministic generator for the demo floppy images (with deleted files and
    sample WordStar/dBase/PCX files we author ourselves).
  - The Crew app lives in a separate repo and depends on a pinned build of this MCP server.
- One result shape: `DiskReport { volume, files: Grave[], warnings[] }`, `Grave { path, size, date, state:
  'alive'|'recovered'|'partial'|'lost', kind, reason? }`. Web, MCP and Crew all use it.
- Tests: Vitest + fast-check in `src/**/*.test.ts`.
  - Round-trip property: generate random file sets → build a FAT12 image (test-only image writer) → read back →
    same names/sizes/bytes.
  - Hostile-input properties: random bytes, cyclic FAT chains, out-of-range clusters, self-referencing directories,
    absurd sizes → the reader returns a report with warnings and never throws, hangs or allocates without bound.
  - Converter properties: never throw on random bytes; known fixtures convert to known output.
  - A fast-check property callback returns nothing or a boolean, never `expect(...)`.
- No new runtime dependency without a reason in the commit message; `core` has zero runtime deps.
- Hosting: static build (GitHub Pages or Vercel). No backend, no secrets, no analytics.
