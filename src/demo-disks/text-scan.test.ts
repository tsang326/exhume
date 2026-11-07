import { describe, expect, it } from 'vitest';
import { scanLinks, scanPhones, TEXT_SCAN_CAP } from './checks/text-scan';

function phones(text: string): { text: string; reserved: boolean }[] {
  const r = scanPhones(text);
  if (!r.ok) throw new Error('unexpected too-long');
  return r.matches.map((m) => ({ text: m.text, reserved: m.reserved }));
}

function links(text: string): string[] {
  const r = scanLinks(text);
  if (!r.ok) throw new Error('unexpected too-long');
  return r.findings.map((f) => f.kind);
}

describe('scanPhones examples', () => {
  it.each(['1989-03-14', '-1250.00', 'INV-8903-12', '12-555-0123', '555-0123-45'])(
    'does not match %s',
    (text) => {
      expect(phones(text)).toEqual([]);
    },
  );

  it('accepts a reserved number', () => {
    expect(phones('call 555-0123 now')).toEqual([{ text: '555-0123', reserved: true }]);
  });

  it('flags 555-0200 as not reserved', () => {
    expect(phones('555-0200')).toEqual([{ text: '555-0200', reserved: false }]);
  });

  it('flags 123-4567 as not reserved', () => {
    expect(phones('123-4567')).toEqual([{ text: '123-4567', reserved: false }]);
  });

  it('accepts the range edges 0100 and 0199 only', () => {
    expect(phones('555-0100 555-0199 555-0099 555-0200').map((m) => m.reserved)).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });
});

describe('scan cap', () => {
  it('accepts exactly the cap and refuses one more', () => {
    const atCap = 'a'.repeat(TEXT_SCAN_CAP);
    const over = 'a'.repeat(TEXT_SCAN_CAP + 1);
    expect(scanPhones(atCap).ok).toBe(true);
    expect(scanLinks(atCap).ok).toBe(true);
    expect(scanPhones(over)).toEqual({ ok: false, reason: 'too-long' });
    expect(scanLinks(over)).toEqual({ ok: false, reason: 'too-long' });
  });
});

describe('scanLinks examples', () => {
  it('finds schemes case-insensitively', () => {
    expect(links('HTTP://x')).toEqual(['http']);
    expect(links('see https://x')).toEqual(['https']);
  });

  it('finds www.', () => {
    expect(links('www.')).toEqual(['www']);
  });

  it('finds an e-mail shape', () => {
    expect(links('a@b')).toEqual(['email']);
  });

  it('ignores a leading or trailing @', () => {
    expect(links('@b')).toEqual([]);
    expect(links('a@')).toEqual([]);
    expect(links('1@2')).toEqual([]);
  });
});
