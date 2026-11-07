// Check group `markers`: plain-text README facts, volume labels, no executable extensions.

import { openDisk } from '../../core/fat12/index';
import type { Grave } from '../../core/fat12/index';
import { DEFECT_BPB, DEFECT_CHAIN, MARKER_GENERATED, MARKER_WRITTEN } from '../content/readme';
import { specOf } from '../specs';
import type { DemoDiskId } from '../specs';
import type { CheckFailure } from './types';

const GROUP = 'markers';

/** Extensions no grave may carry, compared in upper case. */
const FORBIDDEN_EXTENSIONS: readonly string[] = ['EXE', 'COM', 'BAT', 'SYS', 'SCR', 'PIF', 'VBS', 'JS'];

function fail(message: string): CheckFailure {
  return { check: GROUP, message };
}

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toUpperCase();
}

/** Tab, LF, CR and printable ASCII only. */
function isPlainAscii(bytes: Uint8Array): boolean {
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i] as number;
    const ok = b === 0x09 || b === 0x0a || b === 0x0d || (b >= 0x20 && b <= 0x7e);
    if (!ok) return false;
  }
  return true;
}

function asciiText(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i] as number);
  return text;
}

export function checkMarkers(id: DemoDiskId, image: Uint8Array): CheckFailure[] {
  try {
    const failures: CheckFailure[] = [];
    const spec = specOf(id);
    const handle = openDisk(image);
    const report = handle.report;

    if (report.volume.label !== spec.label) {
      failures.push(fail(`volume label differs from the expected label ${spec.label}`));
    }

    for (const grave of report.files) {
      if (FORBIDDEN_EXTENSIONS.includes(extensionOf(grave.path))) {
        failures.push(fail(`grave ${grave.path} has a forbidden extension`));
      }
    }

    const readmes: Grave[] = report.files.filter((g) => g.kind === 'file' && g.path === '/README.TXT');
    if (readmes.length !== 1) {
      failures.push(fail(`expected exactly one /README.TXT, found ${readmes.length}`));
    }
    for (const grave of readmes) {
      const read = handle.readBytes(grave);
      if (!read.ok) {
        failures.push(fail('/README.TXT cannot be read'));
        continue;
      }
      if (!isPlainAscii(read.bytes)) failures.push(fail('/README.TXT is not plain ASCII'));
      const text = asciiText(read.bytes);
      if (!text.includes(MARKER_GENERATED)) failures.push(fail('/README.TXT lacks the generated-by marker phrase'));
      if (!text.includes(MARKER_WRITTEN)) failures.push(fail('/README.TXT lacks the written-for-the-demo marker phrase'));
      if (id === 'damaged-disk') {
        if (!text.includes(DEFECT_BPB)) failures.push(fail('/README.TXT does not name the boot sector defect'));
        if (!text.includes(DEFECT_CHAIN)) failures.push(fail('/README.TXT does not name the cluster chain defect'));
      }
    }
    return failures;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown error';
    return [fail(`check group threw: ${reason}`)];
  }
}
