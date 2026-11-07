// Public surface of the demo-disk generator.

export { buildAllDemoDisks, buildDemoDisk, buildFromPlan, planOf } from './build';
export type { DiskPlan, FreshDisk } from './build';
export { runSharedChecks } from './checks/index';
export type { CheckFailure } from './checks/types';
export { DemoBuildError } from './errors';
export { DEMO_DISK_SPECS, specOf } from './specs';
export type { DemoDiskId, DemoDiskSpec } from './specs';
