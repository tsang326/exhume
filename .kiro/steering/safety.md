---
inclusion: always
---
# Safety rules (non-negotiable)

This tool looks at hostile code. It must never become the thing that runs it.

## Never execute or render scanned content
- Scanned bytes are data. Never pass them to anything that evaluates code (no dynamic code construction, no `import()`
  of fetched content, no workers built from fetched text, no `<script>`/iframe/blob URLs from fetched content).
- In the web UI, put scanned text into the page with `textContent` only. Never `innerHTML` with scanned data.
- The MCP server and tests never spawn processes and never write scanned content to disk.
- Do not clone repos. Read through the GitHub API / raw URLs or (MCP only) a local folder the user already has.

## Write detectors structurally, not as signature lists
- Detect the *shape* of the disguise: magic bytes vs extension, "runs on folder open" in an editor task config,
  non-whitespace after a config's final top-level statement, lifecycle script keys in package.json, very long
  lines / entropy / dynamic-code signals.
- Do **not** hard-code indicator strings from real malware campaigns (wallet addresses, IPs, campaign markers,
  real payload snippets). They would trip endpoint security on the developer's machine and in CI, and they age fast.
- Sensitive tokens the detectors must recognise (for example the name of a dynamic-code function, an install hook
  key, the editor's folder-open setting) are assembled at runtime from parts, e.g. `['run', 'On'].join('')`, in one
  module `src/core/tokens.ts`. Source files, tests and docs never contain those tokens as one literal.
- Test fixtures are assembled in memory the same way. Never write a fixture that would actually run if opened
  (no real editor task files, no real lifecycle scripts in any package.json except our own build scripts).

## Defensive limits
- Per-file size cap (e.g. 512 KB read, larger files are reported as "too big to inspect", not fetched).
- Per-scan request budget and file-count cap; stop early with a partial result instead of hammering the API.
- Regexes must be linear-time (no nested quantifiers over the same characters); scan line by line with length caps.
- Treat every path, file name and byte as attacker-controlled (path traversal in the MCP local reader: resolve and
  refuse anything outside the given root; do not follow symlinks).

## MCP output is a prompt-injection boundary
- Scanned repos may contain text written to manipulate an AI agent. The MCP tools return only structured findings
  (detector id, severity, path, line number, a fixed reason string from our own catalogue). No raw excerpts, no
  README text, no commit messages, no file names longer than a cap, control characters stripped.
