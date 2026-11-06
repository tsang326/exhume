---
inclusion: always
---
# Product: Possessed?

"Is this repo possessed?" A pre-clone scanner for GitHub repositories, entered in the Kiroween 2026
**Costume Contest** category (any app, with a haunting UI whose spooky design serves the function).

## The problem
Developers get repos from strangers every day: take-home tests, "job interview" projects, PR links, starter kits.
A known malware pattern hides code in places nobody reads before opening the folder: a "font" file that is really
JavaScript, an editor task that runs automatically when the folder is opened, code appended after the last line of a
build config, install lifecycle scripts in package.json. By the time you open it in your editor it has already run.

## What it does
1. Paste a GitHub URL. The page reads the repo tree and the risky files through the public GitHub API and
   raw.githubusercontent.com, **in the browser, without cloning and without executing anything**.
2. Structural detectors look for disguises (see `safety.md` for how they are written):
   - file bytes that do not match the extension (a font, image or archive whose bytes are text/script);
   - editor tasks configured to run on folder open;
   - code after the final closing statement of a config file (vite/webpack/next/eslint configs);
   - install lifecycle scripts and what they call;
   - obfuscation signals: very long single lines, high-entropy strings, dynamic code construction.
3. The **unmasking** UI: each suspicious file is shown in its costume (icon, name, claimed type) and then unmasked to
   reveal its real bytes, with the exact lines that triggered the finding. Clean repos get a calm "no spirits here".
4. The same detector core runs as an **MCP server packaged as a Kiro Power**, so an agent (Kiro) can ask
   "is this repo safe to open?" before cloning or opening it. The MCP returns structured findings only.

## Audience and pitch
Developers who receive code from strangers (job seekers, reviewers, maintainers), and the AI agents that now clone
repos for them. Pitch: "check a repo before it checks you".

## Priorities, in order
1. Never harm the person using it: never execute scanned content, never render it as HTML.
2. No false alarms on ordinary repos (a clean popular repo must come back clean).
3. The unmasking is polished and memorable.
4. Feature count.

Judges can use it until 29 Jan 2027 at zero cost to us: static hosting, no backend, no paid API.
GitHub's unauthenticated API limit (60 requests/hour per IP) must be handled gracefully (clear message, optional
user token kept only in memory).
