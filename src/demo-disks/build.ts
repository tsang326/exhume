// Plans and the build function: turns a disk plan into the bytes of one floppy image.
// Pure and deterministic: same plan, same bytes.

import { writeFat12Image } from '../test-support/fat12/index';
import type { DamageSpec, FileTree } from '../test-support/fat12/index';
import { damagedPlan } from './content/damaged';
import { officePlan } from './content/office';
import { writersPlan } from './content/writers';
import { DemoBuildError } from './errors';
import { DEMO_DISK_SPECS, specOf } from './specs';
import type { DemoDiskId, DemoDiskSpec } from './specs';

export interface DiskPlan {
  /** Volume label and children, every node with an explicit `modified`. */
  tree: FileTree;
  /** Empty except for the damaged disk. */
  damage: DamageSpec[];
  /** Author path -> bytes produced by the fixture writers. */
  sources: ReadonlyMap<string, Uint8Array>;
}

export interface FreshDisk {
  spec: DemoDiskSpec;
  image: Uint8Array;
}

export function planOf(id: DemoDiskId): DiskPlan {
  switch (id) {
    case 'writers-disk':
      return writersPlan();
    case 'office-disk':
      return officePlan();
    case 'damaged-disk':
      return damagedPlan();
  }
}

/** Build one image from an explicit plan. Any failure becomes a DemoBuildError naming the file. */
export function buildFromPlan(spec: DemoDiskSpec, plan: DiskPlan): FreshDisk {
  try {
    const image = writeFat12Image(plan.tree, spec.geometry, {
      serial: spec.serial,
      damage: plan.damage,
    });
    return { spec, image };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown build error';
    throw new DemoBuildError(spec.fileName, message);
  }
}

export function buildDemoDisk(id: DemoDiskId): FreshDisk {
  const spec = specOf(id);
  try {
    return buildFromPlan(spec, planOf(id));
  } catch (error) {
    if (error instanceof DemoBuildError) throw error;
    const message = error instanceof Error ? error.message : 'unknown build error';
    throw new DemoBuildError(spec.fileName, message);
  }
}

/** All three disks in spec order. Builds every disk before returning. */
export function buildAllDemoDisks(): FreshDisk[] {
  const disks: FreshDisk[] = [];
  for (const spec of DEMO_DISK_SPECS) disks.push(buildDemoDisk(spec.id));
  return disks;
}
