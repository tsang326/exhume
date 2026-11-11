// Test-only facts about the committed demo disks, and checks that the static page
// (index.html, src/style.css, src/assets/img/logo-pcx.png) says the same thing.
// Each check returns a list of problems; an empty list means the page agrees with the disk.
//
// Markup conventions the checks read (written by task 5.1):
//   #headstones > button.hs.hs--<state>[data-path] > span.sn (name) + span.st (state word)
//   #disk-bar[aria-label] > div.seg > strong (figure), in order alive, recovered, partly back, lost
//   .seg--alive / .seg--recovered / .seg--partial / .seg--lost { flex: <bytes> } in CSS, outside @media
//   #formats .fmt (three, in order WordStar, dBase, PCX), each with a .cap caption
//     WordStar: .proof > p blocks; dBase: .proof > table (th header cells, tr/td rows); PCX: .proof img
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDisk, type DiskHandle, type DiskReport, type Grave } from '../../core/fat12';
import { convertAuto } from '../../core/formats';
import { parseCsv } from '../../web/logic/csv-display';
import { parseMarkdown, plainText } from '../../web/logic/markdown';
import { formatBytes } from '../../web/logic/size';
import { lastSegment, toLabel } from '../../web/logic/text';
import { stateWord } from '../../web/logic/viewmodel';
import { parseCss } from './css-scan';
import { textContent, type HtmlDocument, type HtmlElement } from './html-scan';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

export type DemoId = 'writers-disk' | 'office-disk' | 'damaged-disk';
export interface LoadedDemo {
  readonly handle: DiskHandle;
  readonly report: DiskReport;
}
export interface ByteTotals {
  alive: number;
  recovered: number;
  partlyBack: number;
  lost: number;
}

/** Disk image bytes for one committed demo disk. */
export function loadDemo(id: DemoId): LoadedDemo {
  const handle = openDisk(new Uint8Array(readFileSync(join(ROOT, 'public', 'disks', `${id}.img`))));
  return { handle, report: handle.report };
}

/** Glossary definition: sums of declared sizes by state; partial files split by bytes actually readable. Directories excluded. */
export function byteTotals(report: DiskReport, readLength: (g: Grave) => number): ByteTotals {
  const t: ByteTotals = { alive: 0, recovered: 0, partlyBack: 0, lost: 0 };
  for (const g of report.files) {
    if (g.kind !== 'file') continue;
    if (g.state === 'alive') t.alive += g.size;
    else if (g.state === 'recovered') t.recovered += g.size;
    else if (g.state === 'lost') t.lost += g.size;
    else {
      const got = Math.min(g.size, Math.max(0, readLength(g)));
      t.partlyBack += got;
      t.lost += g.size - got;
    }
  }
  return t;
}

/** Totals of the committed Writer_Disk. */
export function demoByteTotals(): ByteTotals {
  const { handle, report } = loadDemo('writers-disk');
  return byteTotals(report, (g) => {
    const r = handle.readBytes(g);
    return r.ok ? r.bytes.length : 0;
  });
}

// ------------------------------------------------------------------ html helpers

function walk(el: HtmlElement, visit: (e: HtmlElement) => void): void {
  const stack: HtmlElement[] = [el];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    visit(cur);
    for (let i = cur.children.length - 1; i >= 0; i--) {
      const c = cur.children[i]!;
      if (c.kind === 'element') stack.push(c);
    }
  }
}
function all(root: HtmlElement, pred: (e: HtmlElement) => boolean): HtmlElement[] {
  const out: HtmlElement[] = [];
  walk(root, (e) => {
    if (e !== root && pred(e)) out.push(e);
  });
  return out;
}
const hasClass = (e: HtmlElement, c: string): boolean => (e.attrs['class'] ?? '').split(/\s+/).includes(c);
const byId = (doc: HtmlDocument, id: string): HtmlElement | undefined => doc.elements.find((e) => e.attrs['id'] === id);
const text = (e: HtmlElement): string => textContent(e).replace(/\s+/g, ' ').trim();
const squash = (s: string): string => s.replace(/\s+/g, ' ').trim();

// ------------------------------------------------------------------ headstones

/** Problems between `#headstones` and the report's files (count, order, path, name, state word, class). */
export function checkHeadstones(html: HtmlDocument, report: DiskReport): string[] {
  const problems: string[] = [];
  const box = byId(html, 'headstones');
  if (!box) return ['#headstones is missing'];
  const stones = all(box, (e) => e.tag === 'button' && hasClass(e, 'hs'));
  const files = report.files.filter((g) => g.kind === 'file');
  if (stones.length !== files.length) problems.push(`expected ${files.length} headstones, found ${stones.length}`);
  files.forEach((g, i) => {
    const s = stones[i];
    if (!s) return;
    const name = toLabel(lastSegment(g.path));
    const sn = all(s, (e) => hasClass(e, 'sn'))[0];
    const st = all(s, (e) => hasClass(e, 'st'))[0];
    if (s.attrs['data-path'] !== g.path) problems.push(`stone ${i}: data-path ${String(s.attrs['data-path'])} != ${g.path}`);
    if (!sn || text(sn) !== name) problems.push(`stone ${i}: name ${sn ? text(sn) : '(none)'} != ${name}`);
    if (!st || text(st) !== stateWord(g.state)) problems.push(`stone ${i}: state ${st ? text(st) : '(none)'} != ${stateWord(g.state)}`);
    if (!hasClass(s, `hs--${g.state}`)) problems.push(`stone ${i}: missing class hs--${g.state}`);
  });
  return problems;
}

// ------------------------------------------------------------------ bar

const SEGMENTS: readonly { key: keyof ByteTotals; cls: string }[] = [
  { key: 'alive', cls: 'seg--alive' },
  { key: 'recovered', cls: 'seg--recovered' },
  { key: 'partlyBack', cls: 'seg--partial' },
  { key: 'lost', cls: 'seg--lost' },
];

export type FileCounts = Readonly<Record<keyof ByteTotals, number>>;

/** Files per state on the committed Writer_Disk (directories excluded; partial files count as partlyBack). */
export function demoFileCounts(): FileCounts {
  const c = { alive: 0, recovered: 0, partlyBack: 0, lost: 0 };
  for (const g of loadDemo('writers-disk').report.files) {
    if (g.kind !== 'file') continue;
    if (g.state === 'alive') c.alive++;
    else if (g.state === 'recovered') c.recovered++;
    else if (g.state === 'partial') c.partlyBack++;
    else if (g.state === 'lost') c.lost++;
  }
  return c;
}

const NUMBER_WORDS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];

/** Counts a segment line states: number words, "N file(s)", and "a (deleted) draft/file" as one. */
function statedCounts(line: string): number[] {
  const out: number[] = [];
  const re = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b|\b(\d{1,4})\s+files?\b|\b(?:a|an)\s+(?:deleted\s+)?(?:draft|file)s?\b/gi;
  for (const m of line.slice(0, 500).matchAll(re)) {
    if (m[1]) out.push(NUMBER_WORDS.indexOf(m[1].toLowerCase()) + 1);
    else if (m[2]) out.push(Number(m[2]));
    else out.push(1);
  }
  return out;
}

/** Problems between `#disk-bar`, the `.seg--*` flex values, the totals and the per-state file counts. */
export function checkBar(html: HtmlDocument, css: string, totals: ByteTotals, counts: FileCounts = demoFileCounts()): string[] {
  const problems: string[] = [];
  const bar = byId(html, 'disk-bar');
  if (!bar) return ['#disk-bar is missing'];
  const label = bar.attrs['aria-label'] ?? '';
  if (label.trim() === '') problems.push('#disk-bar has no aria-label');
  const figures = all(bar, (e) => e.tag === 'strong');
  if (figures.length !== SEGMENTS.length) problems.push(`expected ${SEGMENTS.length} figures, found ${figures.length}`);
  SEGMENTS.forEach(({ key }, i) => {
    const want = formatBytes(totals[key]);
    if (!label.includes(want)) problems.push(`aria-label lacks ${want} (${key})`);
    const f = figures[i];
    if (f && text(f) !== want) problems.push(`figure ${i} is "${text(f)}", expected "${want}"`);
  });
  const segs = all(bar, (e) => e.tag === 'div' && hasClass(e, 'seg'));
  SEGMENTS.forEach(({ key, cls }) => {
    const seg = segs.find((s) => hasClass(s, cls));
    const em = seg ? all(seg, (e) => e.tag === 'em')[0] : undefined;
    if (!em) return;
    for (const n of statedCounts(text(em))) {
      if (n !== counts[key]) problems.push(`.${cls} line says ${n} but the disk has ${counts[key]} (${key})`);
    }
  });
  const rules = parseCss(css).filter((r) => r.context.length === 0);
  for (const { key, cls } of SEGMENTS) {
    const flex = rules
      .filter((r) => r.selector.split(',').some((s) => s.trim() === `.${cls}`))
      .flatMap((r) => r.decls.filter((d) => d.prop === 'flex'))
      .pop();
    const first = flex?.value.trim().split(/\s+/)[0];
    if (first !== String(totals[key])) problems.push(`.${cls} flex is ${first ?? '(none)'}, expected ${totals[key]}`);
  }
  return problems;
}

// ------------------------------------------------------------------ excerpts

export interface ExcerptSources {
  readonly writers: LoadedDemo;
  readonly office: LoadedDemo;
  /** Bytes of src/assets/img/logo-pcx.png. */
  readonly logoPng: Uint8Array;
  readonly css: string;
}

function readFile(d: LoadedDemo, path: string): Uint8Array | null {
  const g = d.report.files.find((f) => f.path === path);
  if (!g) return null;
  const r = d.handle.readBytes(g);
  return r.ok ? r.bytes : null;
}

function convertText(d: LoadedDemo, path: string): string | null {
  const bytes = readFile(d, path);
  if (!bytes) return null;
  const c = convertAuto(bytes, path.slice(1));
  return c.ok && typeof c.output === 'string' ? c.output : null;
}

function checkPcx(fmt: HtmlElement | undefined, src: ExcerptSources): string[] {
  const problems: string[] = [];
  const bytes = readFile(src.office, '/LOGO.PCX');
  const conv = bytes ? convertAuto(bytes, 'LOGO.PCX') : null;
  if (!conv || !conv.ok || typeof conv.output === 'string') return ['LOGO.PCX did not convert to PNG'];
  const png = conv.output;
  if (png.length !== src.logoPng.length || png.some((v, i) => v !== src.logoPng[i])) {
    problems.push('logo-pcx.png differs from the converter output');
  }
  const dv = new DataView(src.logoPng.buffer, src.logoPng.byteOffset, src.logoPng.byteLength);
  const w = src.logoPng.length >= 24 ? dv.getUint32(16) : -1;
  const h = src.logoPng.length >= 24 ? dv.getUint32(20) : -1;
  const img = fmt ? all(fmt, (e) => e.tag === 'img')[0] : undefined;
  if (!img) problems.push('PCX block has no img');
  else {
    if (img.attrs['width'] !== String(w) || img.attrs['height'] !== String(h)) {
      problems.push(`img size ${img.attrs['width']}x${img.attrs['height']} != PNG ${w}x${h}`);
    }
    if ((img.attrs['alt'] ?? '').trim() === '') problems.push('PCX img has an empty alt');
  }
  const rules = parseCss(src.css).filter((r) => r.selector.split(',').some((s) => /\.proof--pcx\s+img$/.test(s.trim())));
  const widthOf = (narrow: boolean): string | undefined =>
    rules
      .filter((r) => r.context.some((c) => /max-width/.test(c)) === narrow)
      .flatMap((r) => r.decls)
      .filter((d) => d.prop === 'width')
      .pop()?.value;
  if (widthOf(false) !== `${w * 7}px`) problems.push(`wide logo width is ${widthOf(false) ?? '(none)'}, expected ${w * 7}px`);
  if (widthOf(true) !== `${w * 4}px`) problems.push(`narrow logo width is ${widthOf(true) ?? '(none)'}, expected ${w * 4}px`);
  const px = rules.flatMap((r) => r.decls).some((d) => d.prop === 'image-rendering' && d.value.trim() === 'pixelated');
  if (!px) problems.push('logo lacks image-rendering: pixelated');
  return problems;
}

/** Problems between the three `#formats .fmt` blocks and the converter output of the demo disks. */
export function checkExcerpts(html: HtmlDocument, src: ExcerptSources): string[] {
  const problems: string[] = [];
  const formats = byId(html, 'formats');
  const fmts = formats ? all(formats, (e) => hasClass(e, 'fmt')) : [];
  if (fmts.length !== 3) problems.push(`expected 3 .fmt blocks, found ${fmts.length}`);

  // WordStar: shown paragraphs are the first N converted paragraphs, each a prefix.
  const md = convertText(src.writers, '/CHAPTER1.WS');
  const ws = fmts[0];
  if (md === null) problems.push('CHAPTER1.WS did not convert');
  else if (ws) {
    const converted = parseMarkdown(md)
      .blocks.filter((b) => b.type === 'paragraph')
      .map((b) => squash(plainText({ blocks: [b], dropped: 0 })));
    const proof = all(ws, (e) => hasClass(e, 'proof'))[0];
    const blocks = (proof ? all(proof, (e) => e.tag === 'p') : []).map((e) => text(e));
    if (blocks.length === 0) problems.push('WordStar block shows no paragraphs');
    blocks.forEach((b, i) => {
      const body = b.replace(/\s*(…|\.\.\.)$/, '');
      if (!converted[i] || !converted[i]!.startsWith(body)) problems.push(`WordStar paragraph ${i} is not a prefix of the converted text`);
    });
  }

  // dBase: header cells an ordered subset; rows equal converted rows restricted to those columns, in order.
  const csv = convertText(src.office, '/CUSTOMER.DBF');
  const db = fmts[1];
  if (csv === null) problems.push('CUSTOMER.DBF did not convert');
  else if (db) {
    const rows = parseCsv(csv, 100_000, 1_000).rows;
    const head = rows[0] ?? [];
    const table = all(db, (e) => e.tag === 'table')[0];
    if (!table) problems.push('dBase block has no table');
    else {
      const ths = all(table, (e) => e.tag === 'th').map(text);
      const cols: number[] = [];
      let from = 0;
      for (const t of ths) {
        const at = head.findIndex((h, i) => i >= from && squash(h) === t);
        if (at < 0) problems.push(`dBase header "${t}" is not in the converted header (or out of order)`);
        else {
          cols.push(at);
          from = at + 1;
        }
      }
      let next = 1;
      for (const tr of all(table, (e) => e.tag === 'tr')) {
        const cells = all(tr, (e) => e.tag === 'td').map(text);
        if (cells.length === 0) continue;
        let found = -1;
        for (let r = next; r < rows.length && found < 0; r++) {
          if (cols.length === cells.length && cols.every((c, k) => squash(rows[r]![c] ?? '') === cells[k])) found = r;
        }
        if (found < 0) problems.push(`dBase row "${cells.join(' | ')}" is not a converted row (or out of order)`);
        else next = found + 1;
      }
    }
  }

  // PCX
  problems.push(...checkPcx(fmts[2], src));

  // Captions name the disk and the file.
  const caps: readonly { fmt: HtmlElement | undefined; disk: LoadedDemo; file: string }[] = [
    { fmt: fmts[0], disk: src.writers, file: 'CHAPTER1.WS' },
    { fmt: fmts[1], disk: src.office, file: 'CUSTOMER.DBF' },
    { fmt: fmts[2], disk: src.office, file: 'LOGO.PCX' },
  ];
  for (const { fmt, disk, file } of caps) {
    const cap = fmt ? all(fmt, (e) => hasClass(e, 'cap'))[0] : undefined;
    const t = cap ? text(cap) : '';
    if (!t.includes(file)) problems.push(`caption lacks ${file}`);
    if (disk.report.volume.label !== '' && !t.includes(disk.report.volume.label)) problems.push(`caption for ${file} lacks disk label ${disk.report.volume.label}`);
  }
  return problems;
}
