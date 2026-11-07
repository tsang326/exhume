import { FILE_NAME_MAX } from './limits';

export type DownloadExtension = '.md' | '.csv' | '.png' | '.bin';

function isSafeCode(c: number): boolean {
  return (
    (c >= 0x41 && c <= 0x5a) || // A-Z
    (c >= 0x61 && c <= 0x7a) || // a-z
    (c >= 0x30 && c <= 0x39) || // 0-9
    c === 0x2e || // .
    c === 0x5f || // _
    c === 0x2d // -
  );
}

/**
 * Maps any string plus one extension to a Safe_File_Name (Req 10.4 steps a to h).
 * Plain loops only; no regex runs over the input.
 */
export function sanitizeFileName(diskName: string, extension: DownloadExtension): string {
  // (a) keep only the part after the last '/' or '\'
  let start = 0;
  for (let i = 0; i < diskName.length; i++) {
    const c = diskName.charCodeAt(i);
    if (c === 0x2f || c === 0x5c) start = i + 1;
  }
  // (b) drop the last '.' and everything after it
  let end = diskName.length;
  for (let i = diskName.length - 1; i >= start; i--) {
    if (diskName.charCodeAt(i) === 0x2e) {
      end = i;
      break;
    }
  }
  // (c) replace unsafe characters (per UTF-16 code unit) with '_'
  const chars: string[] = [];
  for (let i = start; i < end; i++) {
    chars.push(isSafeCode(diskName.charCodeAt(i)) ? diskName[i]! : '_');
  }
  // (d) remove leading and trailing '.'
  let lo = 0;
  let hi = chars.length;
  while (lo < hi && chars[lo] === '.') lo++;
  while (hi > lo && chars[hi - 1] === '.') hi--;
  // (e) collapse runs of '.' to a single '.'
  const collapsed: string[] = [];
  for (let i = lo; i < hi; i++) {
    const ch = chars[i]!;
    if (ch === '.' && collapsed[collapsed.length - 1] === '.') continue;
    collapsed.push(ch);
  }
  // (f) truncate so stem + extension fits the cap
  const maxStem = FILE_NAME_MAX - extension.length;
  if (collapsed.length > maxStem) collapsed.length = maxStem;
  // (g) remove trailing '.' again
  while (collapsed.length > 0 && collapsed[collapsed.length - 1] === '.') collapsed.pop();
  // Req 10.5: empty stem falls back to 'grave'
  const stem = collapsed.length === 0 ? 'grave' : collapsed.join('');
  // (h) append the extension
  return stem + extension;
}
