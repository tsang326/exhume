// Check group `warnings`: the Reader's warning codes for a demo image.

import type { DiskHandle } from '../../core/fat12/index';
import { planOf } from '../build';
import type { DemoDiskId } from '../specs';
import { expectationOf } from './expected';
import type { CheckFailure } from './types';

const CHECK = 'warnings';
const CYCLE_PATH = '/LETTER.WS';

export function checkWarnings(id: DemoDiskId, _image: Uint8Array, disk: DiskHandle): CheckFailure[] {
  const failures: CheckFailure[] = [];
  const fail = (message: string): void => {
    failures.push({ check: CHECK, message });
  };
  try {
    const expected = [...expectationOf(id, planOf(id)).warningCodes].sort();
    const warnings = disk.report.warnings;
    const actual = warnings.map((w) => w.code).sort();
    if (actual.join(',') !== expected.join(',')) {
      fail(`warning codes are [${actual.join(', ')}], expected [${expected.join(', ')}]`);
    }
    if (expected.includes('chain-cycle')) {
      const cycle = warnings.find((w) => w.code === 'chain-cycle');
      if (cycle === undefined || cycle.path !== CYCLE_PATH) {
        fail(`the chain-cycle warning does not name ${CYCLE_PATH}`);
      }
    }
  } catch (error) {
    fail(`unexpected exception: ${error instanceof Error ? error.message : 'unknown'}`);
  }
  return failures;
}
