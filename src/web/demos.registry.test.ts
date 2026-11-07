// Demo registry against the Generator's disk specs (demo-disks spec, task 11.4).
// Requirements 9.1, 9.2, 9.3, 9.4, 9.9.
import { describe, expect, it } from 'vitest';
import { DEMO_DISK_SPECS } from '../demo-disks/specs';
import { DEMO_REGISTRY } from './demos';
import { validateDemoDisk } from './logic/demo-validate';

const KEYWORDS: readonly (readonly string[])[] = [
  ['WordStar', 'two deleted'],
  ['customer table', 'logo', 'lost'],
  ['broken', 'warnings'],
];

describe('DEMO_REGISTRY', () => {
  it('has three entries in the order of DEMO_DISK_SPECS', () => {
    expect(DEMO_REGISTRY).toHaveLength(3);
    expect(DEMO_REGISTRY.map((d) => d.id)).toEqual(['writers-disk', 'office-disk', 'damaged-disk']);
    expect(DEMO_REGISTRY.map((d) => d.id)).toEqual(DEMO_DISK_SPECS.map((s) => s.id));
  });

  it('uses /disks/ plus the spec file name as the URL', () => {
    expect(DEMO_REGISTRY.map((d) => d.url)).toEqual(DEMO_DISK_SPECS.map((s) => `/disks/${s.fileName}`));
  });

  it('has a title of 1 to 80 and a one-line description of 1 to 200 characters', () => {
    for (const d of DEMO_REGISTRY) {
      expect(d.title.length).toBeGreaterThanOrEqual(1);
      expect(d.title.length).toBeLessThanOrEqual(80);
      expect(d.description.length).toBeGreaterThanOrEqual(1);
      expect(d.description.length).toBeLessThanOrEqual(200);
      expect(d.description).not.toMatch(/[\r\n]/);
    }
  });

  it('passes validateDemoDisk for every entry', () => {
    for (const d of DEMO_REGISTRY) {
      expect(validateDemoDisk(d)).toEqual({ ok: true });
    }
  });

  it('holds the keywords of Requirement 9.3 in each description', () => {
    DEMO_REGISTRY.forEach((d, i) => {
      for (const word of KEYWORDS[i] ?? []) {
        expect(d.description, `${d.id} needs "${word}"`).toContain(word);
      }
    });
  });

  it('has same-origin URLs: /disks/ prefix, no scheme, host or query string', () => {
    for (const d of DEMO_REGISTRY) {
      expect(d.url.startsWith('/disks/')).toBe(true);
      expect(d.url).not.toMatch(/^[a-zA-Z][a-zA-Z0-9+.-]*:/);
      expect(d.url.startsWith('//')).toBe(false);
      expect(d.url).not.toMatch(/[?#]/);
    }
  });
});
