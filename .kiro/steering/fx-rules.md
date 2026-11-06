---
inclusion: fileMatch
fileMatchPattern: ["src/fx/**", "src/ui/**", "src/**/*.css"]
---
# Visual rules

- Effects are code-drawn and translucent (CSS/canvas/shaders): scanlines, vignette, chromatic aberration, text glitch, noise.
  Only solid objects (icons, file thumbnails) may be images.
- Palette: near-black background, phosphor green and amber, rare red for danger. Monospace, slightly broken retro type.
- Respect `prefers-reduced-motion`: keep the dread, drop the flashing. No full-screen flashes faster than 3 per second.
- Must stay readable and playable at 1280×720 and on a laptop screen; mobile is best effort.
