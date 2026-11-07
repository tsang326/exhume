import { HEX_PREVIEW_BYTES, HEX_ROW_BYTES } from './limits';

export interface HexRow {
  /** 8 hex digits. */
  offset: string;
  /** 16 slots of two hex digits joined by single spaces, padded to 47 characters. */
  hex: string;
  /** At most 16 characters; 0x20..0x7E map to themselves, everything else to ".". */
  text: string;
}

const HEX_COLUMN_WIDTH = HEX_ROW_BYTES * 3 - 1;

export function hexRows(bytes: Uint8Array, limit: number = HEX_PREVIEW_BYTES): HexRow[] {
  const shown = Math.max(0, Math.min(bytes.length, Math.floor(limit)));
  const rows: HexRow[] = [];
  for (let start = 0; start < shown; start += HEX_ROW_BYTES) {
    const end = Math.min(start + HEX_ROW_BYTES, shown);
    let hex = '';
    let text = '';
    for (let i = start; i < end; i++) {
      const b = bytes[i] ?? 0;
      hex += (i > start ? ' ' : '') + (b < 16 ? '0' : '') + b.toString(16);
      text += b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.';
    }
    rows.push({
      offset: start.toString(16).padStart(8, '0'),
      hex: hex.padEnd(HEX_COLUMN_WIDTH, ' '),
      text,
    });
  }
  return rows;
}
