// Shared_Checks over Fresh_Images, plus mutation tests that prove the checks bite.
// Example-based: no property callbacks here. Everything is in memory.

import { describe, expect, it } from 'vitest';
import { writeFat12ImageWithLayout } from '../test-support/fat12/index';
import type { LayoutResult } from '../test-support/fat12/index';
import { buildDemoDisk, planOf } from './build';
import { runSharedChecks } from './checks/index';
import type { CheckFailure } from './checks/index';
import { MARKER_GENERATED } from './content/readme';
import { specOf } from './specs';
import type { DemoDiskId } from './specs';

const IDS: readonly DemoDiskId[] = ['writers-disk', 'office-disk', 'damaged-disk'];

/** Same build as buildDemoDisk, but keeps the layout so mutations can find offsets. */
function layoutOf(id: DemoDiskId): LayoutResult {
  const spec = specOf(id);
  const plan = planOf(id);
  return writeFat12ImageWithLayout(plan.tree, spec.geometry, { serial: spec.serial, damage: plan.damage });
}

function setFatEntry(layout: LayoutResult, cluster: number, value: number): void {
  const { fatStart, fatBytes, fatCount } = layout.offsets;
  const image = layout.image;
  for (let copy = 0; copy < fatCount; copy++) {
    const at = fatStart + copy * fatBytes + Math.floor((cluster * 3) / 2);
    if (cluster % 2 === 0) {
      image[at] = value & 0xff;
      image[at + 1] = ((image[at + 1] as number) & 0xf0) | ((value >> 8) & 0x0f);
    } else {
      image[at] = ((image[at] as number) & 0x0f) | ((value & 0x0f) << 4);
      image[at + 1] = (value >> 4) & 0xff;
    }
  }
}

function indexOfBytes(haystack: Uint8Array, needle: string): number {
  const codes = Array.from(needle, (c) => c.charCodeAt(0));
  for (let i = 0; i + codes.length <= haystack.length; i++) {
    let hit = true;
    for (let j = 0; j < codes.length; j++) {
      if (haystack[i + j] !== codes[j]) {
        hit = false;
        break;
      }
    }
    if (hit) return i;
  }
  return -1;
}

function groupsOf(failures: CheckFailure[]): string[] {
  return Array.from(new Set(failures.map((f) => f.check)));
}

function node(layout: LayoutResult, path: string): NonNullable<ReturnType<LayoutResult['nodes']['get']>> {
  const found = layout.nodes.get(path);
  if (found === undefined) throw new Error(`no layout node ${path}`);
  return found;
}

describe('runSharedChecks on fresh images', () => {
  for (const id of IDS) {
    it(`passes for ${id}`, () => {
      expect(runSharedChecks(id, buildDemoDisk(id).image)).toEqual([]);
    });
  }

  it('the untouched layout image equals the built image', () => {
    for (const id of IDS) {
      expect(layoutOf(id).image).toEqual(buildDemoDisk(id).image);
    }
  });
});

describe('runSharedChecks mutations', () => {
  it('(a) freeing the first FAT entry of CHAPTER3.WS is reported by graves', () => {
    const layout = layoutOf('writers-disk');
    setFatEntry(layout, node(layout, '/CHAPTER3.WS').startCluster, 0);
    const failures = runSharedChecks('writers-disk', layout.image);
    expect(failures.length).toBeGreaterThan(0);
    expect(groupsOf(failures)).toContain('graves');
  });

  it('(b) swapping the label bytes is reported by shape', () => {
    const layout = layoutOf('writers-disk');
    const at = layout.labelEntryOffset;
    expect(at).toBeDefined();
    const image = layout.image;
    const start = at as number;
    const label = Array.from(image.subarray(start, start + 11)).reverse();
    image.set(label, start);
    const boot = Array.from(image.subarray(0x2b, 0x2b + 11)).reverse();
    image.set(boot, 0x2b);
    const failures = runSharedChecks('writers-disk', image);
    expect(failures.length).toBeGreaterThan(0);
    expect(groupsOf(failures)).toContain('shape');
  });

  it('(c) changing one byte of a README marker phrase is reported by markers', () => {
    const image = buildDemoDisk('writers-disk').image.slice();
    const at = indexOfBytes(image, MARKER_GENERATED);
    expect(at).toBeGreaterThanOrEqual(0);
    image[at] = (image[at] as number) ^ 0x20;
    const failures = runSharedChecks('writers-disk', image);
    expect(failures.length).toBeGreaterThan(0);
    expect(groupsOf(failures)).toContain('markers');
  });

  it('(d) flipping the cyclic link of LETTER.WS is reported by warnings', () => {
    const layout = layoutOf('damaged-disk');
    const clusters = node(layout, '/LETTER.WS').clusters;
    const last = clusters[clusters.length - 1] as number;
    setFatEntry(layout, last, 0xfff);
    const failures = runSharedChecks('damaged-disk', layout.image);
    expect(failures.length).toBeGreaterThan(0);
    expect(groupsOf(failures)).toContain('warnings');
  });

  it('(e) a boot-code byte at offset 100 is reported by shape', () => {
    const image = buildDemoDisk('office-disk').image.slice();
    image[100] = 0x90;
    const failures = runSharedChecks('office-disk', image);
    expect(failures.length).toBeGreaterThan(0);
    expect(groupsOf(failures)).toContain('shape');
  });

  it('(f) a PHONE cell outside the reserved range is reported by texts', () => {
    const image = buildDemoDisk('office-disk').image.slice();
    const at = indexOfBytes(image, '555-0104');
    expect(at).toBeGreaterThanOrEqual(0);
    image[at + 5] = '2'.charCodeAt(0); // 555-0204
    const failures = runSharedChecks('office-disk', image);
    expect(failures.length).toBeGreaterThan(0);
    expect(groupsOf(failures)).toContain('texts');
  });
});
