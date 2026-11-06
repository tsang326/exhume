import * as fc from 'fast-check';
import { describe, it } from 'vitest';

import { fittedTreeArb } from './arbitraries';
import { writeFat12Image } from './index';
import type { TreeNode } from './index';
import { isValidShortName } from './encode';
import { numRuns } from '../runs';

function dirsOk(nodes: TreeNode[], depth: number): boolean {
  const seen = new Set<string>();
  for (const n of nodes) {
    const key = n.name.toUpperCase();
    if (!isValidShortName(n.name) || seen.has(key)) return false;
    seen.add(key);
    if (n.kind === 'directory' && (depth >= 4 || !dirsOk(n.children, depth + 1))) return false;
  }
  return true;
}

describe('fat12 arbitraries', () => {
  it('every fitted tree builds with the writer', () => {
    fc.assert(
      fc.property(fittedTreeArb, ({ tree, geometryName }) => {
        writeFat12Image(tree, geometryName);
        return true;
      }),
      { numRuns: numRuns(100) },
    );
  });

  it('names are unique and valid in each directory, nesting at most 4', () => {
    fc.assert(
      fc.property(fittedTreeArb, ({ tree }) => dirsOk(tree.children, 0)),
      { numRuns: numRuns(100) },
    );
  });
});
