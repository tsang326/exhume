// Safe_Markdown_Subset parser: pure, total, iterative and linear. No DOM, no recursion.
// Disk text only ever ends up in `text` node values.

import { MD_PREVIEW_CHARS } from './limits';

export type InlineNode =
  | { type: 'text'; value: string }
  | { type: 'line-break' }
  | { type: 'strong'; children: InlineNode[] }
  | { type: 'emphasis'; children: InlineNode[] };

export type BlockNode =
  | { type: 'paragraph'; children: InlineNode[] }
  | { type: 'thematic-break' };

/** `dropped`: delimiter and line-feed characters that are not part of any text node. */
export interface MarkdownModel {
  blocks: BlockNode[];
  dropped: number;
}

type Style = 'strong' | 'emphasis';

/** Inline events recorded in one forward scan, then paired in a second pass. */
type InlineEvent =
  | { k: 0; v: string }
  | { k: 1 }
  | { k: 2; style: Style; matched: boolean }
  | { k: 3 };

const MAX_DEPTH = 2;
const CH_STAR = 0x2a;
const CH_BACKSLASH = 0x5c;

function isAlwaysEscaped(c: string): boolean {
  return (
    c === '\\' || c === '`' || c === '*' || c === '_' || c === '<' || c === '>' || c === '[' || c === ']'
  );
}

/**
 * Whether `d` after a backslash forms an escape. `col` is the text column on the
 * current line (marker characters do not count) and `firstDigit` says whether the
 * character at text column 0 was a digit.
 */
function isEscape(d: string, col: number, firstDigit: boolean): boolean {
  if (isAlwaysEscaped(d)) return true;
  if (col === 0 && (d === '#' || d === '+' || d === '-')) return true;
  return col === 1 && firstDigit && (d === '.' || d === ')');
}

function addText(list: InlineNode[], value: string): void {
  if (value.length === 0) return;
  const last = list.length > 0 ? list[list.length - 1] : undefined;
  if (last !== undefined && last.type === 'text') {
    last.value += value;
  } else {
    list.push({ type: 'text', value });
  }
}

/** Builds one paragraph from its lines; returns the node and the characters it dropped. */
function buildParagraph(
  lines: readonly string[],
): { node: BlockNode; dropped: number; scan: number; events: number; pair: number } {
  const events: InlineEvent[] = [];
  const open: number[] = []; // indexes into `events` of open markers, at most MAX_DEPTH
  let dropped = 0;
  let scan = 0;
  let pair = 0;

  for (let li = 0; li < lines.length; li++) {
    if (li > 0) events.push({ k: 1 });
    const line = lines[li];
    const len = line.length;
    let col = 0;
    let firstDigit = false;
    let runStart = 0;
    let i = 0;

    const flush = (end: number): void => {
      if (end > runStart) events.push({ k: 0, v: line.slice(runStart, end) });
    };

    while (i < len) {
      scan++;
      const c = line.charCodeAt(i);
      if (c === CH_BACKSLASH && i + 1 < len) {
        const d = line[i + 1];
        if (isEscape(d, col, firstDigit)) {
          flush(i);
          events.push({ k: 0, v: d });
          dropped++;
          if (col === 0) firstDigit = false;
          col++;
          i += 2;
          runStart = i;
          continue;
        }
      }
      if (c === CH_STAR) {
        flush(i);
        let j = i;
        while (j < len && line.charCodeAt(j) === CH_STAR) j++;
        let n = j - i;
        scan += n;
        while (n > 0) {
          scan++;
          const topIdx = open.length > 0 ? open[open.length - 1] : -1;
          const top = topIdx >= 0 ? (events[topIdx] as { k: 2; style: Style; matched: boolean }) : null;
          if (top !== null && top.style === 'emphasis') {
            top.matched = true;
            open.pop();
            events.push({ k: 3 });
            n -= 1;
          } else if (top !== null && top.style === 'strong' && n >= 2) {
            top.matched = true;
            open.pop();
            events.push({ k: 3 });
            n -= 2;
          } else if (open.length < MAX_DEPTH) {
            const style: Style = n >= 2 ? 'strong' : 'emphasis';
            events.push({ k: 2, style, matched: false });
            open.push(events.length - 1);
            n -= n >= 2 ? 2 : 1;
          } else {
            events.push({ k: 0, v: '*' });
            if (col === 0) firstDigit = false;
            col++;
            n -= 1;
          }
        }
        i = j;
        runStart = i;
        continue;
      }
      if (col === 0) firstDigit = c >= 0x30 && c <= 0x39;
      col++;
      i++;
    }
    flush(len);
  }

  // Pairing pass: matched markers become nodes, unmatched ones turn back into text.
  const root: InlineNode[] = [];
  const containers: InlineNode[][] = [root];
  let cur = root;
  for (let e = 0; e < events.length; e++) {
    pair++;
    const ev = events[e];
    if (ev.k === 0) {
      addText(cur, ev.v);
    } else if (ev.k === 1) {
      cur.push({ type: 'line-break' });
    } else if (ev.k === 2) {
      if (ev.matched) {
        const children: InlineNode[] = [];
        cur.push({ type: ev.style, children });
        containers.push(children);
        cur = children;
        dropped += ev.style === 'strong' ? 4 : 2;
      } else {
        addText(cur, ev.style === 'strong' ? '**' : '*');
      }
    } else {
      containers.pop();
      cur = containers[containers.length - 1];
    }
  }
  return { node: { type: 'paragraph', children: root }, dropped, scan, events: events.length, pair };
}

/** Loop step counts of one parse. Used by tests to check linear scaling without a clock. */
export interface MarkdownStats {
  lineSteps: number;
  scanSteps: number;
  events: number;
  pairSteps: number;
}

/** Same parse as parseMarkdown, plus the number of steps the loops took. Used by tests. */
export function parseMarkdownWithStats(text: string): { model: MarkdownModel; stats: MarkdownStats } {
  const blocks: BlockNode[] = [];
  let dropped = 0;
  let para: string[] = [];
  let lineSteps = 0;
  let scanSteps = 0;
  let events = 0;
  let pairSteps = 0;

  const endParagraph = (): void => {
    if (para.length === 0) return;
    const built = buildParagraph(para);
    blocks.push(built.node);
    dropped += built.dropped;
    scanSteps += built.scan;
    events += built.events;
    pairSteps += built.pair;
    para = [];
  };

  const n = text.length;
  let pos = 0;
  for (;;) {
    lineSteps++;
    const nl = text.indexOf('\n', pos);
    const line = nl < 0 ? text.slice(pos) : text.slice(pos, nl);
    if (line.length === 0) {
      endParagraph();
    } else if (line === '---') {
      endParagraph();
      blocks.push({ type: 'thematic-break' });
      dropped += 3;
    } else {
      para.push(line);
    }
    if (nl < 0) break;
    dropped++; // the line feed itself
    pos = nl + 1;
    if (pos > n) break;
  }
  endParagraph();
  return { model: { blocks, dropped }, stats: { lineSteps, scanSteps, events, pairSteps } };
}

export function parseMarkdown(text: string): MarkdownModel {
  return parseMarkdownWithStats(text).model;
}

export function truncateForPreview(text: string): { text: string; shortened: boolean } {
  if (text.length > MD_PREVIEW_CHARS) {
    return { text: text.slice(0, MD_PREVIEW_CHARS), shortened: true };
  }
  return { text, shortened: false };
}

/** Text node values in document order, joined with nothing. Used by tests. */
export function plainText(model: MarkdownModel): string {
  const parts: string[] = [];
  // Explicit stack of (list, next index) frames; depth is at most 3.
  const lists: InlineNode[][] = [];
  const idx: number[] = [];
  for (let b = 0; b < model.blocks.length; b++) {
    const block = model.blocks[b];
    if (block.type !== 'paragraph') continue;
    lists.push(block.children);
    idx.push(0);
    while (lists.length > 0) {
      const top = lists.length - 1;
      const list = lists[top];
      const at = idx[top];
      if (at >= list.length) {
        lists.pop();
        idx.pop();
        continue;
      }
      idx[top] = at + 1;
      const node = list[at];
      if (node.type === 'text') {
        parts.push(node.value);
      } else if (node.type !== 'line-break') {
        lists.push(node.children);
        idx.push(0);
      }
    }
  }
  return parts.join('');
}
