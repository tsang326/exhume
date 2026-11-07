// Linear-time text scanners for the demo-disk content checks.
// One forward loop each, no regular expressions, no backtracking.

/** Longest text (in UTF-16 code units) the scanners accept. */
export const TEXT_SCAN_CAP = 1_048_576;

export interface PhoneMatch {
  index: number;
  text: string;
  /** True only for prefix 555 and a four-digit part from 0100 to 0199. */
  reserved: boolean;
}
export type PhoneScan = { ok: true; matches: PhoneMatch[] } | { ok: false; reason: 'too-long' };

export interface LinkFinding {
  index: number;
  kind: 'http' | 'https' | 'www' | 'email';
}
export type LinkScan = { ok: true; findings: LinkFinding[] } | { ok: false; reason: 'too-long' };

function isDigitAt(text: string, i: number): boolean {
  if (i < 0 || i >= text.length) return false;
  const c = text.charCodeAt(i);
  return c >= 0x30 && c <= 0x39;
}

function isLetterAt(text: string, i: number): boolean {
  if (i < 0 || i >= text.length) return false;
  const c = text.charCodeAt(i) | 0x20;
  return c >= 0x61 && c <= 0x7a && (text.charCodeAt(i) < 0x80);
}

function isHyphenAt(text: string, i: number): boolean {
  return i >= 0 && i < text.length && text.charCodeAt(i) === 0x2d;
}

/** ASCII case-insensitive comparison of `word` (lower case) at index `i`. */
function matchesWordAt(text: string, i: number, word: string): boolean {
  if (i + word.length > text.length) return false;
  for (let k = 0; k < word.length; k++) {
    let c = text.charCodeAt(i + k);
    if (c >= 0x41 && c <= 0x5a) c += 0x20;
    if (c !== word.charCodeAt(k)) return false;
  }
  return true;
}

/**
 * Finds phone-shaped tokens (three digits, hyphen, four digits) that are not part
 * of a longer digit run and do not touch a hyphen that itself touches a digit.
 */
export function scanPhones(text: string): PhoneScan {
  if (text.length > TEXT_SCAN_CAP) return { ok: false, reason: 'too-long' };
  const n = text.length;
  const matches: PhoneMatch[] = [];
  for (let i = 0; i + 8 <= n; i++) {
    if (!isDigitAt(text, i)) continue;
    if (isDigitAt(text, i - 1)) continue;
    if (!isDigitAt(text, i + 1) || !isDigitAt(text, i + 2)) continue;
    if (!isHyphenAt(text, i + 3)) continue;
    if (
      !isDigitAt(text, i + 4) ||
      !isDigitAt(text, i + 5) ||
      !isDigitAt(text, i + 6) ||
      !isDigitAt(text, i + 7)
    ) {
      continue;
    }
    if (isDigitAt(text, i + 8)) continue;
    if (isHyphenAt(text, i - 1) && isDigitAt(text, i - 2)) continue;
    if (isHyphenAt(text, i + 8) && isDigitAt(text, i + 9)) continue;
    const reserved =
      text.charCodeAt(i) === 0x35 &&
      text.charCodeAt(i + 1) === 0x35 &&
      text.charCodeAt(i + 2) === 0x35 &&
      text.charCodeAt(i + 4) === 0x30 &&
      text.charCodeAt(i + 5) === 0x31;
    matches.push({ index: i, text: text.slice(i, i + 8), reserved });
  }
  return { ok: true, matches };
}

/** Finds `http://`, `https://`, `www.` and e-mail shapes (`@` between two ASCII letters). */
export function scanLinks(text: string): LinkScan {
  if (text.length > TEXT_SCAN_CAP) return { ok: false, reason: 'too-long' };
  const n = text.length;
  const findings: LinkFinding[] = [];
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x40) {
      if (isLetterAt(text, i - 1) && isLetterAt(text, i + 1)) findings.push({ index: i, kind: 'email' });
    } else if (matchesWordAt(text, i, 'https://')) {
      findings.push({ index: i, kind: 'https' });
    } else if (matchesWordAt(text, i, 'http://')) {
      findings.push({ index: i, kind: 'http' });
    } else if (matchesWordAt(text, i, 'www.')) {
      findings.push({ index: i, kind: 'www' });
    }
  }
  return { ok: true, findings };
}
