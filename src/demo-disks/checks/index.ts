// Shared_Checks entry point: opens an image once and runs every check group over it.
// Pure over the image bytes. Never throws and reads no clock or file system.

import { openDisk } from '../../core/fat12/index';
import type { DiskHandle } from '../../core/fat12/index';
import { planOf } from '../build';
import type { DiskPlan } from '../build';
import type { DemoDiskId } from '../specs';
import { expectationOf } from './expected';
import type { Expectation } from './expected';
import { checkFeatures } from './features';
import { checkGraves } from './graves';
import { checkMarkers } from './markers';
import { checkReads } from './reads';
import { checkShape } from './shape';
import { checkTexts } from './texts';
import type { CheckFailure } from './types';
import { checkWarnings } from './warnings';

export type { CheckFailure } from './types';

interface Group {
  name: string;
  run: (id: DemoDiskId, image: Uint8Array, disk: DiskHandle, plan: DiskPlan, expectation: Expectation) => CheckFailure[];
}

const GROUPS: readonly Group[] = [
  { name: 'shape', run: (id, image, disk) => checkShape(id, image, disk) },
  { name: 'graves', run: (id, image, disk) => checkGraves(id, image, disk) },
  { name: 'warnings', run: (id, image, disk) => checkWarnings(id, image, disk) },
  { name: 'reads', run: (id, _image, disk, plan, expectation) => checkReads(id, disk, plan, expectation) },
  { name: 'features', run: (id, _image, _disk, plan) => checkFeatures(id, plan) },
  { name: 'markers', run: (id, image) => checkMarkers(id, image) },
  { name: 'texts', run: (id, image) => checkTexts(id, image) },
];

function describe(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

/** Runs all check groups on `image`. An empty result means every check passed. */
export function runSharedChecks(id: DemoDiskId, image: Uint8Array): CheckFailure[] {
  let disk: DiskHandle;
  let plan: DiskPlan;
  let expectation: Expectation;
  try {
    disk = openDisk(image);
    plan = planOf(id);
    expectation = expectationOf(id, plan);
  } catch (error) {
    return [{ check: 'open', message: `could not prepare the checks: ${describe(error)}` }];
  }

  const failures: CheckFailure[] = [];
  for (const group of GROUPS) {
    try {
      failures.push(...group.run(id, image, disk, plan, expectation));
    } catch (error) {
      failures.push({ check: group.name, message: `unexpected exception: ${describe(error)}` });
    }
  }
  return failures;
}
