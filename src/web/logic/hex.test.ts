import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { numRuns } from '../../test-support/runs';
import { hexRows } from './hex';

describe('hexRows', () => {
  it('returns no rows for an empty array', () => {
    expect(hexRows(new Uint8Array(0))).toEqual([]);
  });

  it('formats a short row', () => {
    const rows = hexRows(Uint8Array.of(0x41, 0x00, 0x7f));
    expect(rows).toEqual([{ offset: '00000000', hex: '41 00 7f'.padEnd(47, ' '), text: 'A..' }]);
  });

  // Feature: graveyard-ui, Property 26: The hex view has the stated shape
  // **Validates: Requirements 9.12, 9.19**
  it('Property 26: has the stated shape', () => {
    const bytesArb = fc.oneof(
      fc.uint8Array({ maxLength: 300 }),
      fc.uint8Array({ minLength: 4090, maxLength: 4200 }),
    );
    fc.assert(
      fc.property(bytesArb, (bytes) => {
        const shown = Math.min(bytes.length, 4096);
        const rows = hexRows(bytes);
        if (rows.length !== Math.ceil(shown / 16)) return false;
        const decoded: number[] = [];
        for (let r = 0; r < rows.length; r++) {
          const row = rows[r]!;
          if (!/^[0-9a-f]{8}$/.test(row.offset)) return false;
          if (parseInt(row.offset, 16) !== 16 * r) return false;
          if (row.hex.length !== 47) return false;
          if (row.text.length > 16) return false;
          const slots = row.hex.trimEnd().split(' ');
          if (slots.length !== row.text.length) return false;
          for (let i = 0; i < slots.length; i++) {
            const b = parseInt(slots[i]!, 16);
            decoded.push(b);
            const expected = b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.';
            if (row.text[i] !== expected) return false;
          }
        }
        if (decoded.length !== shown) return false;
        return decoded.every((b, i) => b === bytes[i]);
      }),
      { numRuns: numRuns(100) },
    );
  });
});
