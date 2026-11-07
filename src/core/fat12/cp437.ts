/** CP437 (IBM PC) decoding. Bytes 0x00..0x7F are ASCII; 0x80..0xFF come from the table below. */

/** Characters for bytes 0x80..0xFF, 16 per row. Byte 0xFF maps to U+00A0 (no-break space). */
const HIGH_HALF =
  'ÇüéâäàåçêëèïîìÄÅ' +
  'ÉæÆôöòûùÿÖÜ¢£¥₧ƒ' +
  'áíóúñÑªº¿⌐¬½¼¡«»' +
  '░▒▓│┤╡╢╖╕╣║╗╝╜╛┐' +
  '└┴┬├─┼╞╟╚╔╩╦╠═╬╧' +
  '╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀' +
  'αßΓπΣσµτΦΘΩδ∞φε∩' +
  '≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00A0';

/** Decode CP437 bytes to a string. Never throws. */
export function decodeCp437(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] as number;
    out += b < 0x80 ? String.fromCharCode(b) : (HIGH_HALF[b - 0x80] as string);
  }
  return out;
}
