import { LABEL_CAP } from './limits';

/** Cuts to a prefix of at most `cap` code units; never leaves a lone high surrogate at the end. */
export function toLabel(s: string, cap: number = LABEL_CAP): string {
  if (s.length <= cap) return s;
  let end = cap;
  if (end > 0) {
    const last = s.charCodeAt(end - 1);
    if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  }
  return s.slice(0, end);
}

/** Text after the final "/" (the whole string when there is none). */
export function lastSegment(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Number of non-empty "/"-separated segments. */
export function segmentCount(path: string): number {
  let count = 0;
  let inSegment = false;
  for (let i = 0; i < path.length; i++) {
    if (path.charCodeAt(i) === 0x2f) {
      inSegment = false;
    } else if (!inSegment) {
      inSegment = true;
      count++;
    }
  }
  return count;
}

function digits(s: string, from: number, to: number): number {
  let v = 0;
  for (let i = from; i < to; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x30 || c > 0x39) return -1;
    v = v * 10 + (c - 0x30);
  }
  return v;
}

/** 'YYYY-MM-DDTHH:MM:SS' -> 'YYYY-MM-DD HH:MM'; anything else -> 'no date'. No Date, no time zone. */
export function formatDate(date: string | null): string {
  const none = 'no date';
  if (typeof date !== 'string' || date.length !== 19) return none;
  if (date[4] !== '-' || date[7] !== '-' || date[10] !== 'T' || date[13] !== ':' || date[16] !== ':') {
    return none;
  }
  const year = digits(date, 0, 4);
  const month = digits(date, 5, 7);
  const day = digits(date, 8, 10);
  const hour = digits(date, 11, 13);
  const minute = digits(date, 14, 16);
  const second = digits(date, 17, 19);
  if (year < 0 || month < 1 || month > 12 || day < 1 || day > 31) return none;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59 || second < 0 || second > 59) return none;
  return `${date.slice(0, 10)} ${date.slice(11, 16)}`;
}
