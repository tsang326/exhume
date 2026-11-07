// Fixed facts about the three demo disks: file name, volume label, geometry, serial.
// Pure data. Every value is a constant in this file so the images depend on nothing else.

import type { StandardGeometryName } from '../test-support/fat12/index';

export type DemoDiskId = 'writers-disk' | 'office-disk' | 'damaged-disk';

export interface DemoDiskSpec {
  id: DemoDiskId;
  /** File name inside public/disks/. */
  fileName: string;
  /** FAT volume label, at most 11 ASCII characters. */
  label: string;
  geometry: StandardGeometryName;
  /** Volume serial number written into the boot sector. */
  serial: number;
}

export const DEMO_DISK_SPECS: readonly DemoDiskSpec[] = [
  {
    id: 'writers-disk',
    fileName: 'writers-disk.img',
    label: 'WRITER DEMO',
    geometry: '360K',
    serial: 0x45584831,
  },
  {
    id: 'office-disk',
    fileName: 'office-disk.img',
    label: 'OFFICE DEMO',
    geometry: '720K',
    serial: 0x45584832,
  },
  {
    id: 'damaged-disk',
    fileName: 'damaged-disk.img',
    label: 'DAMAGE DEMO',
    geometry: '360K',
    serial: 0x45584833,
  },
];

export function specOf(id: DemoDiskId): DemoDiskSpec {
  const spec = DEMO_DISK_SPECS.find((s) => s.id === id);
  if (spec === undefined) throw new RangeError(`unknown demo disk: ${id}`);
  return spec;
}
