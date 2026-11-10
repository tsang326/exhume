// WordStar to Markdown: a one-pass character-level state machine.
// No regular expressions, no recursion; every loop step consumes at least one input byte.

import { asciiUpper, isAsciiLetter, isDigit } from './chars';
import { assertUint8Array, guarded, limitInput } from './guard';
import { MAX_MARKDOWN_OUTPUT_BYTES } from './limits';
import { okResult } from './result';
import { TEMPLATES, fill } from './templates';
import { makeTextSink } from './textsink';
import { ConversionWarningCode } from './types';
import type { MarkdownResult } from './types';
import { makeWarningCollector } from './warnings';

const KIND_SOFT = 1;
const KIND_HARD = 2;
const KIND_CHAR = 3;

const STYLE_BOLD = 0;
const STYLE_EM = 1;

const CHAR_LF = 0x0a;
const CHAR_SPACE = 0x20;
const CHAR_DOT = 0x2e;
const CHAR_BACKSLASH = 0x5c;

const PA_BLOCK = '\n---\n\n';

function markerLength(style: number): number {
  return style === STYLE_BOLD ? 2 : 1;
}

function stackLength(stack: readonly number[]): number {
  let n = 0;
  for (let i = 0; i < stack.length; i++) n += markerLength(stack[i]);
  return n;
}

function needsEscape(c: number, atLineStart: boolean): boolean {
  switch (c) {
    case 0x5c: // \
    case 0x60: // `
    case 0x2a: // *
    case 0x5f: // _
    case 0x3c: // <
    case 0x3e: // >
    case 0x5b: // [
    case 0x5d: // ]
      return true;
    case 0x23: // #
    case 0x2b: // +
    case 0x2d: // -
      return atLineStart;
    default:
      return false;
  }
}

/** Public converter: cap is MAX_MARKDOWN_OUTPUT_BYTES. */
export function convertWordStar(input: Uint8Array): MarkdownResult {
  return runWordStar(input, MAX_MARKDOWN_OUTPUT_BYTES);
}

/** Test seam: same code with a caller-chosen cap (<= MAX_MARKDOWN_OUTPUT_BYTES). */
export function runWordStar(input: Uint8Array, outputCap: number): MarkdownResult {
  assertUint8Array(input);
  const w = makeWarningCollector();
  return guarded(() => convert(limitInput(input, w), outputCap, w), w);
}

function convert(
  input: Uint8Array,
  outputCap: number,
  w: ReturnType<typeof makeWarningCollector>,
): MarkdownResult {
  const n = input.length;
  const sink = makeTextSink();

  let pendingSpaces = 0;
  let wantBold = false;
  let wantEm = false;
  let open: number[] = [];
  let textCol = 0;
  let lineStart = true;
  let atBreak = true;
  let leadingDigit = false;
  let dropped = 0;
  let dotIgnored = 0;
  let capped = false;
  let hasOut = false; // a visible character has been written
  let needBlank = false; // a content line ended; the next visible text starts a paragraph
  let ruleDue = false; // a .PA line was seen after output; write a rule before the next text

  // Token reader results.
  let tokKind = 0;
  let tokC = 0;
  let tokLen = 0;
  let tokSoftSpace = false;

  let prevHyphen = false; // the previous token was a soft hyphen
  let runOrdinary = 0; // ordinary spaces, tabs and soft-return spaces in the pending run
  let runSoft = 0; // soft spaces (raw 0xA0) in the pending run

  function readToken(pos: number): void {
    const raw = input[pos];
    tokSoftSpace = false;
    if (
      (raw === 0x8d || raw === 0x0d) &&
      pos + 1 < n &&
      (input[pos + 1] === 0x0a || input[pos + 1] === 0x8a)
    ) {
      tokKind = raw === 0x8d ? KIND_SOFT : KIND_HARD;
      tokC = 0;
      tokLen = 2;
      return;
    }
    const c = raw & 0x7f;
    tokLen = 1;
    tokC = c;
    tokKind = c === 0x0d || c === CHAR_LF ? KIND_HARD : KIND_CHAR;
    tokSoftSpace = raw === 0xa0;
  }

  function wanted(style: number): boolean {
    return style === STYLE_BOLD ? wantBold : wantEm;
  }

  function pushMarkers(stack: readonly number[], from: number, to: number, reverse: boolean): void {
    if (reverse) {
      for (let j = to - 1; j >= from; j--) {
        sink.pushString(stack[j] === STYLE_BOLD ? '**' : '*');
      }
    } else {
      for (let j = from; j < to; j++) {
        sink.pushString(stack[j] === STYLE_BOLD ? '**' : '*');
      }
    }
  }

  function pushSpaces(count: number): void {
    for (let j = 0; j < count; j++) sink.push(CHAR_SPACE);
  }

  /** Writes one visible character (with its escape) lazily wrapped in markers. */
  function writeChar(c: number): void {
    // Escape decision.
    const atLineStart = textCol === 0 && pendingSpaces === 0;
    let escape = needsEscape(c, atLineStart);
    if (
      !escape &&
      leadingDigit &&
      textCol === 1 &&
      pendingSpaces === 0 &&
      (c === CHAR_DOT || c === 0x29)
    ) {
      escape = true;
    }
    const charLen = escape ? 2 : 1;

    // Lowest open style that is no longer wanted.
    let k = open.length;
    for (let j = 0; j < open.length; j++) {
      if (!wanted(open[j])) {
        k = j;
        break;
      }
    }
    const needBold = wantBold && open.indexOf(STYLE_BOLD) < 0;
    const needEm = wantEm && open.indexOf(STYLE_EM) < 0;

    // Markers from index k up are closed; wanted ones among them reopen, then new ones open.
    let newOpen: number[] = open;
    let closeLen = 0;
    if (k < open.length || needBold || needEm) {
      newOpen = open.slice(0, k);
      for (let j = k; j < open.length; j++) {
        closeLen += markerLength(open[j]);
        if (wanted(open[j])) newOpen.push(open[j]);
      }
      if (needBold) newOpen.push(STYLE_BOLD);
      if (needEm) newOpen.push(STYLE_EM);
    }
    const reserve = stackLength(newOpen);
    const openLen = reserve - stackLength(newOpen.slice(0, k));
    const prefix = ruleDue ? PA_BLOCK : needBlank ? '\n' : '';
    const groupLen = closeLen + pendingSpaces + openLen + charLen + prefix.length;
    if (sink.length + groupLen + reserve > outputCap) {
      capped = true;
      return;
    }

    if (prefix.length > 0) sink.pushString(prefix);
    ruleDue = false;
    needBlank = false;
    pushMarkers(open, k, open.length, true);
    pushSpaces(pendingSpaces);
    pendingSpaces = 0;
    runOrdinary = 0;
    runSoft = 0;
    pushMarkers(newOpen, k, newOpen.length, false);
    open = newOpen;
    if (escape) sink.push(CHAR_BACKSLASH);
    sink.push(c);

    leadingDigit = atLineStart && isDigit(c);
    textCol++;
    atBreak = false;
    hasOut = true;
  }

  /** Closes all markers, writes pending spaces and optionally a line feed. */
  function writeHard(): void {
    if (textCol > 0) {
      const closeLen = stackLength(open);
      if (sink.length + closeLen + pendingSpaces + 1 > outputCap) {
        capped = true;
        return;
      }
      pushMarkers(open, 0, open.length, true);
      open = [];
      pushSpaces(pendingSpaces);
      pendingSpaces = 0;
      sink.push(CHAR_LF);
      needBlank = true;
    } else {
      pendingSpaces = 0;
    }
    runOrdinary = 0;
    runSoft = 0;
    textCol = 0;
    leadingDigit = false;
    atBreak = true;
    lineStart = true;
  }

  let i = 0;
  scan: while (i < n) {
    if (lineStart && (input[i] & 0x7f) === CHAR_DOT && i + 1 < n) {
      const b1 = input[i + 1] & 0x7f;
      let comment = false;
      let command = false;
      let isPa = false;
      if (b1 === CHAR_DOT) {
        comment = true;
      } else if (i + 2 < n && isAsciiLetter(b1) && isAsciiLetter(input[i + 2] & 0x7f)) {
        command = true;
        isPa =
          asciiUpper(b1) === 0x50 &&
          asciiUpper(input[i + 2] & 0x7f) === 0x41 &&
          !(i + 3 < n && isAsciiLetter(input[i + 3] & 0x7f));
      }
      if (comment || command) {
        if (command && !isPa) dotIgnored++;
        // Skip the line with the same tokenizer.
        let stop = false;
        let j = i;
        while (j < n) {
          readToken(j);
          j += tokLen;
          if (tokKind === KIND_CHAR && tokC === 0x1a) {
            stop = true;
            break;
          }
          if (tokKind === KIND_HARD) break;
        }
        i = j;
        if (isPa) {
          if (hasOut) ruleDue = true;
          atBreak = true;
        }
        if (stop) break scan;
        continue;
      }
    }

    readToken(i);
    i += tokLen;
    const afterHyphen = prevHyphen;
    prevHyphen = false;

    if (tokKind === KIND_HARD) {
      writeHard();
      if (capped) break;
      continue;
    }
    if (tokKind === KIND_SOFT) {
      lineStart = false;
      if (!atBreak && !afterHyphen) {
        pendingSpaces++;
        runOrdinary++;
        atBreak = true;
      }
      continue;
    }

    const c = tokC;
    lineStart = false;
    if (c === 0x1a) break;
    if (c === 0x00) continue;
    if (c === 0x1f) {
      prevHyphen = true;
      continue;
    }
    if (c === 0x02) {
      wantBold = !wantBold;
      continue;
    }
    if (c === 0x13 || c === 0x19) {
      wantEm = !wantEm;
      continue;
    }
    if (c === 0x09 || c === CHAR_SPACE) {
      if (tokSoftSpace) {
        if (runOrdinary === 0) {
          pendingSpaces++;
          runSoft++;
        }
      } else {
        if (runOrdinary === 0) {
          pendingSpaces -= runSoft;
          runSoft = 0;
        }
        pendingSpaces++;
        runOrdinary++;
      }
      atBreak = true;
      continue;
    }
    if (c >= 0x21 && c <= 0x7e) {
      writeChar(c);
      if (capped) break;
      continue;
    }
    dropped++;
  }

  // Final flush: close markers (they fit by the reserve), then trailing spaces if they fit.
  pushMarkers(open, 0, open.length, true);
  open = [];
  if (pendingSpaces > 0) {
    if (textCol > 0 || !hasOut) {
      if (sink.length + pendingSpaces <= outputCap) {
        pushSpaces(pendingSpaces);
      } else {
        capped = true;
      }
    }
    pendingSpaces = 0;
  }

  if (dropped > 0) {
    w.add(ConversionWarningCode.ControlCodesDropped, fill(TEMPLATES.controlCodesDropped, dropped));
  }
  if (dotIgnored > 0) {
    w.add(ConversionWarningCode.DotCommandsIgnored, fill(TEMPLATES.dotCommandsIgnored, dotIgnored));
  }
  if (capped) {
    w.add(ConversionWarningCode.OutputCapped, fill(TEMPLATES.outputCappedMarkdown, outputCap));
  }
  return okResult(sink.finish(), 'text/markdown', '.md', w);
}
