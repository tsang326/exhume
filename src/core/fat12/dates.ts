/** DOS date and time word decoding. Pure arithmetic: no Date object, no time zone. */

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

function isWord(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xffff;
}

/** True only for the pair of two zero words (DOS 1.x files without a date). */
export function isZeroDosDateTime(dateWord: number, timeWord: number): boolean {
  return dateWord === 0 && timeWord === 0;
}

/**
 * Decode a DOS date word and time word to `YYYY-MM-DDTHH:MM:SS`, or null when any
 * field is out of range. Never throws; non-integer or non-16-bit inputs give null.
 */
export function decodeDosDateTime(dateWord: number, timeWord: number): string | null {
  if (typeof dateWord !== 'number' || typeof timeWord !== 'number') return null;
  if (!isWord(dateWord) || !isWord(timeWord)) return null;

  const year = 1980 + (dateWord >> 9);
  const month = (dateWord >> 5) & 15;
  const day = dateWord & 31;
  const hour = timeWord >> 11;
  const minute = (timeWord >> 5) & 63;
  const doubleSecond = timeWord & 31;

  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonth(year, month)) return null;
  if (hour > 23 || minute > 59 || doubleSecond > 29) return null;

  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}T${pad(hour, 2)}:${pad(minute, 2)}:${pad(doubleSecond * 2, 2)}`;
}
