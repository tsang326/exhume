// Check group `texts`: gathers the text of a disk and applies the link and phone scans.
// Phone_Scope: PHONE columns, all WordStar Markdown and each README.TXT.

import { openDisk } from '../../core/fat12/index';
import { convertAuto } from '../../core/formats/index';
import { parseCsv } from '../../test-support/formats/index';
import { planOf } from '../build';
import type { DemoDiskId } from '../specs';
import { scanLinks, scanPhones } from './text-scan';
import type { CheckFailure } from './types';

const GROUP = 'texts';

/** Author path of the source of the lost customer table. */
const LOST_SOURCE_PATH = '/OLDCUST.DBF';

interface DiskText {
  /** Reader-side path, used in messages. */
  path: string;
  text: string;
  /** Every phone-shaped token in the text must be reserved. */
  phoneScopeAll: boolean;
  /** The text is CSV: the PHONE column is in the Phone_Scope. */
  csv: boolean;
}

function fail(message: string): CheckFailure {
  return { check: GROUP, message };
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

function extensionOf(path: string): string {
  const name = baseName(path);
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toUpperCase();
}

function asciiText(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i] as number);
  return text;
}

function checkLinks(item: DiskText, failures: CheckFailure[]): void {
  const scan = scanLinks(item.text);
  if (!scan.ok) {
    failures.push(fail(`text of ${item.path} is longer than the scan cap`));
  } else if (scan.findings.length > 0) {
    failures.push(fail(`text of ${item.path} holds ${scan.findings.length} link or address shape(s)`));
  }
}

function checkPhones(item: DiskText, failures: CheckFailure[]): void {
  if (item.csv) {
    checkPhoneColumn(item, failures);
    return;
  }
  if (!item.phoneScopeAll) return;
  const scan = scanPhones(item.text);
  if (!scan.ok) {
    failures.push(fail(`text of ${item.path} is longer than the scan cap`));
    return;
  }
  const bad = scan.matches.filter((m) => !m.reserved).length;
  if (bad > 0) failures.push(fail(`text of ${item.path} holds ${bad} phone number(s) outside the reserved range`));
}

function checkPhoneColumn(item: DiskText, failures: CheckFailure[]): void {
  let rows: string[][];
  try {
    rows = parseCsv(item.text);
  } catch {
    failures.push(fail(`CSV of ${item.path} cannot be parsed`));
    return;
  }
  const header = rows[0];
  if (header === undefined) {
    failures.push(fail(`CSV of ${item.path} is empty`));
    return;
  }
  const columns: number[] = [];
  header.forEach((name, index) => {
    if (name.toUpperCase().includes('PHONE')) columns.push(index);
  });
  if (columns.length === 0) {
    // The live customer table must have a PHONE column; the older lost table may lack one.
    if (item.path === '/CUSTOMER.DBF') failures.push(fail(`CSV of ${item.path} has no PHONE column`));
    return;
  }
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r] as string[];
    for (const c of columns) {
      const value = row[c];
      if (value === undefined) {
        failures.push(fail(`row ${r} of ${item.path} has no PHONE cell`));
        continue;
      }
      const scan = scanPhones(value);
      const ok =
        scan.ok &&
        scan.matches.length === 1 &&
        (scan.matches[0] as { text: string; reserved: boolean }).text === value &&
        (scan.matches[0] as { reserved: boolean }).reserved;
      if (!ok) failures.push(fail(`row ${r} of ${item.path} has a PHONE value that is not a reserved number`));
    }
  }
}

function gather(id: DemoDiskId, image: Uint8Array, failures: CheckFailure[]): DiskText[] {
  const items: DiskText[] = [];
  const handle = openDisk(image);

  const addConverted = (path: string, bytes: Uint8Array, expectCsv: boolean): void => {
    const result = convertAuto(bytes, baseName(path));
    if (!result.ok || typeof result.output !== 'string') {
      failures.push(fail(`${path} cannot be converted to text`));
      return;
    }
    items.push({ path, text: result.output, phoneScopeAll: !expectCsv, csv: expectCsv });
  };

  for (const grave of handle.report.files) {
    if (grave.kind !== 'file' || grave.state === 'lost') continue;
    const ext = extensionOf(grave.path);
    if (ext === 'PCX') continue;
    const read = handle.readBytes(grave);
    if (!read.ok) {
      failures.push(fail(`${grave.path} cannot be read`));
      continue;
    }
    if (ext === 'TXT') {
      items.push({
        path: grave.path,
        text: asciiText(read.bytes),
        phoneScopeAll: baseName(grave.path) === 'README.TXT',
        csv: false,
      });
    } else if (ext === 'WS') {
      addConverted(grave.path, read.bytes, false);
    } else if (ext === 'DBF') {
      addConverted(grave.path, read.bytes, true);
    }
  }

  // The lost file cannot be read from the image, but its authored source is disk text too.
  const lostSource = planOf(id).sources.get(LOST_SOURCE_PATH);
  if (lostSource !== undefined) addConverted('/_LDCUST.DBF', lostSource, true);
  return items;
}

export function checkTexts(id: DemoDiskId, image: Uint8Array): CheckFailure[] {
  try {
    const failures: CheckFailure[] = [];
    const items = gather(id, image, failures);
    for (const item of items) {
      checkLinks(item, failures);
      checkPhones(item, failures);
    }
    return failures;
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unknown error';
    return [fail(`check group threw: ${reason}`)];
  }
}
