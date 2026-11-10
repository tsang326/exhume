# Requirements Document

## Introduction

A screenshot review of the Exhume page (2026-11-09) used headless Chromium at 1440×900 and 390×844. It found no console errors, no horizontal scroll, a sensible Tab order, and all three Demo_Disks opening and previewing. It also found design problems that hurt the Design criterion of the hackathon. This spec fixes them. The nine items are:

1. The page never says what it is. Above the drop zone there is only the heading "Exhume" and the privacy note.
2. The `<title>` is "Exhume - REVENANT.OS", a leftover of an earlier concept, and the page has no meta description.
3. The Effects_Layer is one viewport tall (`#fx-host` is `position: fixed`); below it the page shows a flat background with a visible edge, about 900 px on desktop and 750 px on mobile.
4. Before any disk is opened, the "Graveyard" heading shows over nothing.
5. On a narrow screen, after a disk opens, the Graveyard sits below three tall Demo_Cards and the user is not taken to it.
6. Markdown previews run paragraphs together.
7. The open-grave icon is a small dark smudge, the state label is the raw state word, and nothing explains the leading `_` of a deleted 8.3 name.
8. The progress line (for example "6 of 6") has no context, and the Demo_Cards do not show which disk is open.
9. Optional and last: a code-drawn fog or lantern layer that adds atmosphere without costing readability.

Scope is `src/web/`, `index.html`, `src/style.css` (the stylesheet that `index.html` loads through `src/main.ts`) and their tests. Out of scope: new formats, changes to `src/core/`, `src/mcp/` or `power/`, the Demo_Disks themselves, the Crew app and deployment.

The steering rules apply. The Page keeps the CSP in `index.html`. Text that comes from a Disk_Image (names, labels, reasons, converted text) enters the DOM with `textContent` or Text nodes only, never `innerHTML`. No new runtime dependency is added, and no image, font or script is fetched from another origin. Public text follows the honesty rules: every claim matches the README, the prior art (andete/disk-peek) stays credited, and no number appears that the README does not contain.

## Glossary

- **Page**: The static web page built from `index.html`, `src/main.ts`, `src/style.css` and `src/web/`.
- **Intro_Block**: The new static content above the Drop_Zone that says what Exhume does: one summary sentence, a short list of capabilities, and the Privacy_Note.
- **Privacy_Note**: The existing element `#privacy-note` with the text "Your files stay in this browser. Nothing is uploaded."
- **Repo_Link**: An anchor in the Page whose `href` is `https://github.com/tsang326/exhume`.
- **Drop_Zone**: The element `#drop-zone` that accepts a dropped or chosen disk image.
- **Graveyard**: The element `#graveyard` and the view that `createGraveyardView` in `src/web/dom/graveyard.ts` renders into it.
- **Graveyard_Heading**: The `h2` with id `graveyard-heading` created by the Graveyard view.
- **Graveyard_Summary**: The `p.graveyard-summary` line that reads "<label>: <n> files, <m> directories".
- **Progress_Line**: The `p.graveyard-progress` line built from `progressText` in `src/web/logic/paging.ts`, which reads "<shown> of <total>".
- **Demo_Slot**: The element built by `createDemoSlot` in `src/web/dom/demo-slot.ts`, mounted in `#demo-slot`.
- **Demo_Card**: One `button.demo-slot-button` in the Demo_Slot.
- **Open_Disk**: The Demo_Disk whose bytes are currently shown in the Graveyard. A disk opened from a dropped or chosen file has no Demo_Card, so it leaves every Demo_Card unmarked.
- **Demo_Disks**: The three images in `public/disks/` produced by `scripts/make-demo-disks.ts`.
- **Demo_Check**: The command `npm run make:demos -- --check`, which compares the generated Demo_Disks with the committed ones.
- **Effects_Layer**: The element `#fx-host`, its CSS pseudo-elements and the canvas that `src/web/dom/effects.ts` draws into it.
- **Reduced_Motion**: The browser state where the media query `(prefers-reduced-motion: reduce)` matches.
- **Narrow_Viewport**: A viewport 600 CSS pixels wide or less.
- **Preview_Dialog**: The dialog rendered into `#preview-root` by `src/web/dom/preview.ts`.
- **Markdown_Preview**: The part of the Preview_Dialog that shows converted Markdown as DOM nodes built from `src/web/logic/markdown.ts`.
- **Paragraph**: A block of Markdown text separated from the next block by a blank line, rendered as one `p` element.
- **Grave_Item**: One `li.grave` in the Graveyard.
- **Deleted_Grave**: A Grave_Item whose state is `recovered`, `partial` or `lost`.
- **State_Cue**: A non-color signal on a Grave_Item that identifies its state: a text label together with a distinct shape or icon.
- **Underscore_Hint**: A text explanation on a Deleted_Grave that the first character of a deleted 8.3 file name is lost, so the name shows a leading `_`.
- **Existing_Tests**: Every test file that passes before this spec's changes, including `src/web/page.static.test.ts`, the DOM tests in `src/web/` and `src/web/dom/`, and `src/web/dist.build.test.ts`.
- **README**: The file `README.md` at the repository root.
- **Safety_Rules**: The rules in `.kiro/steering/safety.md` and `.kiro/steering/tech.md`.

## Requirements

### Requirement 1: Say what Exhume is

**User Story:** As a first-time visitor, I want the page to explain what it does before I drop anything, so that I know whether it can help me with my old floppies.

#### Acceptance Criteria

1. THE Page SHALL contain an Intro_Block that precedes the Drop_Zone in document order.
2. THE Intro_Block SHALL contain one sentence that says Exhume opens old DOS floppy images in the browser.
3. THE Intro_Block SHALL contain a list with one item for each of these capabilities: WordStar documents read as Markdown, dBase III tables read as CSV, PCX pictures read as PNG, plain text files read as text, and deleted files shown with how much of each can come back.
4. THE Intro_Block SHALL contain the Privacy_Note.
5. THE Page SHALL contain a Repo_Link whose accessible name identifies the GitHub repository.
6. THE Intro_Block SHALL state each claim in terms that the README supports and SHALL contain no numeric figure that does not appear in the README.
7. THE Page SHALL keep the existing `#honesty-note` that credits andete/disk-peek.
8. THE Intro_Block SHALL consist of static markup in `index.html` and SHALL contain no text derived from a Disk_Image.
9. THE Page SHALL keep every element id listed in the element contract comment of `index.html`.

### Requirement 2: Correct page title and description

**User Story:** As a visitor reading a browser tab, a bookmark or a search result, I want a title and description that describe the tool, so that I can recognise it.

#### Acceptance Criteria

1. THE Page SHALL have the `<title>` "Exhume - read old floppy disks in your browser".
2. THE Page SHALL contain one `<meta name="description">` element whose `content` is a non-empty sentence of at most 160 characters that describes opening old DOS floppy images in the browser.
3. THE Page SHALL contain no occurrence of the text "REVENANT.OS" in `index.html`, `src/main.ts`, `src/style.css` or `src/web/`, apart from tests that assert its absence.
4. THE meta description SHALL satisfy the claim rules of Requirement 1 criterion 6.
5. THE Page SHALL keep the Content-Security-Policy meta element in `index.html` unchanged.

### Requirement 3: Background covers the whole page

**User Story:** As a visitor scrolling a long graveyard, I want the background to continue to the bottom of the page, so that the page does not look cut off.

#### Acceptance Criteria

1. THE Page SHALL render the background and the Effects_Layer behind the content over the full scrollable height of the document, whatever the content length.
2. WHEN the document is taller than the viewport, THE Page SHALL show no visible edge or flat band where the background layer ends, at 1440×900 and at 390×844.
3. THE Page SHALL keep every text element above the Effects_Layer in stacking order.
4. THE Effects_Layer SHALL receive no pointer events.
5. THE Page SHALL cause no horizontal scrolling at 1440×900 and at 390×844.
6. THE Page SHALL keep the text contrast pairs that the existing contrast tests in `src/web/logic/contrast.test.ts` check.

### Requirement 4: Empty graveyard guidance

**User Story:** As a visitor who has not opened a disk, I want to see guidance instead of an empty section, so that I know what to do next.

#### Acceptance Criteria

1. WHILE no disk has been opened, THE Graveyard SHALL show the line "Open a disk to see its files." and SHALL NOT show the Graveyard_Heading, the Graveyard_Summary, the Progress_Line or the "Show more" button.
2. WHEN a disk image opens successfully, THE Graveyard SHALL hide the guidance line and show the Graveyard_Heading.
3. IF a disk image fails to open and no earlier disk is shown, THEN THE Graveyard SHALL keep showing the guidance line.
4. IF a disk image fails to open while an earlier disk is shown, THEN THE Graveyard SHALL keep showing the earlier disk and SHALL NOT show the guidance line.
5. THE Graveyard SHALL keep the element `#graveyard` as its mount point and SHALL keep the heading id `graveyard-heading`, so that the `aria-labelledby` reference on the list stays valid.
6. WHILE the guidance line is visible, THE Graveyard_Heading SHALL be absent from the accessibility tree.

### Requirement 5: Move to the graveyard after a successful open

**User Story:** As a mobile user who taps a demo disk, I want the page to take me to the files that opened, so that I do not have to scroll past the demo cards to find them.

#### Acceptance Criteria

1. WHEN a disk image opens successfully, THE Page SHALL move keyboard focus to the Graveyard_Heading.
2. WHEN a disk image opens successfully, THE Page SHALL scroll the Graveyard_Heading into view.
3. WHILE Reduced_Motion is off, THE Page SHALL scroll with smooth behavior.
4. WHILE Reduced_Motion is on, THE Page SHALL scroll with instant behavior.
5. IF a disk image fails to open, THEN THE Page SHALL leave focus and scroll position unchanged and SHALL show the existing error text in the status element.
6. WHILE the Preview_Dialog is open, THE Page SHALL leave focus unchanged when a disk image opens.
7. THE Page SHALL keep the Demo_Slot and the Demo_Cards in the document, visible and operable by keyboard and pointer, at 1440×900 and at 390×844.
8. WHERE the viewport is a Narrow_Viewport, THE Demo_Slot SHALL present the Demo_Cards in a layout whose total height is lower than the stacked height of three Demo_Cards at full text width on the current design.
9. WHEN the focused Graveyard_Heading receives focus, THE Page SHALL announce the Graveyard_Summary through the Graveyard region, so that screen reader users hear the disk label and counts.

### Requirement 6: Readable Markdown previews

**User Story:** As a user reading a converted WordStar document, I want paragraphs to look like paragraphs, so that the text reads like a document.

#### Acceptance Criteria

1. THE Markdown_Preview SHALL render each Paragraph as its own `p` element.
2. THE Markdown_Preview SHALL separate adjacent Paragraphs by a vertical gap of at least 0.75em, set through a stylesheet class.
3. THE Markdown_Preview SHALL set a line height of at least 1.4 on its text.
4. THE Markdown_Preview SHALL build every text node from converted Disk_Image text through `textContent` or Text nodes.
5. THE Markdown_Preview SHALL keep the nesting depth and node limits that `src/web/logic/markdown.ts` enforces.
6. WHEN the converted Markdown holds N Paragraphs separated by blank lines, THE Markdown_Preview SHALL contain N `p` elements for them.
7. THE Preview_Dialog SHALL keep its focus trap, its inert background and its blob-URL handling unchanged.

### Requirement 7: Distinct, explained deleted graves

**User Story:** As a user looking at a disk with deleted files, I want to see at a glance which graves are deleted and how recoverable each is, so that I do not mistake them for ordinary files or rely on color to tell them apart.

#### Acceptance Criteria

1. THE Graveyard SHALL render each Deleted_Grave with an icon that is clearly visible against the page background and larger than the current open-grave icon.
2. THE Graveyard SHALL give each of the states `recovered`, `partial` and `lost` its own State_Cue, made of a visible text label and a shape or icon that differs between the three states.
3. THE Graveyard SHALL keep the state text label visible on every Grave_Item.
4. THE Graveyard SHALL show state differences by means other than hue alone, so that the three Deleted_Grave states stay distinguishable in a grayscale rendering.
5. WHEN a Deleted_Grave has a name that begins with `_`, THE Graveyard SHALL show the Underscore_Hint on that Grave_Item, either as visible text or through an accessible description.
6. THE Underscore_Hint SHALL say that DOS overwrote the first letter of the name when the file was deleted.
7. THE Graveyard SHALL show no Underscore_Hint on an `alive` Grave_Item.
8. THE Graveyard SHALL render the file name, path and reason of each Grave_Item as Text nodes, never as markup.
9. THE Graveyard SHALL keep the fields of the `ItemViewModel` interface that existing consumers read, and may add fields.
10. THE Graveyard SHALL keep the text contrast pairs checked by `src/web/logic/contrast.test.ts` and SHALL add a check for any new foreground and background pair.

### Requirement 8: Progress line context and current-disk marker

**User Story:** As a user, I want the count line to say what it counts and the demo list to show which disk is open, so that I can follow where I am.

#### Acceptance Criteria

1. THE Graveyard SHALL show the Progress_Line as part of, or directly attached to, the Graveyard_Summary, so that it does not stand as an orphan line.
2. THE Progress_Line SHALL name the thing counted, in the form "Showing <shown> of <total> items".
3. WHEN the Graveyard shows all items, THE Progress_Line text SHALL still read "Showing <total> of <total> items" with the real totals.
4. WHEN the user activates "Show more", THE Progress_Line SHALL update to the new shown count.
5. WHEN a Demo_Card opens its disk successfully, THE Demo_Slot SHALL set `aria-pressed="true"` on that Demo_Card and `aria-pressed="false"` on every other Demo_Card.
6. WHEN a disk opens that does not come from a Demo_Card, THE Demo_Slot SHALL set `aria-pressed="false"` on every Demo_Card.
7. THE Demo_Slot SHALL show the pressed state with a visible cue that does not rely on color alone.
8. IF a Demo_Card fails to load its disk, THEN THE Demo_Slot SHALL leave the previous `aria-pressed` values unchanged.
9. THE Demo_Slot SHALL keep each Demo_Card a native `button` with its title and description as text.

### Requirement 9: Spooky layer (optional, last)

**User Story:** As a visitor, I want a little drawn fog or lantern light, so that the page feels haunted without making it harder to read.

#### Acceptance Criteria

1. WHERE the spooky layer is implemented, THE Effects_Layer SHALL draw translucent fog or lantern light in code, using CSS gradients or the existing canvas in `src/web/dom/effects.ts`.
2. WHERE the spooky layer is implemented, THE Effects_Layer SHALL use no image file, no font file, no library and no network request.
3. WHERE the spooky layer is implemented, THE Page SHALL keep it behind all text and without pointer events.
4. WHERE the spooky layer is implemented, WHILE Reduced_Motion is on, THE Effects_Layer SHALL show no animation.
5. WHERE the spooky layer is implemented, THE Page SHALL keep the existing frame-rate and shape-count limits (`FX_MAX_FPS`, `FX_MAX_SHAPES`).
6. WHERE the spooky layer is implemented, THE Page SHALL keep the contrast pairs checked by `src/web/logic/contrast.test.ts`.
7. IF the spooky layer lowers text contrast below those pairs or covers text, THEN THE implementer SHALL drop the spooky layer and keep requirements 1 to 8.
8. THE implementer SHALL deliver requirement 9 after requirements 1 to 8 are complete and their tests pass.

### Requirement 10: Tests and unchanged outputs

**User Story:** As the maintainer, I want each polish item covered by a test and the rest of the project untouched, so that polish does not break working behavior.

#### Acceptance Criteria

1. THE test suite SHALL include a test for each of: the `<title>` and meta description, the Intro_Block text and the Repo_Link, the guidance line before a disk opens, focus and scroll after a successful open (with and without Reduced_Motion), `aria-pressed` on the Demo_Cards, State_Cue and Underscore_Hint rendering, the Progress_Line text, and the Paragraph markup and spacing class of the Markdown_Preview.
2. THE test suite SHALL keep the Existing_Tests passing without weakening an assertion; a test that asserts the old title, the old Progress_Line text or the old heading visibility SHALL be updated to the new text together with its cause.
3. WHEN the Demo_Check runs after the change, THE Demo_Check SHALL report that the committed Demo_Disks match the generator, with no image changed.
4. THE change set SHALL contain no edit under `src/core/`, `src/mcp/`, `power/`, `scripts/` or `public/disks/`.
5. THE change set SHALL add no entry to `dependencies` or `devDependencies` in `package.json`.
6. THE Page SHALL keep the CSP of `index.html` unchanged and SHALL call `fetch` only from `src/web/demos.ts`.
7. THE Page code SHALL contain no new use of `innerHTML`, `outerHTML` or `insertAdjacentHTML`.
8. THE tests SHALL use DOM assertions for the DOM items. Any fast-check property callback SHALL return nothing or a boolean and SHALL NOT call `expect`.
9. WHEN the full suite runs with `npm test`, THE suite SHALL pass.
