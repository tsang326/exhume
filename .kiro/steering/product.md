---
inclusion: always
---
# Product: Exhume

Dead floppy disks, raised from the grave. Kiroween 2026, **Resurrection** category
("bring your favorite dead technology back to life; reimagine obsolete tech with today's innovations").

## What it does
1. Drop a 1980s/90s DOS floppy image (FAT12 `.img`/`.ima`, 160 KB–1.44 MB) onto the page.
2. Every file appears as a tombstone in a graveyard (name, size, date from the directory entry).
   Deleted files (directory entries marked deleted) appear as **open graves** that can be undeleted.
   Undelete is honest: a file whose clusters were contiguous and unallocated is "recovered"; anything else is
   "partial" or "lost", with the reason shown.
3. Click a tombstone and the file rises in a format people use today:
   - **WordStar** documents → Markdown (the anchor: no common tool opens these; LibreOffice has no WordStar filter),
   - **dBase III** tables (`.dbf`) → CSV,
   - **PCX** images → PNG.
   Other files are offered as raw downloads with a hex/text preview.
4. Everything runs in the browser. Nothing is uploaded. Static hosting, $0 until judging ends (29 Jan 2027).
5. The same core ships as:
   - an **MCP server + Kiro Power**, so Kiro's agent can open a floppy image in the workspace, list its graves and
     exhume a file into the project (the demo's second act);
   - a **Kiro Crew app** (separate repo) that packages the MCP server, an agent, a skill and a graveyard dashboard page.

## Audience and pitch
People with boxes of old floppies (writers, researchers, archivists, families) and the agents that now help them.
Pitch: "Your old disks aren't dead. They're buried."

## Judging priorities (cash prizes only)
Resurrection category prize, Best Demo (presentation), Best Kiro Crew App (needs top 50 overall).
So, in order: it never breaks on a judge's file > the unmasking/exhuming moment is beautiful on video >
the Kiro story (specs, hooks, PBT, MCP, Power, Crew) is deep and honest > feature count.

## Honesty rules for all public text
- Credit prior art: andete/disk-peek already browses FAT12 images and recovers deleted entries in the browser.
  Never claim "first browser undelete". Our new parts: format resurrection (WordStar/dBase/PCX), the agent-facing
  MCP/Power/Crew packaging, and the honest recovered/partial/lost grading.
- Demo disk images are made by our own generator script and say so.
