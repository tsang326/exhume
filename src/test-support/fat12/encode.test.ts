import { describe, expect, it } from 'vitest';
import {
  buildLfnRecords,
  encodeDosDate,
  encodeDosTime,
  encodeShortName,
  isValidShortName,
  lfnChecksum,
  writeFatEntry,
} from './encode';

describe('fat12 test encoders', () => {
  it('packs FAT entries without disturbing neighbours', () => {
    const fat = new Uint8Array(6);
    writeFatEntry(fat, 0, 0xff0);
    writeFatEntry(fat, 1, 0xfff);
    writeFatEntry(fat, 2, 0x003);
    writeFatEntry(fat, 3, 0x456);
    expect(Array.from(fat)).toEqual([0xf0, 0xff, 0xff, 0x03, 0x60, 0x45]);
  });

  it('encodes DOS date and time words', () => {
    const d = { year: 1980, month: 1, day: 1, hour: 0, minute: 0, second: 0 };
    expect(encodeDosDate(d)).toBe(0x0021);
    expect(encodeDosTime(d)).toBe(0);
    const e = { year: 2000, month: 12, day: 31, hour: 23, minute: 59, second: 58 };
    expect(encodeDosDate(e)).toBe((20 << 9) | (12 << 5) | 31);
    expect(encodeDosTime(e)).toBe((23 << 11) | (59 << 5) | 29);
  });

  it('encodes and validates 8.3 names', () => {
    expect(new TextDecoder().decode(encodeShortName('README.TXT'))).toBe('README  TXT');
    expect(new TextDecoder().decode(encodeShortName('A'))).toBe('A          ');
    for (const bad of ['', 'readme.txt', 'TOOLONGNAME.TXT', 'A.LONG', 'A.', '.A', 'A.B.C', 'A B']) {
      expect(isValidShortName(bad)).toBe(false);
    }
    expect(() => encodeShortName('bad name')).toThrow();
  });

  it('computes the VFAT checksum and long-name records', () => {
    // Known value for "FOO     BAR"? Verify against a hand-run of the algorithm instead.
    let sum = 0;
    const name = encodeShortName('FOO.BAR');
    for (const b of name) sum = ((sum >> 1) | ((sum & 1) << 7)) + b & 0xff;
    expect(lfnChecksum(name)).toBe(sum);

    const recs = buildLfnRecords('A fairly long file name.txt', lfnChecksum(name));
    expect(recs).toHaveLength(3);
    expect(recs[0]?.[0]).toBe(0x43);
    expect(recs[1]?.[0]).toBe(2);
    expect(recs[2]?.[0]).toBe(1);
    expect(recs[0]?.[11]).toBe(0x0f);
    expect(recs[0]?.[13]).toBe(lfnChecksum(name));
    // 13-unit name fills one record exactly with no terminator
    expect(buildLfnRecords('ABCDEFGHIJKLM', 0)).toHaveLength(1);
  });
});
