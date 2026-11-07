import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { numRuns } from '../test-support/runs';
import { FORBIDDEN_NAMES, scanForbiddenNames } from '../test-support/mcp/scan';

// Filler alphabet cannot spell any forbidden name (no 'f', no ':' and no '(').
const fillerLine = fc.stringMatching(/^[abcde 0-9;_.=]{0,30}$/);
const fillerLines = fc.array(fillerLine, { minLength: 1, maxLength: 12 });

describe('forbidden-name scan properties', () => {
  // Feature: mcp-server, Property 25: The forbidden-name scan finds every name and reports where
  // **Validates: Requirements 1.5, 1.6**
  it('reports the file, the 1-based line and the name for an inserted name', () => {
    fc.assert(
      fc.property(
        fillerLines,
        fc.constantFrom(...FORBIDDEN_NAMES),
        fc.nat(),
        fc.nat(),
        (lines, name, lineSeed, colSeed) => {
          const idx = lineSeed % lines.length;
          const target = lines[idx] ?? '';
          const col = colSeed % (target.length + 1);
          const patched = lines.slice();
          patched[idx] = `${target.slice(0, col)} ${name} ${target.slice(col)}`;
          const found = scanForbiddenNames('src/mcp/x.ts', patched.join('\n'));
          return (
            found.length === 1 &&
            found[0]?.file === 'src/mcp/x.ts' &&
            found[0]?.line === idx + 1 &&
            found[0]?.name === name
          );
        },
      ),
      { numRuns: numRuns(200) },
    );
  });

  // Feature: mcp-server, Property 25: The forbidden-name scan finds every name and reports where
  // **Validates: Requirements 1.5, 1.6**
  it('reports nothing for filler without any name', () => {
    fc.assert(
      fc.property(fillerLines, (lines) => scanForbiddenNames('src/mcp/x.ts', lines.join('\n')).length === 0),
      { numRuns: numRuns(100) },
    );
  });

  it('reports one violation per name when every name is inserted on its own line', () => {
    const text = FORBIDDEN_NAMES.map((n) => `a ${n} b`).join('\n');
    const found = scanForbiddenNames('f.ts', text);
    expect(found.map((v) => v.name)).toEqual([...FORBIDDEN_NAMES]);
    expect(found.map((v) => v.line)).toEqual(FORBIDDEN_NAMES.map((_, i) => i + 1));
  });
});
