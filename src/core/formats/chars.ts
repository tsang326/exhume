// ASCII helpers on numeric code points. No locale, no regular expressions.

const UPPER_A = 0x41;
const UPPER_Z = 0x5a;
const LOWER_A = 0x61;
const LOWER_Z = 0x7a;
const ZERO = 0x30;
const NINE = 0x39;
const CASE_BIT = 0x20;

export function isAsciiLetter(c: number): boolean {
  return (c >= UPPER_A && c <= UPPER_Z) || (c >= LOWER_A && c <= LOWER_Z);
}

/** Upper-case an ASCII letter; every other code point is returned unchanged. */
export function asciiUpper(c: number): number {
  return c >= LOWER_A && c <= LOWER_Z ? c - CASE_BIT : c;
}

export function isDigit(c: number): boolean {
  return c >= ZERO && c <= NINE;
}
