# Requirements Document

## Introduction

The graveyard UI is the web page of Exhume. It lives in `src/web/` and is a static Vite page with no UI framework. A visitor drops a FAT12 floppy image (or picks one with a button). Every file on the disk appears as a tombstone, and every deleted entry appears as an open grave graded `recovered`, `partial` or `lost`, with the reason shown. Activating a grave plays a "rising" animation and then shows a preview: WordStar as Markdown, dBase as a CSV table, PCX as a PNG image, anything else as a hex/text view. Every preview offers a download.

The page builds on two finished public modules and imports only from them:

- `src/core/fat12/index.ts`: `openDisk`, `readDisk`, `DiskHandle` (with its `readBytes` method), `DiskReport`, `Grave`, `GraveState`, `GraveKind`, `Warning`, and limits such as `MAX_IMAGE_BYTES` (2,949,120) and `MAX_TOTAL_ENTRIES` (4,096).
- `src/core/formats/index.ts`: `convertAuto`, `detectFormat`, `convertWordStar`, `convertDBase`, `convertPcx`, `encodePng`, `ConversionResult`, `ConversionWarning` and the format limits.

Neither module is changed by this spec.

A disk image is untrusted bytes from a stranger. Every name, label, reason, warning, cell and byte shown by this page comes from that image. The page therefore never turns disk text into HTML, runs the core in a Web Worker, and ships under a strict Content Security Policy, as `safety.md` requires.

Deliberate deviation from the original `safety.md` text, which said `connect-src 'none'`. This spec relaxes that single directive to `connect-src 'self'` (same origin only) so that demo disks under `/disks/` can be fetched. A CSP meta tag cannot be scoped to one element, so the relaxation applies to the whole page; the rules and scans of Requirements 1, 2, 8 and 13 confine network access to one file, `src/web/demos.ts`. `.kiro/steering/safety.md` has been updated to match (`connect-src 'self'`).

Hosting: the site is served from a domain root (Vercel or Netlify style). The Vite `base` stays `'/'`, and the `/disks/` URL contract of Requirement 8 is root-relative.

Out of scope: any change to `src/core/`, the MCP server and Power, demo disk generation (spec 5), hosting and CI, any backend. The existing placeholder `src/main.ts` and `src/style.css` are replaced by the implementation of this spec.

### Dependency approval required

DOM-level tests need a DOM implementation, and `package.json` has none (Vite, Vitest, fast-check and TypeScript only). Such tests would need a dev dependency such as `happy-dom` or `jsdom`. **No package is installed or added without the user's explicit approval.** Every requirement below that is marked "(conditional on approval)" is verified by DOM-environment tests only after that approval. All other criteria are verifiable without a DOM, using pure-logic tests, source scans, or a production build.

## Glossary

- **Graveyard_UI**: The web page in `src/web/`, made of the Main_Thread_Code, the Disk_Worker and the Effects_Layer.
- **Main_Thread_Code**: The Graveyard_UI code that runs on the page's main thread: input handling, rendering, preview and download.
- **Disk_Worker**: The Web Worker that runs `openDisk`, `DiskHandle.readBytes`, `convertAuto` and `encodePng`.
- **Worker_Protocol**: The typed request and response messages exchanged between the Main_Thread_Code and the Disk_Worker.
- **Request_Id**: A positive integer, unique per request within one page session, carried by every request and by its responses.
- **Image_File**: The `File` the visitor drops or picks.
- **Size_Cap**: `MAX_IMAGE_BYTES` imported from the FAT12 core index.
- **Graveyard**: The list of Graves for the open disk, shown as Tombstones and Open_Graves.
- **Grave**: A `Grave` from the FAT12 core.
- **Tombstone**: The visual item for a Grave whose state is `alive`.
- **Open_Grave**: The visual item for a Grave whose state is `recovered`, `partial` or `lost`.
- **Item_View_Model**: A plain data object derived from a Grave for display: label, size text, date text, state, reason, kind and the action available.
- **Page_Size**: The number of items rendered at once in the Graveyard (see Requirement 7).
- **Preview_Panel**: The dialog-like region that shows the result for one activated Grave.
- **Safe_Markdown_Subset**: The Markdown constructs listed in Requirement 5, which are exactly those that `convertWordStar` emits.
- **Markdown_Model**: A DOM-free tree of nodes produced by parsing Markdown_Text under the Safe_Markdown_Subset.
- **Safe_Node_Type**: One of `paragraph`, `line-break`, `strong`, `emphasis`, `thematic-break`, `text`.
- **HTML_Sink**: Any API that parses a string as markup or script: `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `document.writeln`, `DOMParser`, `createContextualFragment`, `srcdoc`, `setHTML`, `eval`, `new Function`, and `setAttribute` with an `on*` event-handler name, `style` or `srcdoc`.
- **Safe_File_Name**: A download file name that matches `[A-Za-z0-9._-]{1,64}`.
- **Effects_Layer**: The code-drawn decorative visuals: CSS and canvas fog, lantern glow, tombstone and open-grave artwork, and the rising animation.
- **Reduced_Motion**: The state where the media query `prefers-reduced-motion: reduce` matches.
- **Demo_Registry**: The typed list of demo disks that spec 5 fills. It is empty by default. It lives in `src/web/demos.ts`, the only Web_Source allowed to call `fetch`, and only for same-origin URLs under `/disks/` that pass `validateDemoDisk`.
- **Demo_Slot**: The documented container in the page that lists the entries of the Demo_Registry.
- **Status_Region**: The element with `role="status"` and `aria-live="polite"` that announces loading, errors and results as text.
- **CSP**: The Content Security Policy delivered through a `<meta http-equiv="Content-Security-Policy">` tag in `index.html`. It allows `connect-src 'self'` (same origin only) and `img-src 'self' blob:`.
- **Web_Sources**: All non-test files under `src/web/`, `src/main.ts`, `index.html` and `src/style.css`.

## Requirements

### Requirement 1: No HTML string sinks

**User Story:** As a visitor opening a stranger's disk, I want the page to treat every byte from the disk as plain text, so that a hostile disk cannot run script on the page.

#### Acceptance Criteria

1. THE Web_Sources SHALL contain zero occurrences of any HTML_Sink name from the glossary.
2. WHEN THE Graveyard_UI renders file names, paths, the volume label, reasons, warning messages, converted text, CSV cells or hex/text preview content, THE Graveyard_UI SHALL insert that content into the page only through `textContent`, `Text` nodes, or DOM nodes created with `createElement`.
3. WHEN THE Graveyard_UI sets an attribute whose value derives from disk content, THE Graveyard_UI SHALL use only the attributes `aria-label`, `title`, `data-*` or `download`, plus `alt`, which is allowed only for a Safe_File_Name value set through the helper `setSrcBlob` (the single helper that sets an `img` `src` Blob URL and its `alt`, see Requirement 9, criterion 10).
4. WHEN THE Graveyard_UI sets the `href` attribute, THE Graveyard_UI SHALL set it only to a Blob URL that the Graveyard_UI created in the current session.
5. THE repository SHALL contain an automated test that reads every Web_Source file and fails if the text of any Web_Source file contains an HTML_Sink name from the glossary (the scan does not skip comments or string literals, so that the rule stays simple). The same test also runs the network-API scan of Requirement 13, criterion 5, whose allow-list holds exactly one file, `src/web/demos.ts`.
6. WHEN the automated scan is given a fixture string that contains each of the HTML_Sink names from the glossary, THE scan SHALL report one violation for every sink name (a self-test that proves the scan detects violations), and SHALL report zero violations for a fixture string that contains none of them. WHEN the network-API scan is given fixtures, THE scan SHALL accept `fetch` in `src/web/demos.ts` and SHALL fail for a network API name in any other file, for an allow-list of two or more files, and for any network API other than `fetch` in `src/web/demos.ts`.
7. IF the scan finds one or more violations, THEN THE test SHALL fail and SHALL print, for each violation, the file path, the 1-based line number and the sink name.
8. FOR ALL strings `s` of 0 to 100,000 characters, the pure function that builds a visible label from disk text SHALL return a string of at most LABEL_CAP characters (LABEL_CAP = 255), where the result is `s` itself when `s` has at most LABEL_CAP characters and otherwise a prefix of `s` that is no longer than LABEL_CAP characters, and SHALL return markup characters (`<`, `>`, `&`, `"`) unchanged as plain characters, never as DOM nodes.

### Requirement 2: Content Security Policy

**User Story:** As the page owner, I want a strict CSP, so that the page cannot load or send anything it should not, even if a bug slips through.

#### Acceptance Criteria

1. THE `index.html` file SHALL contain exactly one CSP meta tag (`<meta http-equiv="Content-Security-Policy">`) located in `<head>` before any `<script>`, `<link>` or `<style>` element, whose policy includes `default-src 'self'`, `connect-src 'self'` (same origin only, for demo disks; see criterion 8), `object-src 'none'` and `base-uri 'none'`.
2. THE CSP SHALL include `worker-src 'self'` for the Disk_Worker, `img-src 'self' blob:` for PNG previews, `script-src 'self'` and `style-src 'self'`, SHALL contain neither `'unsafe-inline'` nor `'unsafe-eval'` in any directive, and SHALL contain no wildcard (`*`) or remote host source in any directive. The design phase confirms the exact directive list, including whether the Vite module worker bundle loads under `worker-src 'self'`.
3. THE `index.html` file SHALL contain no inline `<script>` element with content, no inline event-handler attribute (any attribute whose name starts with `on`) and no `style` attribute.
4. THE Graveyard_UI SHALL apply all styling through the external stylesheet, through CSS classes, or through the CSSOM (`element.style.setProperty` or class changes), and SHALL create no `<style>` element and set no `style` attribute via `setAttribute` or `cssText` at run time.
5. WHERE the production build output in `dist/` is inspected, THE built `index.html` SHALL contain the CSP meta tag with the directives of criteria 1 and 2, no inline script with content, no inline event-handler attribute, no `style` attribute and no `<style>` element.
6. WHEN the Graveyard_UI loads an Image_File, converts it, previews it or downloads the result, THE Graveyard_UI SHALL issue zero network requests (fetch, XMLHttpRequest, WebSocket, beacon or remote resource load) after the initial page load, with one exception: the same-origin demo fetch under `/disks/` that the visitor triggers by activating a demo (Requirement 8).
7. WHEN the built page is exercised in a real browser (load an Image_File, convert, preview, download), THE browser SHALL report zero CSP violations. This is a manual check recorded at task completion, because the default Node test environment and any DOM library cannot enforce CSP.
8. THE decision is made: the CSP uses `connect-src 'self'` so that the Demo_Slot can load same-origin static files. A CSP meta tag cannot be scoped per element, so `connect-src 'self'` applies to the whole page; the single-file fetch rule (Requirement 13, criterion 2) and the scans (Requirement 1, criterion 5; Requirement 13, criterion 5) enforce that nothing else makes network calls (see Requirement 8, criterion 13). The design phase SHALL also verify in a real browser that CSSOM `element.style.setProperty` calls are not blocked by `style-src 'self'` without `'unsafe-inline'`. The expected behavior is that CSSOM manipulation is permitted while inline `style` attributes and `<style>` elements are blocked, but this is unconfirmed until tested.

### Requirement 3: Worker-based processing and message protocol

**User Story:** As a visitor, I want the page to stay responsive while a disk is parsed or a file converted, so that a big or hostile image never freezes my browser tab.

#### Acceptance Criteria

1. THE Graveyard_UI SHALL run `openDisk`, `DiskHandle.readBytes`, `convertAuto` and `encodePng` only inside the Disk_Worker, and the Main_Thread_Code SHALL import none of those functions.
2. THE Disk_Worker SHALL import only `src/core/fat12/index.ts` and `src/core/formats/index.ts` from the core, and THE Graveyard_UI SHALL leave every file under `src/core` unchanged.
3. THE Worker_Protocol SHALL be defined as TypeScript discriminated unions with a `type` field for requests (`open`, `exhume`) and responses (`opened`, `exhumed`, `failed`), each carrying a Request_Id that is a non-negative safe integer.
4. THE Worker_Protocol SHALL carry only structured-clone-safe data: plain objects, arrays, strings, numbers, booleans, `null` and `Uint8Array`, and no functions, class instances, DOM nodes or `Error` objects.
5. WHEN the Main_Thread_Code posts a request, THE Main_Thread_Code SHALL assign a new Request_Id greater than every earlier one, including those of requests sent to a previous Disk_Worker.
6. WHEN the Main_Thread_Code receives a response whose Request_Id is not the Request_Id of the latest request of that kind, THE Main_Thread_Code SHALL ignore the response and SHALL change no visible state.
7. WHEN the Main_Thread_Code receives a message that does not match the response union (wrong `type`, missing fields, wrong field types, a Request_Id that is not a non-negative safe integer), THE Main_Thread_Code SHALL ignore the message, SHALL change no visible state and SHALL NOT throw.
8. WHEN the Main_Thread_Code sends the Image_File bytes to the Disk_Worker, THE Main_Thread_Code SHALL transfer the `ArrayBuffer` instead of copying it.
9. WHEN the Disk_Worker handles an `open` request, THE Disk_Worker SHALL keep exactly one open `DiskHandle` and the image bytes for later `exhume` requests, SHALL release the previously kept ones, and SHALL answer with exactly one `opened` or `failed` response carrying the same Request_Id.
10. WHEN the Disk_Worker handles an `exhume` request for a Grave id, THE Disk_Worker SHALL look the Grave up by that id in its own report (never using a Grave object sent from the main thread), read the bytes with `DiskHandle.readBytes`, run `convertAuto` and, for PNG, return the PNG bytes, or for other formats return the raw bytes bounded as in Requirement 9, criterion 12, and SHALL answer with exactly one `exhumed` or `failed` response carrying the same Request_Id.
11. IF the Disk_Worker receives an `exhume` request while it holds no open `DiskHandle`, or for a Grave id that does not exist in the open disk, THEN THE Disk_Worker SHALL answer with a `failed` response carrying the Request_Id and a reason, and SHALL keep its current state unchanged.
12. IF the Disk_Worker raises an error event, a message error event, or terminates, THEN THE Main_Thread_Code SHALL show an error message in the Status_Region, SHALL clear the pending requests, SHALL discard the Disk_Worker, and SHALL create a new Disk_Worker for the next request.
13. IF an `open` request receives no response within 15 seconds, or an `exhume` request receives no response within 30 seconds, THEN THE Main_Thread_Code SHALL terminate the Disk_Worker, SHALL show a timeout message in the Status_Region, SHALL clear the pending requests, SHALL create a new Disk_Worker for the next request, and SHALL mark the open disk as lost until it is reopened, as criterion 14 specifies.
14. WHEN the Main_Thread_Code replaces the Disk_Worker after criterion 12, 13 or a cancel, THE Graveyard_UI SHALL mark the open disk as lost, SHALL show in the Status_Region a message saying the disk must be reopened, SHALL keep the Image_File bytes that the Main_Thread_Code still holds, and SHALL disable the exhume controls until a new `open` request succeeds.
15. WHEN the visitor loads a new Image_File while a request is pending, THE Main_Thread_Code SHALL supersede the pending requests so that their responses are treated as stale.
16. WHILE a request is pending, THE Graveyard_UI SHALL show a busy indication as text in the Status_Region and SHALL offer a cancel control that terminates the Disk_Worker, clears the pending requests and removes the busy indication.
17. THE message validation function, the Request_Id logic and the stale-response filter SHALL be pure functions that run without a DOM and without a real Worker.
18. FOR ALL arbitrary values passed to the response validation function, THE function SHALL return either a valid typed message or a rejection and SHALL NOT throw.

### Requirement 4: Input intake and size cap

**User Story:** As a visitor, I want clear feedback for any file I give the page, so that I know what went wrong and how to continue.

#### Acceptance Criteria

1. THE Graveyard_UI SHALL accept an image by drop onto the drop zone and by a file-picker button.
2. WHEN a file is chosen or dropped, THE Main_Thread_Code SHALL compare `File.size` with the Size_Cap (MAX_IMAGE_BYTES, 2,949,120 bytes) before reading any bytes of the file.
3. IF `File.size` is greater than the Size_Cap, THEN THE Graveyard_UI SHALL not read the file, SHALL show a message that names the file size and the limit in human-readable units (for example "This file is 5.0 MB. Floppy images up to 2.8 MB are supported."), and SHALL leave the currently open Graveyard unchanged.
4. IF `File.size` is 0, THEN THE Graveyard_UI SHALL not read the file, SHALL show a message that the file is empty, and SHALL leave the currently open Graveyard unchanged.
5. IF the drop carries no file (text, a URL, or an item that is not a file), THEN THE Graveyard_UI SHALL show a message that asks for a disk image file and SHALL leave the currently open Graveyard unchanged.
6. IF the drop carries more than one file, THEN THE Graveyard_UI SHALL use the first file in the drop order and SHALL say in the Status_Region that the other files were ignored.
7. IF reading the file fails (the `File` rejects, the read is aborted, or the file was removed), THEN THE Graveyard_UI SHALL show a message that the file could not be read and SHALL leave the currently open Graveyard unchanged.
8. WHEN a dragged item is over the page, THE Graveyard_UI SHALL prevent the browser default of navigating to or opening the file.
9. IF a dropped item is a directory, THEN THE Graveyard_UI SHALL show the same message as for a non-file drop and SHALL leave the currently open Graveyard unchanged.
10. THE size check SHALL be a pure function from a byte count and the Size_Cap to an accept or reject result with a message, and a fast-check property SHALL show that it accepts exactly the sizes from 1 to the Size_Cap inclusive and rejects 0 and every size above the Size_Cap.
11. THE size formatting function SHALL be pure, and FOR ALL non-negative integers up to Number.MAX_SAFE_INTEGER it SHALL return a non-empty string that holds no more than one decimal digit.
12. WHERE the Graveyard_UI shows a message, THE Graveyard_UI SHALL write the message to the Status_Region using `textContent`, and any file name included in the message SHALL be written only through `textContent`.
13. IF the byte length of the data actually read is greater than the Size_Cap or is 0 (the file changed during the read), THEN THE Graveyard_UI SHALL discard the bytes, SHALL not pass them to parsing, SHALL show a message that the file changed while being read, and SHALL leave the currently open Graveyard unchanged.
14. WHEN a file is chosen or dropped while an earlier file is still being read, THE Graveyard_UI SHALL discard the result of the earlier read and SHALL process only the most recent file.

### Requirement 5: Safe Markdown preview

**User Story:** As a visitor, I want a recovered WordStar document to look like a document, so that I can read it, without the disk text ever becoming active content.

#### Acceptance Criteria

1. THE Safe_Markdown_Subset SHALL be the closed set of constructs listed below, which are the only constructs `convertWordStar` emits; the design MUST re-verify this list against `src/core/formats/wordstar.ts` before implementation, and any construct found there that is not listed SHALL be added to this list before it is rendered:
   - lines separated by a single line feed (a hard return), shown as a `line-break` node;
   - blank lines (two or more consecutive line feeds), which separate paragraphs and are shown as `paragraph` boundaries;
   - `**bold**` shown as a `strong` node;
   - `*emphasis*` shown as an `emphasis` node (the converter uses `*` for both underline and italic);
   - a line that is exactly `---`, shown as a `thematic-break` node (the converter emits it as a line feed, `---`, and a blank line for the `.PA` page-break command);
   - a backslash escape `\x` for the characters `` \ ` * _ < > [ ] `` anywhere in a line and for `#`, `+`, `-` at line start, and for `.` or `)` directly after a single leading digit at line start, shown as a `text` node holding the literal character `x` without the backslash.
2. THE Markdown renderer SHALL produce no node for headings, links, images, lists, block quotes, code spans, code blocks, tables or raw HTML.
3. WHEN the Markdown_Text contains syntax outside the Safe_Markdown_Subset (for example `[x](http://a)`, `# title`, `` `code` ``, `<b>`), THE renderer SHALL show that syntax as literal `text` node values, character for character, with no marker removed. Criterion 1 defines the only constructs that receive special treatment; every other character sequence is literal text.
4. IF a `**` or `*` marker has no matching closing marker in the same paragraph, or would open a third nesting level, THEN THE parser SHALL return that marker as literal `text` and SHALL NOT drop any characters of the input.
5. THE Markdown renderer SHALL be split into a pure parser that returns a Markdown_Model and a thin builder that creates DOM nodes from the Markdown_Model, and the parser SHALL run without a DOM.
6. FOR ALL strings, THE parser SHALL return a Markdown_Model in which every node has a Safe_Node_Type (`paragraph`, `line-break`, `strong`, `emphasis`, `thematic-break`, `text`) and SHALL NOT throw.
7. FOR ALL strings, THE parser SHALL return a Markdown_Model in which the disk text appears only as `text` node values.
8. FOR ALL strings made of characters from the converter's output alphabet, THE concatenation of `text` node values, with line breaks and paragraph breaks restored, SHALL equal the input with the Markdown markers (`**`, `*`, and `---` lines) and escape backslashes removed (a metamorphic check against a simple reference implementation).
9. THE parser SHALL finish in time linear in the input length (doubling a 1,000,000-character input SHALL NOT more than triple parse time), use no recursion, and use an explicit nesting limit of 2 for `strong` and `emphasis` combined.
10. IF the Markdown_Text is longer than 1,000,000 characters, THEN THE Preview_Panel SHALL render only the first 1,000,000 characters, SHALL show a visible note stating that the preview was shortened and that the download holds the full text, and SHALL leave the downloadable text unchanged.
11. WHEN the Preview_Panel shows a Markdown document, THE Preview_Panel SHALL create no element of these types: `a`, `img`, `iframe`, `object`, `embed`, `form`, `script`, `link`, and SHALL set no attribute that loads a resource or navigates.
12. WHERE DOM tests are approved (conditional on approval), THE builder output for a fixture that contains `<img src=x onerror=alert(1)>` SHALL contain no `img` element, no `onerror` attribute, and SHALL show the text `<img src=x onerror=alert(1)>` unchanged.

### Requirement 6: Graveyard display

**User Story:** As a visitor, I want to see the disk as a graveyard with the honest state of each file, so that I know what can be raised.

#### Acceptance Criteria

1. WHEN a disk is opened, THE Graveyard_UI SHALL show the volume label, the count of Graves with kind `file` and the count of Graves with kind `directory`.
2. IF the volume label is an empty string, THEN THE Graveyard_UI SHALL show the neutral placeholder text "(no label)" in place of the volume label.
3. WHEN a Grave has state `alive` and kind `file`, THE Graveyard_UI SHALL show it as a Tombstone with its name, a formatted size and a formatted date.
4. WHEN a Grave has state `recovered`, `partial` or `lost`, THE Graveyard_UI SHALL show it as an Open_Grave with its name, formatted size, formatted date, a text label of the state, and the `reason` text from the core.
5. THE Graveyard_UI SHALL define "name" as the last segment of the Grave `path` after the final "/", and SHALL show the full `path` as secondary text on each entry whose `path` contains more than one segment.
6. THE size formatting function SHALL show sizes below 1,024 bytes as a whole number of bytes with the unit "B", and SHALL show sizes of 1,024 bytes or more in "KB" or "MB" with one decimal place, using 1,024 as the divisor.
7. THE date formatting function SHALL convert a `date` of the form 'YYYY-MM-DDTHH:MM:SS' to the text 'YYYY-MM-DD HH:MM', without applying any time zone conversion.
8. IF a Grave `date` is `null`, THEN THE date formatting function SHALL return the text "no date".
9. IF a Grave `date` is not a parseable 'YYYY-MM-DDTHH:MM:SS' string, THEN THE date formatting function SHALL return the text "no date".
10. THE Graveyard_UI SHALL show the state of every item as a text label from the set `alive`, `recovered`, `partial`, `lost`, and SHALL NOT rely on color alone to tell states apart.
11. WHEN a Grave has kind `directory`, THE Graveyard_UI SHALL show it as an entry that is not keyboard-focusable as a control, has no activation action, and carries a text marker "directory".
12. THE Graveyard_UI SHALL show the Graves in the flat list order given by the DiskReport, and SHALL show the full `path` on each Grave whose `path` has more than one segment, so that nesting is identifiable without a tree structure.
13. WHEN the DiskReport holds one or more Warnings, THE Graveyard_UI SHALL show them in a list that is collapsed by default, with each entry showing the Warning `message` text and the Warning `path` when present, in plain wording, and without alarm icons.
14. WHEN the DiskReport holds zero Graves and the geometry source is `none`, THE Graveyard_UI SHALL show a message stating that the image could not be read as a FAT12 floppy, together with the Warnings list.
15. WHEN the DiskReport holds zero Graves and the geometry source is not `none`, THE Graveyard_UI SHALL show a message stating that the disk holds no files.
16. THE view-model mapping from a DiskReport to a list of Item_View_Models SHALL be a pure function that runs without a DOM.
17. FOR ALL Grave lists, THE mapping SHALL return exactly one Item_View_Model per Grave, in the same order, with every Item_View_Model holding a non-empty state label.
18. FOR ALL Graves whose state is not `alive`, THE mapping SHALL carry the core `reason` text, character for character, into the Item_View_Model.
19. THE size and date formatting functions SHALL be pure, and FOR ALL Graves THE formatting SHALL NOT throw, including for a `null` date, an unparseable date and a size of 4,294,967,295 bytes.

### Requirement 7: Large graveyards

**User Story:** As a visitor with a crowded disk, I want the page to stay fast, so that a disk with thousands of entries does not freeze the tab.

#### Acceptance Criteria

1. WHEN a disk is opened or the paging is reset, THE Graveyard_UI SHALL render at most Page_Size Graves, where Page_Size is 200 and the number of rendered pages is 1.
2. WHEN the number of Graves is greater than the number of currently rendered Graves, THE Graveyard_UI SHALL display a "Show more" button and a text stating the number of rendered Graves and the total number of Graves, in the form "X of Y".
3. WHEN the visitor activates "Show more", THE Graveyard_UI SHALL increase the number of rendered pages by 1, so that the rendered total grows cumulatively and each activation renders at most Page_Size additional Graves while keeping previously rendered Graves.
4. THE Graveyard_UI SHALL render at most `MAX_TOTAL_ENTRIES` (4,096) Graves in total, and WHEN the rendered count equals the total number of Graves, THE Graveyard_UI SHALL hide the "Show more" button.
5. WHEN the number of Graves equals `MAX_TOTAL_ENTRIES` (4,096), THE Graveyard_UI SHALL remain operable, reaching the full rendered count after 20 activations of "Show more" (21 pages in total: 20 full pages of 200 plus a final page of 96), with each activation rendering at most Page_Size new Graves.
6. WHEN the visitor activates "Show more", THE Graveyard_UI SHALL move keyboard focus to the first newly rendered Grave.
7. THE paging function SHALL be pure: FOR ALL list lengths from 0 to `MAX_TOTAL_ENTRIES` and page counts from 1 to 21, the visible count SHALL equal `min(length, pages * Page_Size)`.
8. WHEN a new disk is opened, THE Graveyard_UI SHALL reset the paging to the first page, rendering at most Page_Size Graves.
9. IF the list of Graves is empty, THEN THE Graveyard_UI SHALL render 0 Graves and SHALL NOT display the "Show more" button.

### Requirement 8: Demo disks slot

**User Story:** As the author of spec 5, I want a ready slot for demo disks, so that I can add them without editing other code.

#### Acceptance Criteria

1. THE Graveyard_UI SHALL define a typed `DemoDisk` interface and a Demo_Registry in one module (for example `src/web/demos.ts`), with a documentation comment that marks the module as the extension point for spec 5.
2. THE Demo_Registry SHALL contain 0 entries by default.
3. THE `DemoDisk` interface SHALL hold an id (1 to 64 characters, unique within the Demo_Registry), a display title (1 to 80 characters), a one-line description (1 to 200 characters, no line breaks) and a same-origin URL path under `/disks/`.
4. THE Graveyard_UI SHALL provide a pure function `validateDemoDisk` that returns a valid or invalid result for a `DemoDisk` entry without performing I/O or throwing.
5. IF a `DemoDisk` URL does not start with `/disks/`, contains a scheme (any `name:` prefix), starts with `//`, contains a `..` path segment, contains a backslash, or contains a percent-encoded `.` or `/` (`%2e`, `%2f`, any letter case), or if any other field violates the limits in criterion 3, THEN `validateDemoDisk` SHALL return an invalid result naming the failed field.
6. IF `validateDemoDisk` returns an invalid result for an entry, or an entry's id duplicates an earlier entry, THEN THE Demo_Slot SHALL omit that entry, SHALL still list the remaining valid entries, and SHALL NOT load any URL from the omitted entry.
7. THE Graveyard_UI SHALL render the Demo_Slot as a container with a visible text label (for example "Demo disks") and a programmatic accessible name.
8. WHILE the Demo_Registry has 0 valid entries, THE Graveyard_UI SHALL hide the Demo_Slot (including its label) and SHALL show no error.
9. WHILE the Demo_Registry has 1 or more valid entries, THE Demo_Slot SHALL list each entry as a native button reachable with the Tab key and activatable with Enter and Space, showing the title and description as text.
10. WHEN the visitor activates a demo button, THE Graveyard_UI SHALL load the bytes of the demo URL and pass them through the same intake pipeline as a dropped file: the same Size_Cap check, the same Disk_Worker and the same rendering.
11. WHILE a demo is loading, THE Graveyard_UI SHALL disable all demo buttons and SHALL show a loading text message in the Status_Region.
12. IF loading a demo fails (network error, non-success response, or the 10 second abort of criterion 14 fires) or the demo exceeds the Size_Cap, THEN THE Graveyard_UI SHALL show a text message in the Status_Region naming the cause, SHALL re-enable the demo buttons, and SHALL leave the currently open Graveyard unchanged.
13. THE decision is made: the CSP uses `connect-src 'self'` (same origin only), which applies to the whole document because a CSP meta element cannot be scoped to one element, and `fetch` is allowed only in `src/web/demos.ts`. The design document SHALL restate this decision and its effect on Requirement 2.
14. THE demo bytes SHALL be fetched only by `src/web/demos.ts`, only from the same origin, only for URLs that pass `validateDemoDisk`, with a `fetch` that sends no credentials and uses a 10 second abort.
15. THE demo honesty text ("made by our own generator script") SHALL be out of scope for this requirement and SHALL belong to spec 5.

### Requirement 9: Raising a grave and preview

**User Story:** As a visitor, I want to click a file and see it in a format I can use today, so that the old disk becomes useful.

#### Acceptance Criteria

1. WHEN the visitor activates an item of kind `file` whose state is not `lost`, THE Graveyard_UI SHALL send one `exhume` request to the Disk_Worker and SHALL start the rising animation within 100 ms of the activation.
2. WHILE an `exhume` request is pending, THE Graveyard_UI SHALL show a text stating that the file is rising in the Status_Region, and SHALL remove that text within 100 ms after the result or an error arrives.
3. WHEN the rising animation has finished and the Disk_Worker result has arrived, THE Graveyard_UI SHALL show the Preview_Panel within 100 ms; if the result arrives after the animation finished, THE Graveyard_UI SHALL show the Preview_Panel within 100 ms of the arrival and SHALL NOT wait for any further animation time.
4. IF an `exhume` request returns an error before the rising animation has finished, THEN THE Graveyard_UI SHALL stop the animation and show the Preview_Panel with the error within 100 ms of the error arriving.
5. WHERE the visitor's system has the reduced-motion preference enabled, THE Graveyard_UI SHALL skip the rising animation (0 ms duration) and SHALL show the Preview_Panel within 100 ms of the Disk_Worker result or error arriving.
6. IF an `exhume` request times out (30 seconds, per Requirement 3, criterion 13), THEN THE Graveyard_UI SHALL stop the animation, SHALL show the timeout error in the Preview_Panel, and SHALL apply the recovery of Requirement 3, criteria 13 and 14: the file list stays displayed, the open disk is marked lost, and the exhume controls stay disabled until the visitor reopens the disk.
7. WHEN the Disk_Worker returns a Markdown result, THE Preview_Panel SHALL show it through the renderer of Requirement 5.
8. WHEN the Disk_Worker returns a CSV result, THE Preview_Panel SHALL show a table built from `table`, `tr`, `th` and `td` elements with `textContent`, limited to 200 rows and 50 columns, and SHALL show a "truncated" note with the real row count and the real column count when a limit applies.
9. THE CSV parsing for display SHALL be a pure function that follows RFC 4180 quoting, runs without a DOM, and never throws for any input string, including the empty string, which yields zero rows. FOR ALL arrays of cell strings within the display limits (at most 200 rows and 50 columns), writing them with the core CSV rules and parsing them back with this function SHALL return the same cells (round trip).
10. WHEN the Disk_Worker returns a PNG result, THE Graveyard_UI SHALL create the Blob of type `image/png` and its Blob URL on the main thread from the returned bytes, and THE Preview_Panel SHALL show an `img` element whose `src` is that Blob URL and whose `alt` text is built from the sanitized file name (at most 255 characters), both set only through the helper `setSrcBlob`.
11. WHEN the Preview_Panel closes, OR another preview opens, OR a new disk is opened, THE Graveyard_UI SHALL revoke every Blob URL it created for the previous preview, including the raw download Blob URL, within 100 ms.
12. IF `convertAuto` returns the format `unknown` (no converter match) or a conversion failure, THEN THE Disk_Worker SHALL return the raw file bytes (up to 4 MB, the core file cap) and THE Preview_Panel SHALL show a hex/text view of at most the first 4,096 bytes, as rows of 16 bytes each with an offset, hex and printable text, built with `textContent`, with every byte outside 0x20 to 0x7E shown as `.` in the text column.
13. WHEN the Preview_Panel shows a hex/text view, a failure, or any result, THE Preview_Panel SHALL offer a raw download that contains the full file bytes (up to 4 MB), and not only the 4,096 bytes shown in the hex view.
14. IF a conversion fails, THEN THE Preview_Panel SHALL show the failure `error` text from the core, SHALL show the hex/text view of criterion 12, and SHALL still offer the raw download.
15. IF the raw read of the file fails (`DiskHandle.readBytes` returns ok false), THEN THE Preview_Panel SHALL show the `error` text from the core, SHALL offer no hex view and no raw download, and SHALL keep the disk and file list unchanged.
16. IF the Grave state is `lost`, THEN THE Graveyard_UI SHALL show the Open_Grave as not previewable, SHALL show its `reason`, and SHALL send no `exhume` request.
17. WHEN the Grave is a `partial` Grave, THE Preview_Panel SHALL show the grading reason as text above the content.
18. WHEN the conversion or the read returns warnings, THE Preview_Panel SHALL list every warning as a separate text item, in the order returned, with no limit on count.
19. THE hex view function SHALL be pure and SHALL never throw. FOR ALL byte arrays, its output rows SHALL have a text column of printable ASCII characters (0x20 to 0x7E) only, the number of rows SHALL equal `ceil(min(length, 4096) / 16)`, and an empty byte array SHALL yield 0 rows.
20. WHEN the Preview_Panel is shown after the rising animation (or after its skip), THE Graveyard_UI SHALL move keyboard focus to the Preview_Panel heading or the close control within 100 ms.

### Requirement 10: Downloads

**User Story:** As a visitor, I want to save the raised file, so that I can use it in my own tools.

#### Acceptance Criteria

1. WHEN the visitor activates the download control, THE Graveyard_UI SHALL create a `Blob` whose MIME type is exactly one of `text/markdown`, `text/csv`, `image/png` or `application/octet-stream`.
2. WHEN the visitor activates the download control AND the conversion succeeded, THE Graveyard_UI SHALL create the Blob with the `mime` of the ConversionResult and SHALL name the file with the sanitized base name of the Grave plus the `extension` of the ConversionResult.
3. WHEN the visitor activates the download control AND there was no conversion, THE Graveyard_UI SHALL create the Blob with `application/octet-stream` and the raw bytes of the Grave, and SHALL name the file with the sanitized base name of the Grave plus the extension `.bin`.
4. THE file name sanitizer SHALL be a pure function that maps any string and one extension from `.md`, `.csv`, `.png`, `.bin` to a Safe_File_Name by applying these steps in order: (a) take only the part after the last `/` or `\`; (b) remove the disk extension, meaning the last `.` and all characters after it, so that `a.exe` with `.md` becomes `a.md`; (c) replace each character outside `[A-Za-z0-9._-]` with `_`; (d) remove all leading `.` characters and all trailing `.` characters; (e) replace each run of two or more `.` with a single `.`; (f) truncate the stem to at most 64 minus the length of the extension characters, so the total length including the extension is at most 64; (g) after truncation, remove any trailing `.` from the stem again; (h) append the extension.
5. IF the stem is empty after steps (a) to (g) of the sanitizer, THEN THE sanitizer SHALL use the stem `grave`.
6. FOR ALL strings and each extension in `.md`, `.csv`, `.png`, `.bin`, THE sanitizer SHALL return a string that matches `^[A-Za-z0-9._-]{1,64}$`, does not start with `.`, does not contain `..`, and ends with that extension, regardless of the extension the disk name carried.
7. THE sanitizer SHALL accept a stem that equals a Windows-reserved device name such as `CON` or `NUL` and SHALL return it unchanged apart from the extension, for example `CON.md`.
8. WHEN the visitor activates the download control, THE Graveyard_UI SHALL start the download through a temporary anchor element with a `download` attribute set to the Safe_File_Name and an `href` set to a Blob URL, and SHALL revoke the Blob URL within 1000 ms after the download is started.
9. IF creating the Blob or the Blob URL fails, THEN THE Graveyard_UI SHALL start no download, SHALL show an error indication that the download failed, and SHALL keep the Grave and its ConversionResult unchanged.

### Requirement 11: Effects layer

**User Story:** As a visitor, I want a moody lantern-and-fog look, so that the page feels like a graveyard, while the text stays easy to read.

#### Acceptance Criteria

1. THE Effects_Layer, including tombstone and open-grave artwork, lantern glow, fog and the rising animation, SHALL be drawn only with CSS and `<canvas>`, and THE Graveyard_UI SHALL load no external image, font, script, stylesheet or media file.
2. THE Effects_Layer elements SHALL have `pointer-events: none` and `aria-hidden="true"`, and each Effects_Layer element SHALL have an effective opacity (element opacity multiplied by the alpha of its fill colors) of at most 0.6.
3. THE Effects_Layer elements SHALL have a computed `z-index` lower than the `z-index` of the element that holds the page text, so that no Effects_Layer element is painted above any text.
4. IF an Effects_Layer element is declared with a `z-index` equal to or higher than the text container, THEN THE Effects_Layer SHALL limit that element's effective opacity to at most 0.15, and the text contrast, computed with that element's alpha composited over the text and its background, SHALL stay at or above the limit of Requirement 12, criterion 12.
5. WHILE the document is hidden (the Page Visibility API reports `hidden`), THE canvas effects SHALL stop drawing new frames within 100 ms, and WHEN the document becomes visible again they SHALL resume drawing within 100 ms.
6. THE canvas effects SHALL run at no more than 30 frames per second, SHALL draw no more than 200 shapes per frame, and SHALL size the canvas to at most 1,920 by 1,080 pixels of backing store.
7. WHILE Reduced_Motion is on, THE Effects_Layer SHALL draw no animation: the canvas shows one static frame or is not created, CSS animations and transitions have a duration of 0 ms or are removed, and the rising animation is replaced by an instant switch to the preview.
8. WHEN the visitor changes the Reduced_Motion setting while the page is open, THE Effects_Layer SHALL apply the new setting within 500 ms without a page reload.
9. IF the canvas 2D context is not available, THEN THE Graveyard_UI SHALL continue without canvas effects, SHALL show no error message, and SHALL keep all text and controls usable.
10. WHEN the rising animation starts, THE Graveyard_UI SHALL finish it in no more than 1,200 ms and SHALL leave no animated element in the document after it ends.

### Requirement 12: Accessibility and responsiveness

**User Story:** As a visitor who uses a keyboard, a screen reader or a phone, I want the page to work for me, so that the graveyard is open to everyone.

#### Acceptance Criteria

1. THE Graveyard_UI SHALL display a visible file-picker button adjacent to the drop zone that opens the native file selection dialog, so that every function is available without a pointer drag.
2. THE Graveyard_UI SHALL render every activatable Grave as a native `button` element or as an element with `role="button"` and `tabindex="0"`.
3. WHEN the visitor presses Enter or Space while an activatable Grave has keyboard focus, THE Graveyard_UI SHALL activate that Grave with the same action as a pointer click.
4. THE Graveyard_UI SHALL show a visible focus indicator with a contrast ratio of at least 3:1 against adjacent colors on every focusable element.
5. WHEN the visitor presses Escape while the Preview_Panel is open, THE Graveyard_UI SHALL close the Preview_Panel.
6. WHEN the Preview_Panel closes, THE Graveyard_UI SHALL move keyboard focus to the item that opened it.
7. IF the item that opened the Preview_Panel is no longer rendered when the Preview_Panel closes, THEN THE Graveyard_UI SHALL move keyboard focus to the Graveyard heading.
8. WHILE the Preview_Panel is open, THE Graveyard_UI SHALL keep keyboard focus inside the Preview_Panel, wrapping focus from the last focusable element to the first on Tab and from the first to the last on Shift+Tab.
9. WHILE the Preview_Panel is open, THE Graveyard_UI SHALL mark the Preview_Panel with `role="dialog"`, `aria-modal="true"` and a non-empty accessible name.
10. THE Graveyard_UI SHALL give the drop zone, the item list, each item (exposing its name, size and state), the Preview_Panel and the Status_Region a non-empty accessible name or an appropriate ARIA role.
11. WHEN loading starts, an error occurs or a result becomes available, THE Graveyard_UI SHALL announce it as text in the Status_Region, which is an ARIA live region.
12. THE Graveyard_UI SHALL use text and background colors with a contrast ratio of at least 4.5:1 for body text (under 18 pt, or under 14 pt bold) and at least 3:1 for large text, measured for the colors defined in the stylesheet.
13. WHILE the viewport is 320 CSS pixels wide, THE Graveyard_UI SHALL show no horizontal scroll bar on the page itself, with long file names wrapped or truncated, and with wide content (the CSV table and the hex view) scrolling inside its own container.
14. THE Graveyard_UI SHALL set a non-empty `lang` attribute on the page, a non-empty page title and exactly one `h1`.
15. THE stylesheet SHALL declare the text and background color pairs as CSS custom properties, and the contrast ratio function used by the stylesheet-color test SHALL be pure (the same inputs always return the same ratio, with no side effects).
16. THE stylesheet-color test SHALL read the declared color pairs from the CSS custom properties and fail if any pair is below the minimum ratio in criterion 12.
17. THE stylesheet-level check for criterion 13 SHALL fail if the stylesheet declares a fixed width larger than 100% of the viewport on a page-level element, or if file-name elements lack an `overflow-wrap` or truncation rule.
18. THE Graveyard_UI SHALL verify criterion 13 by a manual check at a 320 CSS pixel viewport plus the stylesheet-level check in criterion 17, because real browser layout cannot run in jsdom or happy-dom. This verification is not automated for layout.
19. WHERE DOM tests are approved (conditional on approval), a test SHALL check that activating an item with Enter and with Space triggers the same action, that Escape closes the Preview_Panel, and that focus returns to the opening item.

### Requirement 13: Privacy and honesty

**User Story:** As a visitor, I want to know my files stay on my machine and who did the earlier work, so that I can trust the page.

#### Acceptance Criteria

1. WHEN the Graveyard_UI first renders, THE Graveyard_UI SHALL show a visible note of 1 to 140 characters stating that files stay in the browser and are never uploaded, without requiring any click, hover or scroll interaction beyond the initial viewport at 1280x720 pixels.
2. THE Web_Sources, except `src/web/demos.ts`, SHALL contain no call to or reference to `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `navigator.sendBeacon`, or an analytics or tracking library, and `src/web/demos.ts` SHALL use no network API other than `fetch`.
3. WHEN the Graveyard_UI first renders, THE Graveyard_UI SHALL show a one-line honesty note of 1 to 160 characters that contains the text "andete/disk-peek" and describes it as an existing browser tool for FAT12 images and deleted-entry recovery.
4. THE rendered Graveyard_UI text, the visible text of `index.html` and the string literals (TypeScript and JavaScript string and template literals) in the Web_Sources SHALL contain none of these forbidden phrases, matched case-insensitively: "first browser", "world's first", "worlds first", "the first", "first ever", "first-ever", "only browser", "the only".
5. THE automated scan of Requirement 1 SHALL fail, and SHALL report the file path and the matched name, IF any network API name from criterion 2 appears in any Web_Source other than `src/web/demos.ts`, IF the scan's allow-list holds a second file, or IF `src/web/demos.ts` uses any network API name from criterion 2 other than `fetch`.
6. THE automated scan of Requirement 1 SHALL fail, and SHALL report the file path and the matched phrase, IF any forbidden phrase from criterion 4 appears in the visible text of `index.html` or in a string literal of a Web_Source. Code comments are deliberately excluded from this scan. WHEN the scan is given a fixture with a forbidden phrase in a string literal, THE scan SHALL report it, and WHEN the same phrase appears only in a comment, THE scan SHALL report nothing (self-test).
7. THE Graveyard_UI SHALL not call or reference `localStorage`, `sessionStorage`, `indexedDB` or `document.cookie` to store any content derived from an Image_File, including file bytes, file names, directory listings, recovered file contents and grades.
8. IF `src/web/demos.ts` fails to load a demo image, THEN THE Graveyard_UI SHALL show an error indication and SHALL send no Image_File bytes or derived content to any remote endpoint.

### Requirement 14: Robustness and memory release

**User Story:** As a visitor, I want the page to survive any file, so that I never see a blank screen.

#### Acceptance Criteria

1. IF an `error` event or an `unhandledrejection` event reaches the page's top level, THEN THE Graveyard_UI SHALL show a plain-text error message of 1 to 300 characters in the Status_Region, SHALL keep the drop zone enabled so a new file can be dropped, and SHALL leave the current Graveyard and Preview_Panel unchanged.
2. WHEN the visitor drops a file of random bytes, a truncated disk, a file of the wrong type, an empty (0-byte) file, or a file of exactly the Size_Cap bytes, THE Graveyard_UI SHALL show either a Graveyard or a non-empty plain-text message in the Status_Region within 5 seconds of the drop, and SHALL keep the drop zone present in the document body.
3. WHEN a disk open completes with a DiskReport (including a DiskReport with geometry source 'none', zero files and warnings, such as one produced from random bytes), THE Graveyard_UI SHALL treat the open as successful, replace the previous Graveyard with the new one (an empty Graveyard with the message required by Requirement 6, criterion 14, when there are zero files), close any open Preview_Panel, revoke every Blob URL created for the previous disk, and drop all main-thread references to the previous image bytes and results.
4. WHEN a new disk open request is received, THE Disk_Worker SHALL release the previous `DiskHandle` and its image bytes before or when the new `DiskHandle` is installed, so that at most one `DiskHandle` is held at any time.
5. IF a new disk fails to open because of a Worker or transport failure (Worker creation error, Worker `error` or `messageerror` event, or a Worker response indicating failure), a file read failure, or a file larger than the Size_Cap, THEN THE Graveyard_UI SHALL keep the previous Graveyard and its Preview_Panel and Blob URLs in place, SHALL show a plain-text error message in the Status_Region that identifies the failure kind, and SHALL keep the drop zone enabled.
6. THE Disk_Worker SHALL implement its request handling as a pure function, separate from the `self.onmessage` glue, that takes a request and returns a response without requiring a Worker instance, so that request handling can be tested without a Worker.
7. WHERE DOM tests are approved (conditional on approval), a test SHALL drive the page with fixture files (random bytes, empty, oversize) and SHALL check that the Status_Region holds non-empty text and that the document body still holds the drop zone.
8. THE production build SHALL succeed with `vite build` with exit code 0, SHALL produce only static assets, and SHALL need no server code at runtime.

### Requirement 15: Tests, structure and dependencies

**User Story:** As a maintainer, I want the logic split so that most of it can be tested without a browser, so that the page stays correct as it changes.

#### Acceptance Criteria

1. THE Graveyard_UI SHALL keep the pure logic (Worker_Protocol validation, stale-response filter, size check and formatting, view-model mapping, paging, Markdown parser, CSV display parser, hex view, file name sanitizer, contrast ratio) in modules that reference no DOM global (for example `document`, `window`, `HTMLElement`) and no `Worker`, so that Vitest runs them in its default Node environment without configuring any other test environment.
2. THE tests SHALL live in files matching `src/**/*.test.ts` and use Vitest and fast-check, and no fast-check property callback SHALL call `expect(...)`, so that a property callback signals failure only by returning false or throwing.
3. THE Graveyard_UI SHALL import from `src/core/` only through `src/core/fat12/index.ts` and `src/core/formats/index.ts`.
4. WHEN the test suite runs, THE Graveyard_UI test suite SHALL include a test that scans every `.ts` file under `src/web/` (including test files) and fails if any import specifier resolves to a path under `src/core/` other than those two index files.
5. THE Graveyard_UI SHALL make no change to any file under `src/core/`.
6. WHEN the tasks for this spec are completed, THE maintainer SHALL run a git diff of `src/core/` against the base commit recorded for this spec and the diff SHALL be empty (no added, modified, deleted or renamed files).
7. THE project SHALL add no runtime dependency (no new entry under `dependencies` in `package.json`) and no UI framework.
8. IF a task requires a dev dependency, THEN THE Graveyard_UI SHALL leave `package.json` and `package-lock.json` without that dependency and SHALL ask the user for explicit approval (see "Dependency approval required") before adding it.
9. THE tests that need a DOM implementation SHALL be separated by file name using the suffix `*.dom.test.ts`, and WHILE no DOM dev dependency has been approved by the user, THE project SHALL contain no `*.dom.test.ts` file that runs, either by the files being absent or by their tests being skipped, and all pure-logic tests SHALL pass without a DOM implementation installed.
10. THE `src/web/` modules SHALL compile under strict TypeScript with no explicit or implicit `any`, using the DOM and WebWorker type libraries configured in the project's TypeScript configuration.
11. WHEN `npm run typecheck` is run, THE project SHALL complete with exit code 0 and zero type errors, including the `src/web/` code and the existing `src/core/` check.
12. WHEN `npm run build` is run, THE project SHALL complete with exit code 0.
13. WHEN `npm test` is run, THE project SHALL complete with exit code 0, with zero failing tests, and with every test that existed before this spec still present and passing, including all existing tests under `src/core/`.
