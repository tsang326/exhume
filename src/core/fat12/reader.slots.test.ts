import fc from 'fast-check';
import { describe, it } from 'vitest';
import { openDisk } from './index';
import { fittedTreeArb } from '../../test-support/fat12/arbitraries';
import { FitError, writeFat12Image } from '../../test-support/fat12/index';
import type { DirNode, FileTree, StandardGeometryName } from '../../test-support/fat12/index';
import { numRuns } from '../../test-support/runs';

interface SlotPick {
  dir: number;
  before: number;
  fill: 'f6' | 'zero';
}

const slotPickArb: fc.Arbitrary<SlotPick> = fc.record({
  dir: fc.nat(1000),
  before: fc.nat(1000),
  fill: fc.constantFrom<'f6' | 'zero'>('f6', 'zero'),
});

/** Every directory container of the tree (root first), found with an explicit work list. */
function containers(tree: FileTree): Array<FileTree | DirNode> {
  const out: Array<FileTree | DirNode> = [];
  const work: Array<FileTree | DirNode> = [tree];
  for (let i = 0; i < work.length && i < 1000; i++) {
    const c = work[i] as FileTree | DirNode;
    out.push(c);
    for (const child of c.children) if (child.kind === 'directory') work.push(child);
  }
  return out;
}

/** Copy of the tree with the picked slots added (picks reference containers by index modulo). */
function withSlots(tree: FileTree, picks: SlotPick[]): FileTree {
  const copy = structuredClone(tree);
  const list = containers(copy);
  for (const p of picks) {
    const target = list[p.dir % list.length] as FileTree | DirNode;
    const slots = target.slots ?? [];
    slots.push({ beforeChild: p.before % (target.children.length + 1), fill: p.fill });
    target.slots = slots;
  }
  return copy;
}

function projection(image: Uint8Array): { files: string[]; warnings: string[] } {
  const { report } = openDisk(image);
  return {
    files: report.files.map((g) => `${g.path}|${g.size}|${g.date}|${g.state}|${g.kind}`),
    warnings: report.warnings.map((w) => `${w.code}|${w.path ?? ''}`),
  };
}

function sameList(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

const BIGGEST: StandardGeometryName = '2880K';

describe('reader: never-used slots', () => {
  it('Property 6: never-used slots are invisible', () => {
    // Feature: real-disk-hardening, Property 6: Never-used slots are invisible
    // **Validates: Requirements 3.1, 3.2, 3.5, 3.7**
    fc.assert(
      fc.property(
        fittedTreeArb,
        fc.array(slotPickArb, { minLength: 1, maxLength: 12 }),
        ({ tree, geometryName }, picks) => {
          const slotted = withSlots(tree, picks);
          let geometry = geometryName;
          let slottedImage: Uint8Array;
          try {
            slottedImage = writeFat12Image(slotted, geometry);
          } catch (e) {
            if (!(e instanceof FitError)) throw e;
            geometry = BIGGEST;
            try {
              slottedImage = writeFat12Image(slotted, geometry);
            } catch (e2) {
              if (e2 instanceof FitError) return true; // slots do not fit anywhere: nothing to compare
              throw e2;
            }
          }
          const plain = projection(writeFat12Image(tree, geometry));
          const withS = projection(slottedImage);
          return sameList(plain.files, withS.files) && sameList(plain.warnings, withS.warnings);
        },
      ),
      { numRuns: numRuns(100) },
    );
  });
});
