// A small authored table of the CP437 letters the demo tables may use above
// 0x7F. Plain ASCII (0x20 to 0x7E) is always allowed and is not listed here.

export const CP437_LETTERS: ReadonlyMap<string, number> = new Map<string, number>([
  ['\u00fc', 0x81], // u with diaeresis
  ['\u00e9', 0x82], // e with acute
  ['\u00e2', 0x83], // a with circumflex
  ['\u00e4', 0x84], // a with diaeresis
  ['\u00e0', 0x85], // a with grave
  ['\u00e7', 0x87], // c with cedilla
  ['\u00ea', 0x88], // e with circumflex
  ['\u00e8', 0x8a], // e with grave
  ['\u00c4', 0x8e], // A with diaeresis
  ['\u00c9', 0x90], // E with acute
  ['\u00f6', 0x94], // o with diaeresis
  ['\u00d6', 0x99], // O with diaeresis
  ['\u00dc', 0x9a], // U with diaeresis
  ['\u00e1', 0xa0], // a with acute
  ['\u00ed', 0xa1], // i with acute
  ['\u00f3', 0xa2], // o with acute
  ['\u00fa', 0xa3], // u with acute
  ['\u00f1', 0xa4], // n with tilde
  ['\u00d1', 0xa5], // N with tilde
]);

/** Byte for one character: ASCII printable or a listed letter; undefined otherwise. */
export function cp437ByteOf(ch: string): number | undefined {
  if (ch.length === 1) {
    const c = ch.charCodeAt(0);
    if (c >= 0x20 && c <= 0x7e) return c;
  }
  return CP437_LETTERS.get(ch);
}
