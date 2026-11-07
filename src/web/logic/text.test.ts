import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { formatDate, lastSegment, segmentCount, toLabel } from './text';
import { LABEL_CAP } from './limits';
import { numRuns } from '../../test-support/runs';

describe('text examples', () => {
  it('lastSegment takes the text after the final slash', () => {
    expect(lastSegment('A/B/C.TXT')).toBe('C.TXT');
    expect(lastSegment('C.TXT')).toBe('C.TXT');
    expect(lastSegment('DIR/')).toBe('');
    expect(lastSegment('')).toBe('');
  });

  it('segmentCount counts non-empty segments', () => {
    expect(segmentCount('')).toBe(0);
    expect(segmentCount('A')).toBe(1);
    expect(segmentCount('A/B')).toBe(2);
    expect(segmentCount('/A')).toBe(1);
    expect(segmentCount('A//B/')).toBe(2);
  });

  it('toLabel does not split a surrogate pair at the cut', () => {
    const s = 'a'.repeat(LABEL_CAP - 1) + '\u{1F600}' + 'tail';
    const out = toLabel(s);
    expect(out).toBe('a'.repeat(LABEL_CAP - 1));
    const exact = 'a'.repeat(LABEL_CAP - 2) + '\u{1F600}';
    expect(toLabel(exact)).toBe(exact);
  });

  it('toLabel keeps markup characters unchanged', () => {
    expect(toLabel('<b>&"x"</b>')).toBe('<b>&"x"</b>');
  });

  it('formatDate examples', () => {
    expect(formatDate('1993-04-05T06:07:08')).toBe('1993-04-05 06:07');
    expect(formatDate(null)).toBe('no date');
    expect(formatDate('1993-13-05T06:07:08')).toBe('no date');
    expect(formatDate('1993-04-05 06:07:08')).toBe('no date');
    expect(formatDate('')).toBe('no date');
  });
});

describe('text properties', () => {
  const pad = (n: number, w: number) => n.toString().padStart(w, '0');

  // Feature: graveyard-ui, Property 1: Visible labels are bounded and unchanged
  // **Validates: Requirements 1.8**
  it('Property 1: toLabel is bounded, a prefix, and leaves markup untouched', () => {
    const unit = fc.constantFrom('<', '>', '&', '"', 'a', 'Z', ' ', '\u{1F600}', '\ud800', '\udc00', 'é');
    const strings = fc.oneof(
      fc.string({ unit, maxLength: 100_000 }),
      fc.string({ unit, minLength: 250, maxLength: 260 }),
      fc.string({ maxLength: 400 }),
    );
    fc.assert(
      fc.property(strings, (s) => {
        const out = toLabel(s);
        if (out.length > LABEL_CAP) return false;
        if (s.length <= LABEL_CAP) return out === s;
        if (!s.startsWith(out)) return false;
        // Cut is at the cap, or one earlier when a lone high surrogate would end the label.
        if (out.length < LABEL_CAP - 1) return false;
        for (const ch of ['<', '>', '&', '"']) {
          if (out.split(ch).length !== s.slice(0, out.length).split(ch).length) return false;
        }
        return true;
      }),
      { numRuns: numRuns(100) },
    );
  });

  // Feature: graveyard-ui, Property 16: Date formatting is total and time-zone free
  // **Validates: Requirements 6.7, 6.8, 6.9, 6.19**
  it('Property 16: valid dates keep their digits', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 9999 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 31 }),
        fc.integer({ min: 0, max: 23 }),
        fc.integer({ min: 0, max: 59 }),
        fc.integer({ min: 0, max: 59 }),
        (y, mo, d, h, mi, s) => {
          const date = `${pad(y, 4)}-${pad(mo, 2)}-${pad(d, 2)}T${pad(h, 2)}:${pad(mi, 2)}:${pad(s, 2)}`;
          return formatDate(date) === `${pad(y, 4)}-${pad(mo, 2)}-${pad(d, 2)} ${pad(h, 2)}:${pad(mi, 2)}`;
        },
      ),
      { numRuns: numRuns(100) },
    );
  });

  // Feature: graveyard-ui, Property 16: Date formatting is total and time-zone free
  // **Validates: Requirements 6.7, 6.8, 6.9, 6.19**
  it('Property 16: any other input gives "no date" and never throws', () => {
    const shapeOk = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/;
    const base = '1993-04-05T06:07:08';
    const mutated = fc
      .tuple(fc.integer({ min: 0, max: base.length - 1 }), fc.string({ maxLength: 2 }))
      .map(([i, r]) => base.slice(0, i) + r + base.slice(i + 1));
    const inputs = fc.oneof(
      fc.constant(null),
      fc.string({ maxLength: 40 }),
      mutated,
      fc.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/),
    );
    fc.assert(
      fc.property(inputs, (s) => {
        const out = formatDate(s);
        if (s !== null && shapeOk.test(s)) return out === `${s.slice(0, 10)} ${s.slice(11, 16)}`;
        return out === 'no date';
      }),
      { numRuns: numRuns(200) },
    );
  });
});
