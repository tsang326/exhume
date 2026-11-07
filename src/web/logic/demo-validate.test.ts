import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { validateDemoDisk, selectValidDemos, type DemoEntryShape } from './demo-validate';
import { numRuns } from '../../test-support/runs';

const goodEntry: DemoEntryShape = {
  id: 'a',
  title: 'Title',
  description: 'One line.',
  url: '/disks/a.img',
};

const word = fc.stringMatching(/^[a-z][a-z0-9_-]{0,11}$/);
const validUrl = fc
  .array(word, { minLength: 1, maxLength: 3 })
  .map((parts) => '/disks/' + parts.join('/') + '.img');
const lineFree = (min: number, max: number) =>
  fc.string({ minLength: min, maxLength: max }).filter((s) => !s.includes('\n') && !s.includes('\r'));
const validEntry = fc.record({
  id: fc.string({ minLength: 1, maxLength: 64 }),
  title: fc.string({ minLength: 1, maxLength: 80 }),
  description: lineFree(1, 200),
  url: validUrl,
});

const hazards: ReadonlyArray<(url: string) => string> = [
  (u) => '/' + u,
  (u) => 'https:' + u,
  (u) => 'disks:' + u.slice(1),
  (u) => u + '\\x',
  (u) => u + '/../x',
  () => '/disks/../x.img',
  (u) => u + '%2e',
  (u) => u + '%2E',
  (u) => u + '%2f',
  (u) => u + '%2F',
  () => '/disks/',
  () => '/disks',
  () => '',
];

describe('validateDemoDisk examples', () => {
  it('accepts a good entry', () => {
    expect(validateDemoDisk(goodEntry)).toEqual({ ok: true });
  });

  it('names the failed field', () => {
    const r = validateDemoDisk({ ...goodEntry, url: '//evil.example/x' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe('url');
    const d = validateDemoDisk({ ...goodEntry, description: 'a\nb' });
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.field).toBe('description');
  });

  it('does not throw on non-objects or throwing getters', () => {
    for (const v of [null, undefined, 1, 'x', [], {}]) expect(validateDemoDisk(v).ok).toBe(false);
    const trap = {
      get id(): string {
        throw new Error('boom');
      },
    };
    expect(validateDemoDisk(trap).ok).toBe(false);
  });
});

describe('demo validation properties', () => {
  // Feature: graveyard-ui, Property 30: Demo entries are validated and de-duplicated
  it('Property 30: validity matches the limits and URL hazards are rejected', () => {
    fc.assert(
      fc.property(
        fc.record({
          id: fc.string({ maxLength: 70 }),
          title: fc.string({ maxLength: 90 }),
          description: fc.string({ maxLength: 210 }),
          url: validUrl,
        }),
        (e) => {
          const expected =
            e.id.length >= 1 &&
            e.id.length <= 64 &&
            e.title.length >= 1 &&
            e.title.length <= 80 &&
            e.description.length >= 1 &&
            e.description.length <= 200 &&
            !e.description.includes('\n') &&
            !e.description.includes('\r');
          return validateDemoDisk(e).ok === expected;
        },
      ),
      { numRuns: numRuns(200) },
    );

    fc.assert(
      fc.property(validEntry, fc.nat({ max: hazards.length - 1 }), (e, h) => {
        const r = validateDemoDisk(e);
        if (!r.ok) return false;
        const m = validateDemoDisk({ ...e, url: hazards[h](e.url) });
        return !m.ok && m.field === 'url';
      }),
      { numRuns: numRuns(200) },
    );

    fc.assert(
      fc.property(fc.anything(), (v) => {
        const r = validateDemoDisk(v);
        return r.ok === true || typeof r.field === 'string';
      }),
      { numRuns: numRuns(200) },
    );

    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            id: fc.constantFrom('a', 'b', 'c', 'd', ''),
            title: fc.constantFrom('t', ''),
            description: fc.constantFrom('d', 'x\ny'),
            url: fc.constantFrom('/disks/a.img', '/disks/b.img', '//x', '/disks/../c', 'http:/disks/z'),
          }),
          { maxLength: 12 },
        ),
        (entries) => {
          const out = selectValidDemos(entries);
          const seen = new Set<string>();
          const expected: typeof entries = [];
          for (const e of entries) {
            if (!validateDemoDisk(e).ok || seen.has(e.id)) continue;
            seen.add(e.id);
            expected.push(e);
          }
          if (out.length !== expected.length) return false;
          for (let i = 0; i < out.length; i++) if (out[i] !== expected[i]) return false;
          const dropped = entries.filter((e) => !out.includes(e));
          return dropped.every((e) => !out.some((o) => o === e));
        },
      ),
      { numRuns: numRuns(200) },
    );
  });
});
