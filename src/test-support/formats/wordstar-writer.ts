import { FixtureError } from './errors';

export type WsStyle = 'bold' | 'underline' | 'italic';
/** `text` is printable ASCII (0x20..0x7E). */
export interface WsSpan {
  text: string;
  styles?: WsStyle[];
}
/** `wrapAt` is the soft-wrap column: a space at or beyond it becomes a soft return. */
export interface WsParagraph {
  spans: WsSpan[];
  wrapAt?: number;
}

export const WS_MAX_PARAGRAPHS = 1000;
export const WS_MAX_WRAP_AT = 65535;

const TOGGLE: Record<WsStyle, number> = { bold: 0x02, underline: 0x13, italic: 0x19 };
const SPACE = 0x20;

function validate(paragraphs: readonly WsParagraph[]): void {
  if (!Array.isArray(paragraphs)) throw new FixtureError('paragraphs', 'expected an array');
  if (paragraphs.length > WS_MAX_PARAGRAPHS) {
    throw new FixtureError('paragraphs', `at most ${WS_MAX_PARAGRAPHS} paragraphs`);
  }
  paragraphs.forEach((p, pi) => {
    if (p === null || typeof p !== 'object' || !Array.isArray(p.spans)) {
      throw new FixtureError(`paragraphs[${pi}].spans`, 'expected an array');
    }
    if (p.wrapAt !== undefined && !(Number.isInteger(p.wrapAt) && p.wrapAt >= 1 && p.wrapAt <= WS_MAX_WRAP_AT)) {
      throw new FixtureError(`paragraphs[${pi}].wrapAt`, `integer 1..${WS_MAX_WRAP_AT}`);
    }
    p.spans.forEach((s: WsSpan, si: number) => {
      const where = `paragraphs[${pi}].spans[${si}]`;
      if (s === null || typeof s !== 'object' || typeof s.text !== 'string') {
        throw new FixtureError(`${where}.text`, 'expected a string');
      }
      for (let i = 0; i < s.text.length; i++) {
        const c = s.text.charCodeAt(i);
        if (c < 0x20 || c > 0x7e) throw new FixtureError(`${where}.text`, 'printable ASCII only');
      }
      if (s.styles !== undefined) {
        if (!Array.isArray(s.styles)) throw new FixtureError(`${where}.styles`, 'expected an array');
        const seen = new Set<string>();
        for (const st of s.styles) {
          if (!(st in TOGGLE) || seen.has(st)) {
            throw new FixtureError(`${where}.styles`, 'unknown or repeated style');
          }
          seen.add(st);
        }
      }
    });
  });
}

/**
 * Writes a WordStar document. The last character of each word has its high bit set,
 * a space at or past `wrapAt` becomes 0x8D 0x0A, each paragraph ends with 0x0D 0x0A,
 * and styled spans are bracketed by the style toggle bytes.
 */
export function writeWordStar(paragraphs: WsParagraph[]): Uint8Array {
  validate(paragraphs);
  const out: number[] = [];
  for (const p of paragraphs) {
    const text = p.spans.map((s) => s.text).join('');
    let pos = 0; // index into the paragraph text
    let col = 0; // text characters on the current output line
    for (const span of p.spans) {
      if (span.text.length === 0) continue;
      const toggles = (span.styles ?? []).map((st) => TOGGLE[st]);
      for (const t of toggles) out.push(t);
      for (let i = 0; i < span.text.length; i++, pos++) {
        const c = span.text.charCodeAt(i);
        if (c === SPACE) {
          if (p.wrapAt !== undefined && col >= p.wrapAt) {
            out.push(0x8d, 0x0a);
            col = 0;
          } else {
            out.push(SPACE);
            col++;
          }
          continue;
        }
        const next = pos + 1 < text.length ? text.charCodeAt(pos + 1) : SPACE;
        out.push(next === SPACE ? c | 0x80 : c);
        col++;
      }
      for (const t of toggles) out.push(t);
    }
    out.push(0x0d, 0x0a);
  }
  return Uint8Array.from(out);
}
