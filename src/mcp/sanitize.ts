// Sanitizer for text that comes from a disk image (Requirement 11).
// One forward pass over UTF-16 code units. No regular expression, no recursion.

import {
  CP_BIDI_EMBED_MAX,
  CP_BIDI_EMBED_MIN,
  CP_BIDI_ISOLATE_MAX,
  CP_BIDI_ISOLATE_MIN,
  CP_BOM,
  CP_C0_MAX,
  CP_C1_MAX,
  CP_C1_MIN,
  CP_CR,
  CP_DEL,
  CP_HIGH_SURROGATE_MAX,
  CP_HIGH_SURROGATE_MIN,
  CP_LF,
  CP_LINE_SEPARATOR,
  CP_LOW_SURROGATE_MAX,
  CP_LOW_SURROGATE_MIN,
  CP_PARAGRAPH_SEPARATOR,
  CP_TAB,
  MAX_NAME_CHARS,
  REPLACEMENT,
} from './limits';

export interface SanitizeOptions {
  multiline: boolean;
}

export interface CappedText {
  text: string;
  total: number;
  truncated: boolean;
}

const REPLACEMENT_CHAR = String.fromCharCode(REPLACEMENT);
const SPACE_CHAR = ' ';
const LF_CHAR = '\n';
const TAB_CHAR = '\t';

function isHigh(c: number): boolean {
  return c >= CP_HIGH_SURROGATE_MIN && c <= CP_HIGH_SURROGATE_MAX;
}

function isLow(c: number): boolean {
  return c >= CP_LOW_SURROGATE_MIN && c <= CP_LOW_SURROGATE_MAX;
}

function isForbiddenUnit(c: number): boolean {
  return (
    c <= CP_C0_MAX ||
    c === CP_DEL ||
    (c >= CP_C1_MIN && c <= CP_C1_MAX) ||
    c === CP_LINE_SEPARATOR ||
    c === CP_PARAGRAPH_SEPARATOR ||
    (c >= CP_BIDI_EMBED_MIN && c <= CP_BIDI_EMBED_MAX) ||
    (c >= CP_BIDI_ISOLATE_MIN && c <= CP_BIDI_ISOLATE_MAX) ||
    c === CP_BOM
  );
}

/** Single pass. Stores at most `cap` units, but counts every output unit. */
function run(input: string, multiline: boolean, cap: number): CappedText {
  const parts: string[] = [];
  let stored = 0;
  let total = 0;
  let full = false;

  const emit = (piece: string): void => {
    total += piece.length;
    if (full) return;
    if (stored + piece.length > cap) {
      full = true;
      return;
    }
    parts.push(piece);
    stored += piece.length;
  };

  const length = input.length;
  let i = 0;
  while (i < length) {
    const c = input.charCodeAt(i);
    if (isHigh(c)) {
      const next = i + 1 < length ? input.charCodeAt(i + 1) : 0;
      if (isLow(next)) {
        emit(input.slice(i, i + 2));
        i += 2;
      } else {
        emit(REPLACEMENT_CHAR);
        i += 1;
      }
      continue;
    }
    i += 1;
    if (isLow(c)) {
      emit(REPLACEMENT_CHAR);
    } else if (c === CP_CR) {
      if (!multiline) {
        emit(SPACE_CHAR);
      } else if (i < length && input.charCodeAt(i) === CP_LF) {
        // CR before LF is dropped; the LF is handled next.
      } else {
        emit(LF_CHAR);
      }
    } else if (c === CP_LF) {
      emit(multiline ? LF_CHAR : SPACE_CHAR);
    } else if (c === CP_TAB) {
      emit(multiline ? TAB_CHAR : SPACE_CHAR);
    } else if (isForbiddenUnit(c)) {
      emit(REPLACEMENT_CHAR);
    } else {
      emit(String.fromCharCode(c));
    }
  }

  return { text: parts.join(''), total, truncated: total > cap };
}

export function sanitizeText(input: string, opts: SanitizeOptions): string {
  return run(input, opts.multiline, Number.POSITIVE_INFINITY).text;
}

export function sanitizeCapped(input: string, opts: SanitizeOptions, capUnits: number): CappedText {
  return run(input, opts.multiline, capUnits);
}

/** Cut `s` to at most `cap` units, never inside a surrogate pair. */
export function capUnits(s: string, cap: number): string {
  if (s.length <= cap) return s;
  let cut = cap;
  if (cut > 0 && isHigh(s.charCodeAt(cut - 1)) && isLow(s.charCodeAt(cut))) {
    cut -= 1;
  }
  return s.slice(0, cut);
}

export function viewPath(corePath: string): string {
  return capUnits(sanitizeText(corePath, { multiline: false }), MAX_NAME_CHARS);
}
