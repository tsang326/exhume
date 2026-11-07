import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { numRuns } from '../../test-support/runs';
import { TEXT_CHUNK_BYTES } from './limits';
import { makeTextSink } from './textsink';

describe('makeTextSink', () => {
  it('returns an empty string when nothing was written', () => {
    const sink = makeTextSink();
    expect(sink.length).toBe(0);
    expect(sink.finish()).toBe('');
  });

  it('keeps text exact across multiple chunks', () => {
    const sink = makeTextSink();
    const n = TEXT_CHUNK_BYTES * 2 + 17;
    let expected = '';
    for (let i = 0; i < n; i++) {
      const code = 0x20 + (i % 0x5f);
      sink.push(code);
      expected += String.fromCharCode(code);
    }
    expect(sink.finish()).toBe(expected);
  });

  it('counts bytes from push and pushString', () => {
    const sink = makeTextSink();
    sink.push(0x41);
    sink.pushString('bc\n');
    expect(sink.length).toBe(4);
    expect(sink.finish()).toBe('Abc\n');
  });

  it('handles exactly one full chunk', () => {
    const sink = makeTextSink();
    sink.pushString('x'.repeat(TEXT_CHUNK_BYTES));
    expect(sink.length).toBe(TEXT_CHUNK_BYTES);
    expect(sink.finish()).toBe('x'.repeat(TEXT_CHUNK_BYTES));
  });

  it('round-trips Unicode text across chunk boundaries', () => {
    const sink = makeTextSink();
    const unit = 'a\u00e9\u2500\u{1F600}';
    const text = unit.repeat(TEXT_CHUNK_BYTES);
    sink.pushString(text);
    expect(sink.finish()).toBe(text);
  });

  it('counts 1, 2, 3 and 4 UTF-8 bytes per character', () => {
    const cases: Array<[string, number]> = [
      ['a', 1],
      ['\u00e9', 2],
      ['\u2500', 3],
      ['\u{1F600}', 4],
    ];
    for (const [s, bytes] of cases) {
      const sink = makeTextSink();
      sink.pushString(s);
      expect(sink.length).toBe(bytes);
    }
  });

  it('pushStringCapped stops short of the full string at the cap', () => {
    const sink = makeTextSink();
    const s = 'ab\u2500cd';
    const appended = sink.pushStringCapped(s, 4);
    expect(appended).toBeLessThan(s.length);
    expect(appended).toBe(2);
    expect(sink.length).toBe(2);
    expect(sink.finish()).toBe('ab');
  });

  it('pushStringCapped never splits a surrogate pair', () => {
    const sink = makeTextSink();
    const appended = sink.pushStringCapped('a\u{1F600}', 4);
    expect(appended).toBe(1);
    expect(sink.finish()).toBe('a');
  });

  it('pushStringCapped appends everything when it fits', () => {
    const sink = makeTextSink();
    const s = 'a\u00e9\u2500\u{1F600}';
    expect(sink.pushStringCapped(s, 10)).toBe(s.length);
    expect(sink.length).toBe(10);
    expect(sink.finish()).toBe(s);
  });
});

// Feature: plain-text, Property 9: Sink UTF-8 accounting and ASCII compatibility
// **Validates: Requirements 3.3**
describe('Property 9: Sink UTF-8 accounting and ASCII compatibility', () => {
  const utf8Length = (s: string): number => new TextEncoder().encode(s).length;
  const isWellFormed = (s: string): boolean =>
    new TextDecoder().decode(new TextEncoder().encode(s)) === s;
  const costOfCodePoint = (cp: number): number => (cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4);

  const scalarArb = fc.oneof(
    fc.integer({ min: 0, max: 0x7f }),
    fc.integer({ min: 0x80, max: 0x7ff }),
    fc.integer({ min: 0x800, max: 0xd7ff }),
    fc.integer({ min: 0xe000, max: 0xffff }),
    fc.integer({ min: 0x10000, max: 0x10ffff }),
  );
  const wellFormedArb = fc
    .array(scalarArb, { maxLength: 40 })
    .map((cps) => String.fromCodePoint(...cps));
  const anyUnitsArb = fc
    .array(fc.integer({ min: 0, max: 0xffff }), { maxLength: 40 })
    .map((units) => String.fromCharCode(...units));

  type Mode = 'push' | 'pushString' | 'capped';
  const stepArb = (text: fc.Arbitrary<string>) =>
    fc.record({
      mode: fc.constantFrom<Mode>('push', 'pushString', 'capped'),
      s: text,
      slack: fc.integer({ min: 0, max: 8 }),
    });

  it('finish() is the concatenation of what was appended; length covers the real UTF-8 length', () => {
    fc.assert(
      fc.property(fc.array(stepArb(anyUnitsArb), { maxLength: 8 }), (steps) => {
        const sink = makeTextSink();
        let expected = '';
        for (const { mode, s, slack } of steps) {
          if (mode === 'push') {
            for (let i = 0; i < s.length; i++) sink.push(s.charCodeAt(i));
            expected += s;
          } else if (mode === 'pushString') {
            sink.pushString(s);
            expected += s;
          } else {
            const n = sink.pushStringCapped(s, sink.length + utf8Length(s) + slack);
            expected += s.slice(0, n);
          }
        }
        return sink.finish() === expected && sink.length >= utf8Length(expected);
      }),
      { numRuns: numRuns(100) },
    );
  });

  it('length equals the real UTF-8 length when the text is well-formed', () => {
    fc.assert(
      fc.property(fc.array(stepArb(wellFormedArb), { maxLength: 8 }), (steps) => {
        const sink = makeTextSink();
        let expected = '';
        for (const { mode, s } of steps) {
          if (mode === 'push') {
            for (let i = 0; i < s.length; i++) sink.push(s.charCodeAt(i));
            expected += s;
          } else if (mode === 'pushString') {
            sink.pushString(s);
            expected += s;
          } else {
            sink.pushStringCapped(s, Number.MAX_SAFE_INTEGER);
            expected += s;
          }
        }
        return isWellFormed(expected) && sink.length === utf8Length(expected) && sink.finish() === expected;
      }),
      { numRuns: numRuns(100) },
    );
  });

  it('pushStringCapped appends a maximal prefix that never splits a surrogate pair', () => {
    fc.assert(
      fc.property(wellFormedArb, fc.integer({ min: 0, max: 200 }), (s, max) => {
        const sink = makeTextSink();
        const n = sink.pushStringCapped(s, max);
        const prefix = s.slice(0, n);
        const text = sink.finish();
        if (n < 0 || n > s.length || text !== prefix) return false;
        if (!isWellFormed(prefix)) return false;
        if (sink.length > max || sink.length !== utf8Length(prefix)) return false;
        if (n === s.length) return true;
        const next = s.codePointAt(n);
        return next !== undefined && sink.length + costOfCodePoint(next) > max;
      }),
      { numRuns: numRuns(100) },
    );
  });

  it('ASCII-only input counts one byte per unit and keeps the text exact across chunk boundaries', () => {
    const asciiArb = fc.array(fc.integer({ min: 0, max: 0x7f }), { maxLength: TEXT_CHUNK_BYTES * 2 + 64 });
    fc.assert(
      fc.property(asciiArb, fc.constantFrom<Mode>('push', 'pushString', 'capped'), (codes, mode) => {
        const sink = makeTextSink();
        const s = String.fromCharCode(...codes);
        if (mode === 'push') {
          for (const c of codes) sink.push(c);
        } else if (mode === 'pushString') {
          sink.pushString(s);
        } else if (sink.pushStringCapped(s, codes.length) !== s.length) {
          return false;
        }
        return sink.length === codes.length && sink.finish() === s;
      }),
      { numRuns: numRuns(100) },
    );
  });
});
