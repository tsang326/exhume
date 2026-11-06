import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { numRuns } from '../../test-support/runs';
import { decodeCp437 } from './cp437';
import {
  decodeShortName,
  lfnChecksum,
  lfnFeed,
  lfnReset,
  lfnTake,
  makeLfnState,
  sanitizeComponent,
  type LfnState,
} from './names';
import {
  buildLfnRecords,
  encodeShortName,
  lfnChecksum as refChecksum,
} from '../../test-support/fat12/encode';

/** Independent rotate-right-and-add checksum written for this test. */
function testChecksum(name11: Uint8Array): number {
  let sum = 0;
  for (const b of name11) {
    const rotated = ((sum >> 1) | ((sum & 1) << 7)) & 0xff;
    sum = (rotated + b) & 0xff;
  }
  return sum;
}

function feedAll(s: LfnState, records: Uint8Array[]): void {
  for (const r of records) lfnFeed(s, r);
}

/** Hand-built long-name record with explicit units (no length limit applied). */
function rawRecord(seqByte: number, checksum: number, units: number[]): Uint8Array {
  const offsets = [1, 3, 5, 7, 9, 14, 16, 18, 20, 22, 24, 28, 30];
  const rec = new Uint8Array(32);
  rec[0] = seqByte;
  rec[11] = 0x0f;
  rec[13] = checksum;
  offsets.forEach((o, k) => {
    const u = units[k] ?? 0xffff;
    rec[o] = u & 0xff;
    rec[o + 1] = u >> 8;
  });
  return rec;
}

const SHORT = encodeShortName('LONGFI~1.TXT');
const SUM = testChecksum(SHORT);

describe('decodeCp437', () => {
  it('maps ASCII straight through', () => {
    expect(decodeCp437(new Uint8Array([0x48, 0x69, 0x21]))).toBe('Hi!');
  });

  it('spot checks high half', () => {
    expect(decodeCp437(new Uint8Array([0x80]))).toBe('Ç');
    expect(decodeCp437(new Uint8Array([0xe1]))).toBe('ß');
    expect(decodeCp437(new Uint8Array([0xe5]))).toBe('σ');
  });

  it('all 128 high entries are single, non-control characters', () => {
    for (let b = 0x80; b <= 0xff; b++) {
      const s = decodeCp437(new Uint8Array([b]));
      expect(s.length).toBe(1);
      const c = s.charCodeAt(0);
      expect(c >= 0x20 && c !== 0x7f && !(c >= 0x80 && c <= 0x9f)).toBe(true);
    }
  });
});

describe('lfnChecksum', () => {
  it('matches the independent implementations', () => {
    expect(lfnChecksum(SHORT)).toBe(SUM);
    expect(refChecksum(SHORT)).toBe(SUM);
  });
});

describe('decodeShortName', () => {
  const entry = (s: string): Uint8Array => {
    const e = new Uint8Array(32).fill(0x20);
    for (let i = 0; i < s.length; i++) e[i] = s.charCodeAt(i);
    return e;
  };

  it('trims padding and joins extension with a dot', () => {
    expect(decodeShortName(entry('README  TXT'))).toEqual({ name: 'README.TXT', isDotEntry: false });
  });

  it('omits the dot when the extension is blank', () => {
    expect(decodeShortName(entry('KERNEL     ')).name).toBe('KERNEL');
  });

  it('decodes a leading 0x05 as 0xE5 (σ in CP437)', () => {
    const e = entry('XABC    TXT');
    e[0] = 0x05;
    expect(decodeShortName(e).name).toBe('σABC.TXT');
  });

  it('flags dot entries', () => {
    expect(decodeShortName(entry('.          '))).toEqual({ name: '.', isDotEntry: true });
    expect(decodeShortName(entry('..         '))).toEqual({ name: '..', isDotEntry: true });
  });

  it('does not flag dot-like names with an extension', () => {
    expect(decodeShortName(entry('.       TXT')).isDotEntry).toBe(false);
  });
});

describe('sanitizeComponent', () => {
  it('replaces separators, control chars and 0x7F', () => {
    expect(sanitizeComponent('a/b')).toBe('a_b');
    expect(sanitizeComponent('a\\b')).toBe('a_b');
    expect(sanitizeComponent('a\u0000b\u001fc')).toBe('a_b_c');
    expect(sanitizeComponent('a\u007fb')).toBe('a_b');
  });

  it('maps empty and dots-only components to "_"', () => {
    expect(sanitizeComponent('')).toBe('_');
    expect(sanitizeComponent('.')).toBe('_');
    expect(sanitizeComponent('...')).toBe('_');
  });

  it('keeps ordinary names unchanged', () => {
    expect(sanitizeComponent('.hidden')).toBe('.hidden');
    expect(sanitizeComponent('Ünï.txt')).toBe('Ünï.txt');
  });
});

describe('VFAT long-name state machine', () => {
  it('reports none when nothing was fed', () => {
    expect(lfnTake(makeLfnState(), SHORT)).toEqual({ kind: 'none' });
  });

  it('decodes "Long File Name.txt"', () => {
    const s = makeLfnState();
    feedAll(s, buildLfnRecords('Long File Name.txt', SUM));
    expect(lfnTake(s, SHORT)).toEqual({ kind: 'name', name: 'Long File Name.txt' });
  });

  it('decodes a name that exactly fills its records (no terminator)', () => {
    const s = makeLfnState();
    const name = 'abcdefghijklm'; // 13 units
    feedAll(s, buildLfnRecords(name, SUM));
    expect(lfnTake(s, SHORT)).toEqual({ kind: 'name', name });
  });

  it('decodes surrogate pairs and sanitises the result', () => {
    const s = makeLfnState();
    feedAll(s, buildLfnRecords('a\u{1F47B}/b', SUM));
    expect(lfnTake(s, SHORT)).toEqual({ kind: 'name', name: 'a\u{1F47B}_b' });
  });

  it('resets after take so the next take is none', () => {
    const s = makeLfnState();
    feedAll(s, buildLfnRecords('x.txt', SUM));
    lfnTake(s, SHORT);
    expect(lfnTake(s, SHORT)).toEqual({ kind: 'none' });
  });

  it('lfnReset discards pending records', () => {
    const s = makeLfnState();
    feedAll(s, buildLfnRecords('x.txt', SUM));
    lfnReset(s);
    expect(lfnTake(s, SHORT)).toEqual({ kind: 'none' });
  });

  it('is invalid on a wrong checksum', () => {
    const s = makeLfnState();
    feedAll(s, buildLfnRecords('Long File Name.txt', (SUM + 1) & 0xff));
    expect(lfnTake(s, SHORT)).toEqual({ kind: 'invalid' });
  });

  it('is invalid when records disagree on checksum', () => {
    const s = makeLfnState();
    const recs = buildLfnRecords('Long File Name.txt', SUM);
    (recs[1] as Uint8Array)[13] = (SUM + 1) & 0xff;
    feedAll(s, recs);
    expect(lfnTake(s, SHORT)).toEqual({ kind: 'invalid' });
  });

  it('is invalid when records are out of order', () => {
    const s = makeLfnState();
    const recs = buildLfnRecords('Long File Name.txt', SUM); // 2 records
    feedAll(s, [recs[1] as Uint8Array, recs[0] as Uint8Array]);
    expect(lfnTake(s, SHORT)).toEqual({ kind: 'invalid' });
  });

  it('is invalid when the last-flagged record is missing', () => {
    const s = makeLfnState();
    const recs = buildLfnRecords('Long File Name.txt', SUM);
    feedAll(s, [recs[1] as Uint8Array]); // sequence 1 without the 0x40 flag
    expect(lfnTake(s, SHORT)).toEqual({ kind: 'invalid' });
  });

  it('is invalid when the sequence stops before record 1', () => {
    const s = makeLfnState();
    const recs = buildLfnRecords('Long File Name.txt', SUM);
    feedAll(s, [recs[0] as Uint8Array]);
    expect(lfnTake(s, SHORT)).toEqual({ kind: 'invalid' });
  });

  it('is invalid for a 256-unit name', () => {
    const s = makeLfnState();
    const units = new Array<number>(256).fill(0x61);
    const recs: Uint8Array[] = [];
    for (let seq = 20; seq >= 1; seq--) {
      const chunk = units.slice((seq - 1) * 13, seq * 13);
      if (chunk.length < 13) chunk.push(0x0000);
      recs.push(rawRecord(seq === 20 ? seq | 0x40 : seq, SUM, chunk));
    }
    feedAll(s, recs);
    expect(lfnTake(s, SHORT)).toEqual({ kind: 'invalid' });
  });

  it('is invalid for an empty name', () => {
    const s = makeLfnState();
    lfnFeed(s, rawRecord(0x41, SUM, [0x0000]));
    expect(lfnTake(s, SHORT)).toEqual({ kind: 'invalid' });
  });

  it('recovers after an invalid sequence', () => {
    const s = makeLfnState();
    feedAll(s, buildLfnRecords('bad.txt', (SUM + 1) & 0xff));
    expect(lfnTake(s, SHORT)).toEqual({ kind: 'invalid' });
    feedAll(s, buildLfnRecords('good.txt', SUM));
    expect(lfnTake(s, SHORT)).toEqual({ kind: 'name', name: 'good.txt' });
  });
});

describe('short-name decoding properties', () => {
  /** Independent oracle for the 8.3 rules, written from the spec rather than from names.ts. */
  function oracleSanitize(s: string): string {
    const chars = Array.from(s, (ch) => {
      const c = ch.codePointAt(0) as number;
      return c < 0x20 || c === 0x2f || c === 0x5c || c === 0x7f ? '_' : ch;
    });
    const out = chars.join('');
    return out === '' || /^\.+$/.test(out) ? '_' : out;
  }

  function oracleDecode(rec: Uint8Array): string {
    const field = (from: number, len: number): number[] => {
      const bytes = Array.from(rec.subarray(from, from + len));
      while (bytes.length > 0 && bytes[bytes.length - 1] === 0x20) bytes.pop();
      return bytes;
    };
    const base = field(0, 8);
    const ext = field(8, 3);
    if (base[0] === 0x05) base[0] = 0xe5;
    const ch = (b: number): string => (b < 0x80 ? String.fromCharCode(b) : decodeCp437(new Uint8Array([b])));
    const text = base.map(ch).join('') + (ext.length > 0 ? '.' + ext.map(ch).join('') : '');
    return oracleSanitize(text);
  }

  const forbidden = (s: string): boolean => {
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      if (c < 0x20 || c === 0x2f || c === 0x5c || c === 0x7f) return true;
    }
    return false;
  };

  // Feature: fat12-core, Property 11: Short-name decoding is safe
  // **Validates: Requirements 7.1, 7.2, 7.3, 7.4**
  it('decodeShortName is safe and matches the 8.3 oracle for arbitrary records', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 32, maxLength: 32 }), (rec) => {
        const r = decodeShortName(rec);
        if (r.isDotEntry) return r.name === '.' || r.name === '..';
        return (
          r.name.length >= 1 &&
          r.name.length <= 12 &&
          !forbidden(r.name) &&
          !/^\.+$/.test(r.name) &&
          r.name === oracleDecode(rec)
        );
      }),
      { numRuns: numRuns(100) },
    );
  });

  // Feature: fat12-core, Property 11: Short-name decoding is safe
  // **Validates: Requirements 7.1, 7.2, 7.3, 7.4**
  it('a leading 0x05 decodes the same as a leading 0xE5', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 32, maxLength: 32 }), (rec) => {
        const a = new Uint8Array(rec);
        const b = new Uint8Array(rec);
        a[0] = 0x05;
        b[0] = 0xe5;
        return decodeShortName(a).name === decodeShortName(b).name;
      }),
      { numRuns: numRuns(100) },
    );
  });

  // Feature: fat12-core, Property 11: Short-name decoding is safe
  // **Validates: Requirements 7.1, 7.2, 7.3, 7.4**
  it('sanitizeComponent is idempotent and yields only safe, non-empty, non-dots-only output', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (s) => {
        const once = sanitizeComponent(s);
        return (
          sanitizeComponent(once) === once &&
          once.length >= 1 &&
          !forbidden(once) &&
          !/^\.+$/.test(once) &&
          once === oracleSanitize(s)
        );
      }),
      { numRuns: numRuns(100) },
    );
  });
});
