# Exhume

Your old disks aren't dead. They're buried.

Drop a DOS floppy image into the page and its files appear as a graveyard. Deleted files are open graves you can
dig up. WordStar documents rise as Markdown, dBase tables as CSV, PCX pictures as PNG. Everything runs in your
browser; nothing is uploaded.

Also ships as an MCP server / Kiro Power and a Kiro Crew app, so an agent can open a floppy image and exhume files
into your project.

Prior art: [disk-peek](https://github.com/andete/disk-peek) already browses FAT12 images and recovers deleted
entries in the browser.

Kiroween 2026, Resurrection category. Built with [Kiro](https://kiro.dev) (see `/.kiro` and `docs/KIRO_LOG.md`).

## Run
```bash
npm install
npm run dev      # http://localhost:5173
npm test
```

## MCP server and Kiro Power

Exhume ships as a local stdio MCP server (`power/server/exhume-mcp.mjs`) wrapped in a Kiro Power (`power/`). It is a
hand-written JSON-RPC 2.0 server with no SDK and no runtime dependency. Disk content is untrusted data: every name,
label and text it returns is sanitized and marked as untrusted.

Status: the Power is PROVISIONAL. Its layout and format have not been installed or verified in Kiro yet, and nothing
here should be read as confirmed until you have installed it and checked it yourself (see "Unconfirmed Power format
points" below).

### Tools
- `open_disk`: open a disk image inside the workspace and list its files with state (`alive`, `recovered`, `partial`,
  `lost`), size and date.
- `read_grave`: convert one file and return a preview (Markdown or CSV text, or PNG dimensions). Takes `image`, `path`
  and an optional integer `id` from the `open_disk` listing, for when two entries share a path.
- `exhume`: convert one file and write the full result into the `exhumed/` folder of the workspace. It never
  overwrites an existing file.
- `explain_state`: return a fixed explanation of one state.

`exhumed/` is the only place the server writes. It is git-ignored.

### Platforms
macOS and Linux are supported. Windows is unsupported: Node has no `O_NOFOLLOW` there, so the no-symlink guarantee
cannot be given and the server refuses to start.

### Build and run
`power/server/exhume-mcp.mjs` is a committed build, refreshed with `npm run build:mcp`. Running that command is a
manual step for you. You can start the server by hand with:

```bash
node power/server/exhume-mcp.mjs [--root <dir>]
```

Without `--root` the server uses its working directory as the workspace root. It reads one JSON-RPC message per line
on standard input.

### Install in Kiro (manual steps, for you)
1. Build: `npm run build:mcp`.
2. In Kiro open the Powers panel, choose "Add power from Local Path" and select the `power/` folder.
3. For the workspace server, Kiro reads `.kiro/settings/mcp.json`. The intended content is a single `exhume` entry:
   ```json
   { "mcpServers": { "exhume": { "command": "node", "args": ["power/server/exhume-mcp.mjs"] } } }
   ```
   That file may not exist in your checkout yet (writing it was blocked for the agent). If it is missing, create it
   with this content. The Power's own `power/mcp.json` has the same single entry with the script path
   `server/exhume-mcp.mjs`.
4. If Kiro starts the server somewhere other than the workspace root, image calls fail closed with `PATH_REJECTED`
   and expose nothing. Fix it by appending `"--root", "<absolute workspace path>"` to the `args` array of the single
   `exhume` entry, in `power/mcp.json` or `.kiro/settings/mcp.json`. That `args` array is the only place `--root`
   goes. Example:
   ```json
   { "mcpServers": { "exhume": { "command": "node", "args": ["power/server/exhume-mcp.mjs", "--root", "/absolute/path/to/workspace"] } } }
   ```

### Power format points
Confirmed only from public example powers: the `POWER.md` frontmatter fields (`name`, `displayName`, `description`,
`keywords`, `version`, `author`) and the general layout of `POWER.md`, `mcp.json` and `steering/`.

Unconfirmed until you install `power/` and report what Kiro shows:
1. Whether Kiro accepts this `POWER.md` frontmatter and shows the power.
2. Whether Kiro loads `steering/floppy-images.md` from a `steering/` folder, or needs another name, location or
   activation field.
3. Whether a power-level `mcp.json` accepts a local stdio server (`command` and `args`) rather than only `url`
   servers.
4. How `server/exhume-mcp.mjs` is resolved in a power's `mcp.json`: relative to the power directory, the workspace
   root or the process working directory.
5. Which working directory Kiro gives the server, which decides whether `--root` is needed.
6. Whether the current "Agent Plugins specification" changes any of the above.

### Accepted residual risks
Path checks confine image reads to the workspace (no `..` escape, no symlinks, regular files only, size cap). Two
risks are accepted and not hidden:
- Node has no resolve-beneath open (`openat2` with `RESOLVE_BENEATH`). A local process that can already write inside
  the workspace could, in a window of microseconds, swap a directory for a symlink and back between the checks and the
  open. The server re-verifies the path and the file identity after opening, which narrows the window but cannot close
  it.
- A hard link inside the workspace to a file elsewhere on the same file system cannot be detected, so such a link is
  read as an ordinary file.

## License
MIT
