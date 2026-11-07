// Format detection: content rules first (PCX, dBase, WordStar), then the file
// name extension, then the plain text content rule, then unknown. The file name is used for the extension only.

import { asciiUpper, isAsciiLetter } from './chars';
import { assertUint8Array } from './guard';
import { DBF_MAX_HEADER_BYTES, DBF_MIN_HEADER_BYTES, DETECT_SAMPLE_BYTES } from './limits';
import type { DetectResult } from './types';

const MAX_FILE_NAME_CHARS = 255;
const PCX_MIN_BYTES = 4;
const PCX_MAGIC = 0x0a;
const DBF_MIN_BYTES = 12;
const DBF_VERSION_3 = 0x03;
const DBF_VERSION_3_MEMO = 0x83;
const DBF_MIN_RECORD_BYTES = 2;
const BYTE_SHIFT = 8;
const SOFT_CR = 0x8d;
const HARD_CR = 0x0d;
const LF = 0x0a;
const SOFT_LF = 0x8a;
const DOT = 0x2e;
const STYLE_BOLD = 0x02;
const STYLE_UNDERLINE = 0x13;
const STYLE_ITALIC = 0x19;
const DOT_PREFIX_BYTES = 3; // '.' plus two letters
const TEXT_PRINTABLE_MIN = 0x20;
const TEXT_PRINTABLE_MAX = 0x7e;
const TEXT_TAB = 0x09;
const TEXT_FF = 0x0c;
const TEXT_EOF = 0x1a;

function isPcx(s: Uint8Array): boolean {
  if (s.length < PCX_MIN_BYTES || s[0] !== PCX_MAGIC) return false;
  const v = s[1];
  const bpp = s[3];
  const versionOk = v === 0 || v === 2 || v === 3 || v === 4 || v === 5;
  const bppOk = bpp === 1 || bpp === 2 || bpp === 4 || bpp === 8;
  return versionOk && s[2] === 1 && bppOk;
}

function isDbase(s: Uint8Array, totalLength: number): boolean {
  if (s.length < DBF_MIN_BYTES) return false;
  if (s[0] !== DBF_VERSION_3 && s[0] !== DBF_VERSION_3_MEMO) return false;
  const headerLength = s[8] + s[9] * (1 << BYTE_SHIFT);
  const recordLength = s[10] + s[11] * (1 << BYTE_SHIFT);
  return (
    headerLength >= DBF_MIN_HEADER_BYTES &&
    headerLength <= DBF_MAX_HEADER_BYTES &&
    recordLength >= DBF_MIN_RECORD_BYTES &&
    headerLength < totalLength
  );
}

/** One bounded pass: soft return, dot command line, or style toggle plus hard return. */
function isWordStar(s: Uint8Array): boolean {
  const n = s.length;
  let toggle = false;
  let hard = false;
  let atLineStart = true;
  for (let i = 0; i < n; i++) {
    const b = s[i];
    if (
      atLineStart &&
      b === DOT &&
      i + DOT_PREFIX_BYTES <= n &&
      isAsciiLetter(s[i + 1]) &&
      isAsciiLetter(s[i + 2])
    ) {
      return true;
    }
    atLineStart = false;
    if (b === SOFT_CR && i + 1 < n && (s[i + 1] === LF || s[i + 1] === SOFT_LF)) return true;
    if (b === HARD_CR && i + 1 < n && s[i + 1] === LF) {
      hard = true;
      atLineStart = true;
      i++; // the pair is one hard return; the next byte starts a line
      if (toggle) return true;
      continue;
    }
    if (b === STYLE_BOLD || b === STYLE_UNDERLINE || b === STYLE_ITALIC) {
      toggle = true;
      if (hard) return true;
    }
  }
  return false;
}

/** One bounded pass: non-empty and only text content bytes (printable ASCII, TAB, LF, FF, CR, EOF). */
function isTextSample(s: Uint8Array): boolean {
  if (s.length === 0) return false;
  for (let i = 0; i < s.length; i++) {
    const b = s[i];
    const ok =
      (b >= TEXT_PRINTABLE_MIN && b <= TEXT_PRINTABLE_MAX) ||
      b === TEXT_TAB ||
      b === LF ||
      b === TEXT_FF ||
      b === HARD_CR ||
      b === TEXT_EOF;
    if (!ok) return false;
  }
  return true;
}

function foldAscii(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    out += String.fromCharCode(asciiUpper(text.charCodeAt(i)));
  }
  return out;
}

function formatFromExtension(fileName: string): DetectResult['format'] {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) return 'unknown';
  switch (foldAscii(fileName.slice(dot + 1))) {
    case 'WS':
    case 'WS4':
    case 'WS5':
    case 'WS6':
    case 'WS7':
    case 'WSD':
      return 'wordstar';
    case 'DBF':
      return 'dbase';
    case 'PCX':
      return 'pcx';
    case 'TXT':
    case 'BAT':
    case 'ASC':
    case 'LOG':
    case 'NFO':
    case 'DIZ':
    case '1ST':
    case 'ME':
      return 'text';
    default:
      return 'unknown';
  }
}

export function detectFormat(input: Uint8Array, fileName?: unknown): DetectResult {
  assertUint8Array(input);
  const sample = input.subarray(0, DETECT_SAMPLE_BYTES);

  if (isPcx(sample)) return { format: 'pcx', source: 'content' };
  if (isDbase(sample, input.length)) return { format: 'dbase', source: 'content' };
  if (isWordStar(sample)) return { format: 'wordstar', source: 'content' };

  if (typeof fileName === 'string' && fileName.length <= MAX_FILE_NAME_CHARS) {
    const format = formatFromExtension(fileName);
    if (format !== 'unknown') return { format, source: 'extension' };
  }
  if (isTextSample(sample)) return { format: 'text', source: 'content' };
  return { format: 'unknown', source: 'none' };
}
