// Check group `shape`: size, geometry, label, serial and boot sector of a demo image.

import { MAX_IMAGE_BYTES } from '../../core/fat12/index';
import type { DiskHandle } from '../../core/fat12/index';
import { standardGeometry } from '../../test-support/fat12/index';
import { specOf } from '../specs';
import type { DemoDiskId } from '../specs';
import type { CheckFailure } from './types';

const CHECK = 'shape';
const MAX_FLOPPY_BYTES = 1_474_560;
const MAX_GRAVES = 64;
const MAX_PATH_PARTS = 2;
const MAX_DECLARED_SIZE = 65_536;

function expectedGeometrySource(id: DemoDiskId): 'bpb' | 'fallback' {
  return id === 'damaged-disk' ? 'fallback' : 'bpb';
}

export function checkShape(id: DemoDiskId, image: Uint8Array, disk: DiskHandle): CheckFailure[] {
  const failures: CheckFailure[] = [];
  const fail = (message: string): void => {
    failures.push({ check: CHECK, message });
  };
  try {
    const spec = specOf(id);
    const geometry = standardGeometry(spec.geometry);
    const capacity = geometry.totalSectors * geometry.bytesPerSector;
    if (image.length !== capacity) fail(`image length ${image.length} differs from the ${spec.geometry} capacity ${capacity}`);
    if (image.length > MAX_IMAGE_BYTES) fail(`image length ${image.length} exceeds the Reader limit ${MAX_IMAGE_BYTES}`);
    if (image.length > MAX_FLOPPY_BYTES) fail(`image length ${image.length} exceeds ${MAX_FLOPPY_BYTES}`);

    const { volume, files } = disk.report;
    const wantSource = expectedGeometrySource(id);
    if (volume.geometrySource !== wantSource) {
      fail(`geometry source is ${volume.geometrySource}, expected ${wantSource}`);
    }
    if (volume.label !== spec.label) fail(`volume label is "${volume.label}", expected "${spec.label}"`);

    if (image.length >= 512) {
      const serial = (image[0x27]! | (image[0x28]! << 8) | (image[0x29]! << 16) | (image[0x2a]! << 24)) >>> 0;
      if (serial !== spec.serial) fail(`volume serial is 0x${serial.toString(16)}, expected 0x${spec.serial.toString(16)}`);
      if (image[0] !== 0xeb || image[1] !== 0x3c || image[2] !== 0x90) fail('boot sector does not start with EB 3C 90');
      for (let i = 62; i <= 509; i++) {
        if (image[i] !== 0) {
          fail(`boot sector holds a non-zero byte at offset ${i}`);
          break;
        }
      }
    } else {
      fail('image is shorter than one boot sector');
    }

    if (files.length > MAX_GRAVES) fail(`${files.length} graves, at most ${MAX_GRAVES} allowed`);
    for (const grave of files) {
      if (grave.path.split('/').filter((part) => part !== '').length > MAX_PATH_PARTS) {
        fail(`path ${grave.path} is deeper than ${MAX_PATH_PARTS} parts`);
      }
      if (grave.size > MAX_DECLARED_SIZE) fail(`declared size of ${grave.path} is above ${MAX_DECLARED_SIZE}`);
    }
  } catch (error) {
    fail(`unexpected exception: ${error instanceof Error ? error.message : 'unknown'}`);
  }
  return failures;
}
