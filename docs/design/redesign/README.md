# Page redesign mockup (Spec 11)

`mockup.html` is the owner-approved target for Spec 11. Open it with any static server from this folder
(for example `python3 -m http.server` here, then `/mockup.html`).

- Demo disks, graveyard rows and previews in the mockup are hard-coded copies of real `make:demos` output.
- The "Open a disk image" button needs `core.js`, a local esbuild bundle of `src/core` that is not committed;
  without it, only the demo part works. The real app uses its worker instead.
- `type/`: Instrument Serif and Hanken Grotesk, SIL Open Font License 1.1 (licence texts included).
- `assets/disk35.jpg`, `assets/disks-band.jpg`: crops of "Floppy disk 2009 G1" by George Chernilevsky,
  public domain, via Wikimedia Commons (`assets/credits.json`).
- `screens/`: the mockup at 1440, 768 and 390 px wide.
