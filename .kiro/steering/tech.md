---
inclusion: always
---
# Tech rules

- TypeScript, strict, no `any`. Vite for the web page. No UI framework. Node 20+ for the MCP server.
- Layout:
  - `src/core/` — the detector core. Pure functions over `{ path, bytes: Uint8Array }` and repo metadata.
    No DOM, no `fs`, no network, no Node-only APIs. Shared by the web page and the MCP server.
  - `src/fetch/` — GitHub tree/blob fetching with size caps, a request budget and rate-limit handling.
    Injectable `fetch` so tests never touch the network.
  - `src/web/` — the page (unmasking UI, effects). Talks to `core` and `fetch` only.
  - `src/mcp/` — stdio MCP server built on the official `@modelcontextprotocol/sdk`. Reuses `core` and `fetch`
    (plus a local-folder reader for already-cloned repos, read-only).
  - `power/` — the Kiro Power packaging (plugin manifest, MCP config, skill docs).
- Findings have one shape everywhere: `{ detector, severity: 'high'|'medium'|'low', path, line?, reason, evidence? }`.
  `evidence` is a short, escaped excerpt for the web UI only. The MCP response never includes file contents.
- Tests: Vitest + fast-check, `src/**/*.test.ts`. Every detector gets property-based tests for both directions:
  "real files of this type are never flagged" and "the disguise is always flagged, wherever it is placed".
  A fast-check property callback must return nothing or a boolean, never `expect(...)`.
- Fixtures are built in memory inside the tests (byte arrays, strings assembled at runtime). No fixture files that
  look like the real attack on disk.
- No new runtime dependency without a reason in the commit message. Prefer zero runtime deps in `core`.
- Hosting: static build on Vercel or GitHub Pages. No backend, no secrets.
