import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FORBIDDEN_NAMES, scanGeneratorSource } from './demo-source-scan';
import type { Violation } from './demo-source-scan';
import { numRuns } from './runs';

const FILLER_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ';
const filler = fc.string({ unit: fc.constantFrom(...FILLER_CHARS.split('')), maxLength: 20 });
const forbiddenName = fc.constantFrom(...FORBIDDEN_NAMES);

interface PlannedLine {
  before: string;
  names: string[];
  after: string;
}

const plannedLine = fc.record({
  before: filler,
  names: fc.array(forbiddenName, { maxLength: 4 }),
  after: filler,
});

describe('scanGeneratorSource properties', () => {
  // Feature: demo-disks, Property 5: Source scan reports exactly the inserted names
  // **Validates: Requirements 1.6, 1.7**
  it('reports exactly the inserted names on the right lines', () => {
    fc.assert(
      fc.property(fc.array(plannedLine, { maxLength: 12 }), (planned: PlannedLine[]) => {
        const text = planned
          .map((p) => (p.names.length === 0 ? p.before + p.after : `${p.before} ${p.names.join(' ')} ${p.after}`))
          .join('\n');
        const expected: Violation[] = [];
        planned.forEach((p, i) => {
          for (const name of p.names) expected.push({ file: 'gen.ts', line: i + 1, name });
        });
        const actual = scanGeneratorSource('gen.ts', text);
        return JSON.stringify(actual) === JSON.stringify(expected);
      }),
      { numRuns: numRuns(100) },
    );
  });
});

describe('scanGeneratorSource', () => {
  it('lists the 14 forbidden names of Requirement 1.6', () => {
    expect(FORBIDDEN_NAMES).toHaveLength(14);
  });

  it('reports one violation per name, with file, line and name', () => {
    const text = FORBIDDEN_NAMES.map((name) => `x ${name} y`).join('\n');
    const violations = scanGeneratorSource('gen.ts', text);
    expect(violations).toHaveLength(14);
    violations.forEach((v, i) => {
      expect(v).toEqual({ file: 'gen.ts', line: i + 1, name: FORBIDDEN_NAMES[i] });
    });
  });

  it('reports zero violations for a clean fixture', () => {
    const text = 'const a = 1;\nexport function build(): number {\n  return a;\n}\n';
    expect(scanGeneratorSource('clean.ts', text)).toEqual([]);
  });

  it('reports node:https once, and not node:http', () => {
    const violations = scanGeneratorSource('a.ts', "import 'node:https';");
    expect(violations).toEqual([{ file: 'a.ts', line: 1, name: 'node:https' }]);
  });

  it('reports node:http alone as node:http', () => {
    const violations = scanGeneratorSource('a.ts', "import 'node:http';");
    expect(violations).toEqual([{ file: 'a.ts', line: 1, name: 'node:http' }]);
  });

  it('reports two names on the same line in order', () => {
    const violations = scanGeneratorSource('a.ts', 'Math.random() + Date.now()');
    expect(violations.map((v) => v.name)).toEqual(['Math.random', 'Date.now']);
    expect(violations.every((v) => v.line === 1)).toBe(true);
  });
});
