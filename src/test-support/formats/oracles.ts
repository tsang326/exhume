// Independent models for the format resurrection tests.
// Written without importing any src/core/formats implementation module, and with
// a different structure on purpose. The only imports are decodeCp437 (the CP437
// table is tested by the fat12 spec). Not exported from the barrel; no vitest,
// no fast-check, no Node module.

import { decodeCp437 } from '../../core/fat12';

// ---------------------------------------------------------------------------
// dBase cells
// ---------------------------------------------------------------------------

export interface ExpectedCell {
  /** Cell_Text before CSV quoting and before the formula guard. */
  text: string;
  /** True when the converter must write an empty cell and warn `field-value-invalid`. */
  invalid: boolean;
}

function isLeapYear(year: number): boolean {
  if (year % 400 === 0) return true;
  if (year % 100 === 0) return false;
  return year % 4 === 0;
}

/** Own calendar: true when y/m/d is a real Gregorian date with year 1 to 9999. */
export function isRealDate(year: number, month: number, day: number): boolean {
  if (!Number.isInteger(year) || year < 1 || year > 9999) return false;
  if (!Number.isInteger(month) || month < 1 || month > 12) return false;
  const monthLengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return Number.isInteger(day) && day >= 1 && day <= monthLengths[month - 1];
}

function isDigitByte(b: number): boolean {
  return b >= 0x30 && b <= 0x39;
}

/** Own number-form check: optional '-', 1+ digits, optional '.' with 1+ digits. */
export function isNumberForm(s: string): boolean {
  let i = 0;
  if (s.charAt(i) === '-') i++;
  const intStart = i;
  while (i < s.length && s.charCodeAt(i) >= 0x30 && s.charCodeAt(i) <= 0x39) i++;
  if (i === intStart) return false;
  if (i === s.length) return true;
  if (s.charAt(i) !== '.') return false;
  i++;
  const fracStart = i;
  while (i < s.length && s.charCodeAt(i) >= 0x30 && s.charCodeAt(i) <= 0x39) i++;
  return i > fracStart && i === s.length;
}

function controlsToSpaces(s: string, replacement: string): string {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out += c < 0x20 || c === 0x7f ? replacement : s.charAt(i);
  }
  return out;
}

/** Field name as the converter should write it: CP437, controls and 0x7F become '_'. */
export function expectedFieldName(nameBytes: Uint8Array): string {
  let end = nameBytes.indexOf(0x00);
  if (end < 0 || end > 11) end = Math.min(nameBytes.length, 11);
  return controlsToSpaces(decodeCp437(nameBytes.subarray(0, end)), '_');
}

/** Cell_Text for one field value (Requirement 7). Unknown type letters read as 'C'. */
export function expectedCell(type: string, bytes: Uint8Array): ExpectedCell {
  switch (type) {
    case 'M':
      return { text: '', invalid: false };
    case 'N':
    case 'F': {
      let lo = 0;
      let hi = bytes.length;
      while (lo < hi && bytes[lo] === 0x20) lo++;
      while (hi > lo && bytes[hi - 1] === 0x20) hi--;
      let s = '';
      for (let i = lo; i < hi; i++) s += String.fromCharCode(bytes[i]);
      return isNumberForm(s) ? { text: s, invalid: false } : { text: '', invalid: true };
    }
    case 'D': {
      let allSpaces = true;
      for (let i = 0; i < bytes.length; i++) if (bytes[i] !== 0x20) allSpaces = false;
      if (allSpaces) return { text: '', invalid: false };
      if (bytes.length === 8) {
        let digits = true;
        for (let i = 0; i < 8; i++) if (!isDigitByte(bytes[i])) digits = false;
        if (digits) {
          const s = String.fromCharCode(...bytes);
          const y = Number(s.slice(0, 4));
          const m = Number(s.slice(4, 6));
          const d = Number(s.slice(6, 8));
          if (isRealDate(y, m, d)) {
            return { text: s.slice(0, 4) + '-' + s.slice(4, 6) + '-' + s.slice(6, 8), invalid: false };
          }
        }
      }
      return { text: '', invalid: true };
    }
    case 'L': {
      if (bytes.length === 0) return { text: '', invalid: true };
      const ch = String.fromCharCode(bytes[0]);
      if (ch === 'T' || ch === 't' || ch === 'Y' || ch === 'y') return { text: 'TRUE', invalid: false };
      if (ch === 'F' || ch === 'f' || ch === 'N' || ch === 'n') return { text: 'FALSE', invalid: false };
      if (ch === '?' || ch === ' ') return { text: '', invalid: false };
      return { text: '', invalid: true };
    }
    default: {
      // 'C' and every unknown letter.
      let end = bytes.length;
      while (end > 0 && (bytes[end - 1] === 0x20 || bytes[end - 1] === 0x00)) end--;
      return { text: controlsToSpaces(decodeCp437(bytes.subarray(0, end)), ' '), invalid: false };
    }
  }
}

/** Requirement 8.4: text cells starting with = + - @ tab or CR get a leading quote. */
export function expectedFormulaGuard(text: string): string {
  if (text.length === 0) return text;
  return '=+-@\t\r'.includes(text.charAt(0)) ? "'" + text : text;
}

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

export type OracleFormat = 'wordstar' | 'dbase' | 'pcx' | 'unknown';

function isLetterByte(b: number): boolean {
  return (b >= 0x41 && b <= 0x5a) || (b >= 0x61 && b <= 0x7a);
}

/** Content rules only, in the order PCX, dBase, WordStar (Requirement 2.3 to 2.5). */
export function detectOracle(bytes: Uint8Array): OracleFormat {
  const sample = bytes.subarray(0, 4096);
  const n = sample.length;

  if (n >= 4 && sample[0] === 0x0a && [0, 2, 3, 4, 5].includes(sample[1]) && sample[2] === 1 && [1, 2, 4, 8].includes(sample[3])) {
    return 'pcx';
  }

  if (n >= 12 && (sample[0] === 0x03 || sample[0] === 0x83)) {
    const headerLength = sample[8] + sample[9] * 256;
    const recordLength = sample[10] + sample[11] * 256;
    if (headerLength >= 65 && headerLength <= 4129 && recordLength >= 2 && headerLength < bytes.length) {
      return 'dbase';
    }
  }

  let soft = false;
  let dot = false;
  let toggle = false;
  let hard = false;
  let atLineStart = true;
  for (let i = 0; i < n; i++) {
    const b = sample[i];
    if (atLineStart && b === 0x2e && i + 2 < n && isLetterByte(sample[i + 1]) && isLetterByte(sample[i + 2])) dot = true;
    atLineStart = false;
    if (b === 0x8d && i + 1 < n && (sample[i + 1] === 0x0a || sample[i + 1] === 0x8a)) soft = true;
    if (b === 0x0d && i + 1 < n && sample[i + 1] === 0x0a) {
      hard = true;
      atLineStart = true;
      i++; // the pair is one Hard_Return; the next byte starts a line
      continue;
    }
    if (b === 0x02 || b === 0x13 || b === 0x19) toggle = true;
  }
  if (soft || dot || (toggle && hard)) return 'wordstar';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// dBase header
// ---------------------------------------------------------------------------

export type DbfHeaderVerdict =
  | { accepted: true; fieldCount: number; headerLength: number; recordLength: number }
  | { accepted: false; kind: 'version'; version: number }
  | { accepted: false; kind: 'invalid'; condition: 2 | 3 | 4 | 5 };

/** The five conditions of Requirement 6.3, lowest failed condition wins. */
export function dbfHeaderOracle(bytes: Uint8Array): DbfHeaderVerdict {
  if (bytes.length < 32) return { accepted: false, kind: 'invalid', condition: 2 };
  const version = bytes[0];
  if (version !== 0x03 && version !== 0x83) return { accepted: false, kind: 'version', version };

  const headerLength = bytes[8] + bytes[9] * 256;
  const recordLength = bytes[10] + bytes[11] * 256;

  // Condition 2
  if (headerLength < 65 || headerLength > 4129 || headerLength > bytes.length) {
    return { accepted: false, kind: 'invalid', condition: 2 };
  }

  // Condition 3: walk whole descriptors until the terminator.
  let count = 0;
  let offset = 32;
  let found = false;
  for (;;) {
    if (offset >= headerLength || offset >= bytes.length) break;
    if (bytes[offset] === 0x0d) {
      found = true;
      break;
    }
    if (offset + 32 > headerLength) break;
    count++;
    offset += 32;
    if (count > 128) break;
  }
  if (!found || count < 1 || count > 128) return { accepted: false, kind: 'invalid', condition: 3 };

  // Condition 4 and 5
  let sum = 0;
  for (let k = 0; k < count; k++) {
    const len = bytes[32 + k * 32 + 16];
    if (len < 1 || len > 255) return { accepted: false, kind: 'invalid', condition: 4 };
    sum += len;
  }
  if (recordLength < 1 + sum) return { accepted: false, kind: 'invalid', condition: 5 };

  return { accepted: true, fieldCount: count, headerLength, recordLength };
}

// ---------------------------------------------------------------------------
// PCX header
// ---------------------------------------------------------------------------

export type PcxFailureKind = 'short' | 'large' | 'format' | 'invalid';
export type PcxHeaderVerdict =
  | { accepted: true; width: number; height: number; bitsPerPixel: number; planes: number; bytesPerLine: number }
  | {
      accepted: false;
      kind: PcxFailureKind;
      /** Lowest failed condition, 1 to 10. */
      condition: number;
      /** Numbers that go into the message: [length] / [width, height] / [bpp, planes] / [condition]. */
      numbers: number[];
    };

/** The ten conditions of Requirement 9.2, lowest failed condition wins. */
export function pcxHeaderOracle(bytes: Uint8Array): PcxHeaderVerdict {
  if (bytes.length < 128) return { accepted: false, kind: 'short', condition: 1, numbers: [bytes.length] };
  const u16 = (o: number) => bytes[o] + bytes[o + 1] * 256;
  const manufacturer = bytes[0];
  const version = bytes[1];
  const encoding = bytes[2];
  const bpp = bytes[3];
  const xmin = u16(4);
  const ymin = u16(6);
  const xmax = u16(8);
  const ymax = u16(10);
  const planes = bytes[65];
  const bytesPerLine = u16(66);

  const invalid = (condition: number): PcxHeaderVerdict => ({ accepted: false, kind: 'invalid', condition, numbers: [condition] });

  if (manufacturer !== 0x0a) return invalid(2);
  if (![0, 2, 3, 4, 5].includes(version)) return invalid(3);
  if (encoding !== 1) return invalid(4);
  if (xmax < xmin || ymax < ymin) return invalid(5);
  const width = xmax - xmin + 1;
  const height = ymax - ymin + 1;
  if (width > 4096 || height > 4096) return { accepted: false, kind: 'large', condition: 6, numbers: [width, height] };
  if (width * height > 2048 * 2048) return { accepted: false, kind: 'large', condition: 7, numbers: [width, height] };
  const combos: Array<[number, number]> = [[1, 1], [1, 4], [4, 1], [8, 1], [8, 3]];
  if (!combos.some(([b, p]) => b === bpp && p === planes)) {
    return { accepted: false, kind: 'format', condition: 8, numbers: [bpp, planes] };
  }
  if (bytesPerLine < Math.ceil((width * bpp) / 8) || bytesPerLine > 4096) return invalid(9);
  if (planes * bytesPerLine * height > 16 * 1024 * 1024) return invalid(10);
  return { accepted: true, width, height, bitsPerPixel: bpp, planes, bytesPerLine };
}

// ---------------------------------------------------------------------------
// PCX RLE reference
// ---------------------------------------------------------------------------

export interface RleReference {
  /** Exactly `wanted` bytes; missing bytes are zero. */
  data: Uint8Array;
  /** Bytes actually decoded from the stream (at most `wanted`). */
  filled: number;
  /** True when the stream ended before `wanted` bytes were decoded. */
  truncated: boolean;
}

/** Plain two-branch RLE decoder with no shortcuts (Requirement 10.1 to 10.5). */
export function referenceRle(stream: Uint8Array, wanted: number): RleReference {
  const data = new Uint8Array(wanted);
  let filled = 0;
  let pos = 0;
  while (filled < wanted && pos < stream.length) {
    const b = stream[pos++];
    if (b >= 0xc0) {
      if (pos >= stream.length) break; // run byte with no data byte: discard
      const value = stream[pos++];
      let count = b & 0x3f;
      while (count > 0 && filled < wanted) {
        data[filled++] = value;
        count--;
      }
    } else {
      data[filled++] = b;
    }
  }
  return { data, filled, truncated: filled < wanted };
}

// ---------------------------------------------------------------------------
// PNG size and Adler-32
// ---------------------------------------------------------------------------

/**
 * Size of the PNG the encoder writes for a width x height RGBA image, from the
 * block layout with literals only: signature 8, IHDR chunk 12 + 13, IDAT chunk
 * 12 + (zlib 6 + filtered + 5 per stored block of at most 65,535), IEND 12.
 */
export function pngSizeFromFirstPrinciples(width: number, height: number): number {
  const filtered = height * (1 + width * 4);
  const blocks = Math.ceil(filtered / 65535);
  const idatData = 2 + filtered + 5 * blocks + 4;
  return 8 + (12 + 13) + (12 + idatData) + 12;
}

/** Adler-32 that reduces after every byte. */
export function referenceAdler32(bytes: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < bytes.length; i++) {
    a = (a + bytes[i]) % 65521;
    b = (b + a) % 65521;
  }
  return b * 65536 + a;
}

// ---------------------------------------------------------------------------
// Markdown marker decompositions
// ---------------------------------------------------------------------------

export type MarkerKind = 'bold' | 'emphasis';

export interface MarkdownMarker {
  kind: MarkerKind;
  role: 'open' | 'close';
  /** Index of the marker's first `*` in the line. */
  index: number;
  /** 2 for bold, 1 for emphasis. */
  length: 1 | 2;
}

export interface TextStyle {
  bold: boolean;
  emphasis: boolean;
}

interface LineRun {
  start: number;
  length: number;
  /** Number of text characters before this run. */
  textBefore: number;
}

interface LineScan {
  runs: LineRun[];
  /** Text characters (escapes removed), in order. */
  text: string;
}

/** Splits a line into unescaped `*` runs and text. A backslash escapes the next character. */
function scanLine(line: string): LineScan {
  const runs: LineRun[] = [];
  let text = '';
  let i = 0;
  while (i < line.length) {
    const ch = line.charAt(i);
    if (ch === '\\' && i + 1 < line.length) {
      text += line.charAt(i + 1);
      i += 2;
    } else if (ch === '*') {
      const start = i;
      while (i < line.length && line.charAt(i) === '*') i++;
      runs.push({ start, length: i - start, textBefore: text.length });
    } else {
      text += ch;
      i++;
    }
  }
  return { runs, text };
}

/** The text of a line with escapes and unescaped `*` characters removed. */
export function markdownLineText(line: string): string {
  return scanLine(line).text;
}

type Stack = readonly MarkerKind[];

/** Applies one marker to the stack, or returns null when the nesting rule forbids it. */
function applyMarker(stack: Stack, kind: MarkerKind): { next: Stack; role: 'open' | 'close' } | null {
  const at = stack.indexOf(kind);
  if (at < 0) {
    if (stack.length >= 2) return null;
    return { next: [...stack, kind], role: 'open' };
  }
  if (at === stack.length - 1) return { next: stack.slice(0, -1), role: 'close' };
  return null;
}

/**
 * Every valid decomposition of the unescaped `*` runs of one line into `**` (bold)
 * and `*` (emphasis) markers: properly nested, at most two distinct kinds open at
 * once, every marker closed by the end of the line. At most `limit` are returned.
 * Recursion depth is the number of markers, so use this on short lines; for long
 * lines use findMarkdownDecomposition.
 */
export function markdownLineDecompositions(line: string, limit = 1000): MarkdownMarker[][] {
  const { runs } = scanLine(line);
  const results: MarkdownMarker[][] = [];
  const current: MarkdownMarker[] = [];

  function walk(runIndex: number, offset: number, stack: Stack): void {
    if (results.length >= limit) return;
    if (runIndex === runs.length) {
      if (stack.length === 0) results.push(current.slice());
      return;
    }
    const run = runs[runIndex];
    if (offset === run.length) {
      walk(runIndex + 1, 0, stack);
      return;
    }
    const choices: Array<{ kind: MarkerKind; length: 1 | 2 }> = [{ kind: 'emphasis', length: 1 }];
    if (run.length - offset >= 2) choices.push({ kind: 'bold', length: 2 });
    for (const c of choices) {
      const applied = applyMarker(stack, c.kind);
      if (!applied) continue;
      current.push({ kind: c.kind, role: applied.role, index: run.start + offset, length: c.length });
      walk(runIndex, offset + c.length, applied.next);
      current.pop();
    }
  }
  walk(0, 0, []);
  return results;
}

export interface FindOptions {
  /** Opening markers need a non-space next character, closing ones a non-space previous character. */
  hug?: boolean;
  /** Required style of the text character with this index (escapes removed). */
  styleOf?: (textIndex: number) => TextStyle;
}

interface Node {
  stack: Stack;
  prev: Node | null;
  marker: MarkdownMarker | null;
}

function stackKey(stack: Stack): string {
  return stack.join(',');
}

/**
 * Iterative search (linear in line length) for one decomposition that satisfies the
 * options, or null. Reachable stacks are tracked per position, so it does not
 * enumerate and cannot blow up on long lines.
 */
export function findMarkdownDecomposition(line: string, options: FindOptions = {}): MarkdownMarker[] | null {
  const { hug = false, styleOf } = options;
  const { runs, text } = scanLine(line);

  let states = new Map<string, Node>();
  states.set('', { stack: [], prev: null, marker: null });

  let textIndex = 0;
  const checkText = (upTo: number): void => {
    // Filter states by the style of text characters textIndex .. upTo - 1.
    if (!styleOf) {
      textIndex = upTo;
      return;
    }
    for (; textIndex < upTo; textIndex++) {
      const want = styleOf(textIndex);
      for (const [key, node] of [...states]) {
        const hasBold = node.stack.includes('bold');
        const hasEm = node.stack.includes('emphasis');
        if (hasBold !== want.bold || hasEm !== want.emphasis) states.delete(key);
      }
    }
  };

  for (let r = 0; r < runs.length; r++) {
    const run = runs[r];
    checkText(run.textBefore);
    if (states.size === 0) return null;

    // layers[offset] = reachable states after consuming `offset` stars of this run
    const layers: Array<Map<string, Node>> = [];
    for (let k = 0; k <= run.length; k++) layers.push(new Map());
    layers[0] = states;
    for (let off = 0; off < run.length; off++) {
      for (const node of layers[off].values()) {
        const choices: Array<{ kind: MarkerKind; length: 1 | 2 }> = [{ kind: 'emphasis', length: 1 }];
        if (run.length - off >= 2) choices.push({ kind: 'bold', length: 2 });
        for (const c of choices) {
          const applied = applyMarker(node.stack, c.kind);
          if (!applied) continue;
          const index = run.start + off;
          if (hug) {
            if (applied.role === 'open') {
              const next = line.charAt(index + c.length);
              if (index + c.length >= line.length || next === ' ') continue;
            } else {
              const before = line.charAt(index - 1);
              if (index === 0 || before === ' ') continue;
            }
          }
          const key = stackKey(applied.next);
          const target = layers[off + c.length];
          if (!target.has(key)) {
            target.set(key, {
              stack: applied.next,
              prev: node,
              marker: { kind: c.kind, role: applied.role, index, length: c.length },
            });
          }
        }
      }
    }
    states = layers[run.length];
    if (states.size === 0) return null;
  }
  checkText(text.length);

  const final = states.get('');
  if (!final) return null;
  const markers: MarkdownMarker[] = [];
  for (let n: Node | null = final; n; n = n.prev) if (n.marker) markers.push(n.marker);
  return markers.reverse();
}

/** Balanced, nested and hugging markers exist for this line (Property 13). */
export function lineMarkersBalanced(line: string): boolean {
  return findMarkdownDecomposition(line, { hug: true }) !== null;
}

/**
 * Style-per-character check (Property 12): some decomposition puts every text
 * character inside a bold pair exactly when `expected[i].bold`, and inside an
 * emphasis pair exactly when `expected[i].emphasis`.
 */
export function lineMatchesStyles(line: string, expected: readonly TextStyle[], hug = false): boolean {
  if (markdownLineText(line).length !== expected.length) return false;
  return findMarkdownDecomposition(line, { hug, styleOf: (i) => expected[i] }) !== null;
}

// ---------------------------------------------------------------------------
// Plain text
// ---------------------------------------------------------------------------

/** True for a byte the plain text rule keeps as is (before line ending handling). */
function isKeptTextByte(b: number): boolean {
  return b === 0x09 || (b >= 0x20 && b <= 0x7e) || b >= 0x80;
}

/**
 * Independent model of the plain text converter: cut at the first 0x1A, turn CR LF,
 * lone CR and lone LF into one LF, drop control bytes and DEL (counted), decode as CP437.
 * Written as a split into segments, not as the converter's single pass.
 */
export function plainTextOracle(bytes: Uint8Array): { text: string; dropped: number } {
  const eof = bytes.indexOf(0x1a);
  const head = eof < 0 ? bytes : bytes.subarray(0, eof);

  let dropped = 0;
  const kept: number[] = [];
  let previousWasCr = false;
  for (let i = 0; i < head.length; i++) {
    const b = head[i];
    if (b === 0x0d) {
      kept.push(0x0a);
    } else if (b === 0x0a) {
      if (!previousWasCr) kept.push(0x0a);
    } else if (b === 0x0c || isKeptTextByte(b)) {
      kept.push(b);
    } else {
      dropped++;
    }
    previousWasCr = b === 0x0d;
  }
  return { text: decodeCp437(Uint8Array.from(kept)), dropped };
}

/** The text content rule: non-empty and every byte is TAB, LF, FF, CR, 0x1A or 0x20..0x7E. */
export function isTextSampleOracle(bytes: Uint8Array): boolean {
  const sample = bytes.subarray(0, 4096);
  if (sample.length === 0) return false;
  return sample.every((b) => [0x09, 0x0a, 0x0c, 0x0d, 0x1a].includes(b) || (b >= 0x20 && b <= 0x7e));
}

const TEXT_EXTENSIONS: readonly string[] = ['TXT', 'BAT', 'ASC', 'LOG', 'NFO', 'DIZ', '1ST', 'ME'];
const EXTENSION_FORMATS: Readonly<Record<string, OracleFormat | 'text'>> = {
  WS: 'wordstar',
  WS4: 'wordstar',
  WS5: 'wordstar',
  WS6: 'wordstar',
  WS7: 'wordstar',
  WSD: 'wordstar',
  DBF: 'dbase',
  PCX: 'pcx',
};

export interface FullOracleVerdict {
  format: OracleFormat | 'text';
  source: 'content' | 'extension' | 'none';
}

/**
 * All five detection rules in order: PCX, dBase, WordStar content, file name extension,
 * text content. A file name that is not a string or longer than 255 characters is ignored.
 */
export function detectFullOracle(bytes: Uint8Array, fileName?: unknown): FullOracleVerdict {
  const content = detectOracle(bytes);
  if (content !== 'unknown') return { format: content, source: 'content' };

  if (typeof fileName === 'string' && fileName.length <= 255) {
    const dot = fileName.lastIndexOf('.');
    if (dot >= 0) {
      let ext = '';
      for (const ch of fileName.slice(dot + 1)) {
        ext += ch >= 'a' && ch <= 'z' ? ch.toUpperCase() : ch;
      }
      const strong = EXTENSION_FORMATS[ext];
      if (strong !== undefined && Object.prototype.hasOwnProperty.call(EXTENSION_FORMATS, ext)) {
        return { format: strong, source: 'extension' };
      }
      if (TEXT_EXTENSIONS.includes(ext)) return { format: 'text', source: 'extension' };
    }
  }

  if (isTextSampleOracle(bytes)) return { format: 'text', source: 'content' };
  return { format: 'unknown', source: 'none' };
}

/**
 * Inverse of decodeCp437, built by decoding each byte value once (no second table).
 * Returns null when a character has no CP437 byte. Where two bytes decode to the same
 * character, the lowest byte wins.
 */
export function encodeCp437(text: string): Uint8Array | null {
  const byChar = new Map<string, number>();
  for (let b = 0; b < 256; b++) {
    const ch = decodeCp437(Uint8Array.of(b));
    if (!byChar.has(ch)) byChar.set(ch, b);
  }
  const out = new Uint8Array(text.length);
  let n = 0;
  for (const ch of text) {
    const b = byChar.get(ch);
    if (b === undefined) return null;
    if (n >= out.length) return null; // astral characters never map; defensive
    out[n++] = b;
  }
  return out.subarray(0, n);
}
