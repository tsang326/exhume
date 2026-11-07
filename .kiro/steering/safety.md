---
inclusion: always
---
# Safety rules (non-negotiable)

A disk image is untrusted bytes from a stranger. Every name, size, date, cluster number and byte in it is
attacker-controlled.

## Parsing limits
- Bound everything: image size (≤ 2.88 MB accepted), cluster chain length (≤ number of clusters, cycle detection),
  directory depth (≤ 16) and entry count, output size per file (≤ declared size and ≤ 4 MB), image dimensions for
  PCX (≤ 4096×4096 and ≤ 16 M pixels). On violation: stop that item, add a warning, continue with the rest.
- No recursion without a depth counter. Loops always have a hard iteration cap.
- Regexes linear-time only; never run a regex over a whole untrusted file without a length cap.

## Web page
- Untrusted text goes into the DOM with `textContent` only, never `innerHTML`.
- Downloads use Blob URLs with a fixed safe MIME type (`text/markdown`, `text/csv`, `text/plain`, `image/png`,
  `application/octet-stream`) and a sanitized file name.
- Strict CSP on the page: `default-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'`.
  `connect-src 'self'` allows same-origin static files only, for demo disks; `fetch` is allowed only in `src/web/demos.ts`.
  The page never sends disk bytes anywhere.

## MCP server (the agent boundary)
- Tools take an image path that must resolve (realpath) inside the workspace root; refuse symlinks and anything outside.
- The only write tool exhumes into one fixed folder (`exhumed/`). No destination argument. File names are rebuilt
  from an allowlist (`[A-Za-z0-9._-]`, max 64 chars), the extension is chosen by the converter, never overwrite.
- Output to the agent is structured JSON with caps (entries, text length). Converted text is wrapped and labeled as
  untrusted content from the disk; control characters stripped. Never put disk text into tool descriptions or errors
  that the agent might read as instructions.
- No auto-approve in any shipped `mcp.json`. The `exhumed/` folder is excluded from every hook glob and test glob.
- The Power and the Crew app run a pinned, committed build of the server — never an unpinned `npx`/`latest` fetch.

## General
- Never execute anything found on a disk image. Never write outside the paths above. No network calls in core, web
  or MCP, except the same-origin demo-disk fetch in `src/web/demos.ts`.
