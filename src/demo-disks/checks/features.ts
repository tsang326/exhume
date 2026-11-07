// Check group `features`: the authored sources must show the formats' interesting features.
// Pure over the plan sources. Never throws: an exception becomes a failure.

import { convertAuto } from '../../core/formats/index';
import { decodePng } from '../../test-support/formats/index';
import type { DiskPlan } from '../build';
import type { DemoDiskId } from '../specs';
import type { CheckFailure } from './types';

const GROUP = 'features';
const CHAPTERS = ['/CHAPTER1.WS', '/CHAPTER2.WS', '/CHAPTER3.WS'];

function hasByte(bytes: Uint8Array, value: number): boolean {
  for (let i = 0; i < bytes.length; i++) if (bytes[i] === value) return true;
  return false;
}

function hasPair(bytes: Uint8Array, a: number, b: number): boolean {
  for (let i = 0; i + 1 < bytes.length; i++) if (bytes[i] === a && bytes[i + 1] === b) return true;
  return false;
}

/** ASCII letter; WordStar sets the high bit on the last character of a word, so it is masked. */
function isLetter(raw: number | undefined): boolean {
  if (raw === undefined) return false;
  const code = raw & 0x7f;
  return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

/** A line that starts with `.` and two ASCII letters. */
function hasDotLine(bytes: Uint8Array): boolean {
  for (let i = 0; i + 2 < bytes.length; i++) {
    const atLineStart = i === 0 || bytes[i - 1] === 0x0a;
    if (atLineStart && bytes[i] === 0x2e && isLetter(bytes[i + 1]) && isLetter(bytes[i + 2])) return true;
  }
  return false;
}

function u16(bytes: Uint8Array, at: number): number {
  return (bytes[at] as number) | ((bytes[at + 1] as number) << 8);
}

function u32(bytes: Uint8Array, at: number): number {
  return (u16(bytes, at) | (u16(bytes, at + 2) << 16)) >>> 0;
}

function checkChapters(plan: DiskPlan, fail: (m: string) => void): void {
  const parts: Uint8Array[] = [];
  for (const path of CHAPTERS) {
    const source = plan.sources.get(path);
    if (source === undefined) fail(`${path}: no authored source`);
    else parts.push(source);
  }
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    all.set(p, at);
    at += p.length;
  }
  if (!hasByte(all, 0x02)) fail('chapters hold no bold toggle (0x02)');
  if (!hasByte(all, 0x13)) fail('chapters hold no underline toggle (0x13)');
  if (!hasByte(all, 0x19)) fail('chapters hold no italic toggle (0x19)');
  if (!hasPair(all, 0x8d, 0x0a)) fail('chapters hold no soft return (0x8D 0x0A)');
  if (!hasDotLine(all)) fail('chapters hold no dot-command line');
}

function checkTable(plan: DiskPlan, fail: (m: string) => void): void {
  const dbf = plan.sources.get('/CUSTOMER.DBF');
  if (dbf === undefined) {
    fail('/CUSTOMER.DBF: no authored source');
    return;
  }
  if (dbf.length < 33) {
    fail('/CUSTOMER.DBF: too short for a header');
    return;
  }
  const records = u32(dbf, 4);
  const headerLength = u16(dbf, 8);
  if (records < 12) fail('/CUSTOMER.DBF: fewer than 12 records');
  let fields = 0;
  let phoneC = false;
  let numeric = false;
  let date = false;
  for (let at = 32; at + 32 <= headerLength && at + 32 <= dbf.length && dbf[at] !== 0x0d; at += 32) {
    fields++;
    let name = '';
    for (let i = 0; i < 11 && dbf[at + i] !== 0; i++) name += String.fromCharCode(dbf[at + i] as number);
    const type = String.fromCharCode(dbf[at + 11] as number);
    if (type === 'C' && name.includes('PHONE')) phoneC = true;
    if (type === 'N') numeric = true;
    if (type === 'D') date = true;
  }
  if (fields < 5) fail('/CUSTOMER.DBF: fewer than 5 fields');
  if (!phoneC) fail('/CUSTOMER.DBF: no C field with PHONE in its name');
  if (!numeric) fail('/CUSTOMER.DBF: no N field');
  if (!date) fail('/CUSTOMER.DBF: no D field');
  let high = false;
  for (let i = headerLength; i < dbf.length; i++) {
    if ((dbf[i] as number) > 0x7f) {
      high = true;
      break;
    }
  }
  if (!high) fail('/CUSTOMER.DBF: no byte above 0x7F in the records');
}

function checkLogo(plan: DiskPlan, fail: (m: string) => void): void {
  const pcx = plan.sources.get('/LOGO.PCX');
  if (pcx === undefined || pcx.length < 128) {
    fail('/LOGO.PCX: no authored source');
    return;
  }
  const width = u16(pcx, 8) - u16(pcx, 4) + 1;
  const height = u16(pcx, 10) - u16(pcx, 6) + 1;
  if (width < 1 || height < 1 || width > 256 || height > 256) fail('/LOGO.PCX: larger than 256 by 256');
  const converted = convertAuto(pcx, 'LOGO.PCX');
  if (!converted.ok || typeof converted.output === 'string') {
    fail('/LOGO.PCX: does not convert');
    return;
  }
  const png = decodePng(converted.output);
  const seen = new Set<number>();
  for (let i = 0; i + 3 < png.rgba.length; i += 4) {
    seen.add(((png.rgba[i] as number) << 16) | ((png.rgba[i + 1] as number) << 8) | (png.rgba[i + 2] as number));
  }
  if (seen.size < 4) fail('/LOGO.PCX: fewer than 4 distinct colors');
}

export function checkFeatures(id: DemoDiskId, plan: DiskPlan): CheckFailure[] {
  const failures: CheckFailure[] = [];
  const fail = (message: string): void => {
    failures.push({ check: GROUP, message });
  };
  try {
    if (id === 'writers-disk') checkChapters(plan, fail);
    if (id === 'office-disk') {
      checkTable(plan, fail);
      checkLogo(plan, fail);
    }
  } catch (error) {
    fail(`unexpected exception (${error instanceof Error ? error.name : 'unknown'})`);
  }
  return failures;
}
