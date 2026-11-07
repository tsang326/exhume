// Check group `graves`: the exact table of paths, kinds, states, sizes and dates, plus relations.

import type { DiskHandle, Grave } from '../../core/fat12/index';
import { planOf } from '../build';
import type { DemoDiskId } from '../specs';
import { expectationOf } from './expected';
import type { CheckFailure } from './types';

const CHECK = 'graves';
const CLUSTER_BYTES = 1024;

export function checkGraves(id: DemoDiskId, _image: Uint8Array, disk: DiskHandle): CheckFailure[] {
  const failures: CheckFailure[] = [];
  const fail = (message: string): void => {
    failures.push({ check: CHECK, message });
  };
  try {
    const expected = expectationOf(id, planOf(id));
    const files = disk.report.files;

    const gotPaths = files.map((g) => g.path).join(' | ');
    const wantPaths = expected.graves.map((g) => g.path).join(' | ');
    if (gotPaths !== wantPaths) fail(`graves are [${gotPaths}], expected [${wantPaths}]`);

    for (const want of expected.graves) {
      const got = files.find((g) => g.path === want.path);
      if (got === undefined) continue;
      if (got.kind !== want.kind) fail(`${want.path} has kind ${got.kind}, expected ${want.kind}`);
      if (got.state !== want.state) fail(`${want.path} has state ${got.state}, expected ${want.state}`);
      if (got.size !== want.size) fail(`${want.path} has size ${got.size}, expected ${want.size}`);
      if (got.date !== want.date) fail(`${want.path} has date ${String(got.date)}, expected ${want.date}`);
      if (want.state === 'alive') {
        if (got.reason !== undefined) fail(`${want.path} is alive but has a reason`);
      } else if (got.reason === undefined || got.reason.length === 0) {
        fail(`${want.path} is ${got.state} but has no reason`);
      }
    }

    const byPath = (path: string): Grave | undefined => files.find((g) => g.path === path);
    if (id === 'writers-disk') {
      const raft1 = byPath('/_RAFT1.WS');
      const raft2 = byPath('/_RAFT2.WS');
      const ch3 = byPath('/CHAPTER3.WS');
      if (raft2 !== undefined && ch3 !== undefined && raft2.startCluster + 2 !== ch3.startCluster) {
        fail('/_RAFT2.WS start cluster + 2 is not the start cluster of /CHAPTER3.WS');
      }
      if (raft1 !== undefined && Math.ceil(raft1.size / CLUSTER_BYTES) < 3) {
        fail('/_RAFT1.WS spans fewer than three clusters');
      }
      const restored = files.filter((g) => g.state === 'recovered' || g.state === 'partial').length;
      if (restored !== 2) fail(`${restored} recovered or partial files, expected exactly 2`);
      if (files.some((g) => g.state === 'lost')) fail('the writers disk holds a lost file');
    }
    if (id === 'office-disk') {
      const old = byPath('/_LDCUST.DBF');
      const customer = byPath('/CUSTOMER.DBF');
      if (old !== undefined && customer !== undefined && old.startCluster !== customer.startCluster) {
        fail('/_LDCUST.DBF does not start at the start cluster of /CUSTOMER.DBF');
      }
    }
  } catch (error) {
    fail(`unexpected exception: ${error instanceof Error ? error.message : 'unknown'}`);
  }
  return failures;
}
