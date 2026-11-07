// Check group `reads`: file bytes and conversions, as the Reader and the converters report them.
// Pure over the opened disk and the plan sources. Never throws: an exception becomes a failure.

import { SCAN_TIME_BUDGET_MS } from '../../core/fat12/index';
import type { DiskHandle, Grave, ReadResult } from '../../core/fat12/index';
import { convertAuto } from '../../core/formats/index';
import { decodePng, parseCsv } from '../../test-support/formats/index';
import { timed } from '../../test-support/timed';
import type { DiskPlan } from '../build';
import { OFFICE_CUSTOMER_DBF, OFFICE_LOGO_PCX, LOGO } from '../content/office';
import { MARKER_GENERATED, MARKER_WRITTEN } from '../content/readme';
import type { DemoDiskId } from '../specs';
import type { Expectation } from './expected';
import type { CheckFailure } from './types';

const GROUP = 'reads';

/** Reader path -> author path, for the deleted files whose first character the directory entry lost. */
const AUTHOR_PATH: ReadonlyMap<string, string> = new Map([
  ['/_RAFT1.WS', '/DRAFT1.WS'],
  ['/_RAFT2.WS', '/DRAFT2.WS'],
  ['/_LDCUST.DBF', '/OLDCUST.DBF'],
]);

function authorPathOf(readerPath: string): string {
  return AUTHOR_PATH.get(readerPath) ?? readerPath;
}

function baseName(path: string): string {
  const at = path.lastIndexOf('/');
  return at < 0 ? path : path.slice(at + 1);
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function startsWithBytes(whole: Uint8Array, prefix: Uint8Array): boolean {
  if (prefix.length > whole.length) return false;
  for (let i = 0; i < prefix.length; i++) if (whole[i] !== prefix[i]) return false;
  return true;
}

function sameRows(a: string[][], b: string[][]): boolean {
  if (a.length !== b.length) return false;
  for (let r = 0; r < a.length; r++) {
    const x = a[r] as string[];
    const y = b[r] as string[];
    if (x.length !== y.length) return false;
    for (let c = 0; c < x.length; c++) if (x[c] !== y[c]) return false;
  }
  return true;
}

export function checkReads(
  _id: DemoDiskId,
  disk: DiskHandle,
  plan: DiskPlan,
  expectation: Expectation,
): CheckFailure[] {
  const failures: CheckFailure[] = [];
  const fail = (message: string): void => {
    failures.push({ check: GROUP, message });
  };

  try {
    const textFiles = new Set(expectation.textFiles);
    const byPath = new Map<string, Grave>();
    for (const g of disk.report.files) byPath.set(g.path, g);

    const readOf = (grave: Grave): ReadResult | undefined => {
      try {
        // The closure holds nothing but the read.
        return timed(() => disk.readBytes(grave), SCAN_TIME_BUDGET_MS);
      } catch (error) {
        fail(`${grave.path}: read threw or exceeded the time budget (${error instanceof Error ? 'error' : 'unknown'})`);
        return undefined;
      }
    };

    // Sweep: every file grave.
    for (const grave of disk.report.files) {
      if (grave.kind !== 'file') continue;
      const read = readOf(grave);
      if (read === undefined) continue;

      if (grave.state === 'lost') {
        if (read.ok) fail(`${grave.path}: a lost file must not return bytes`);
        continue;
      }
      if (!read.ok) {
        fail(`${grave.path}: read failed`);
        continue;
      }
      if (read.bytes.length > grave.size) fail(`${grave.path}: read returned more bytes than declared`);

      const source = plan.sources.get(authorPathOf(grave.path));
      if (source === undefined) {
        fail(`${grave.path}: no authored source`);
        continue;
      }

      if (grave.state === 'alive' && grave.path !== '/LETTER.WS') {
        if (!sameBytes(read.bytes, source)) fail(`${grave.path}: live read bytes differ from the source`);
      }

      const converted = convertAuto(read.bytes, baseName(grave.path));
      if (!converted.ok) {
        fail(`${grave.path}: conversion failed`);
      } else if (textFiles.has(grave.path)) {
        if (converted.mime !== 'text/plain') fail(`${grave.path}: expected a plain text conversion`);
        if (converted.warnings.length !== 0) fail(`${grave.path}: plain text conversion has warnings`);
        if (grave.path === '/README.TXT') {
          const text = typeof converted.output === 'string' ? converted.output : '';
          if (!text.includes(MARKER_GENERATED)) fail(`${grave.path}: text lacks the generated-by marker phrase`);
          if (!text.includes(MARKER_WRITTEN)) fail(`${grave.path}: text lacks the written-for-the-demo marker phrase`);
        }
      }
    }

    // /_RAFT1.WS: recovered in full, same Markdown as the source.
    const draft1 = byPath.get('/_RAFT1.WS');
    if (draft1 !== undefined) {
      const source = plan.sources.get('/DRAFT1.WS');
      const read = readOf(draft1);
      if (source === undefined || read === undefined || !read.ok) {
        fail('/_RAFT1.WS: no bytes or no source');
      } else {
        if (!sameBytes(read.bytes, source)) fail('/_RAFT1.WS: recovered bytes differ from the source');
        const fromDisk = convertAuto(read.bytes, '_RAFT1.WS');
        const fromSource = convertAuto(source, '_RAFT1.WS');
        if (!fromDisk.ok || !fromSource.ok || fromDisk.output !== fromSource.output) {
          fail('/_RAFT1.WS: Markdown from the disk differs from the Markdown of the source');
        }
      }
    }

    // /_RAFT2.WS: partial, fewer bytes than declared, still converts.
    const draft2 = byPath.get('/_RAFT2.WS');
    if (draft2 !== undefined) {
      const read = readOf(draft2);
      if (read === undefined || !read.ok) {
        fail('/_RAFT2.WS: no bytes');
      } else {
        if (read.bytes.length >= draft2.size) fail('/_RAFT2.WS: a partial file must return fewer bytes than declared');
        const converted = convertAuto(read.bytes, '_RAFT2.WS');
        if (!converted.ok || typeof converted.output !== 'string' || converted.output.trim().length === 0) {
          fail('/_RAFT2.WS: the partial file does not convert to non-empty Markdown');
        }
      }
    }

    // /LETTER.WS: finite, at most the declared size, begins with the authored bytes.
    const letter = byPath.get('/LETTER.WS');
    if (letter !== undefined) {
      const read = readOf(letter);
      const source = plan.sources.get('/LETTER.WS');
      if (read === undefined || !read.ok) {
        fail('/LETTER.WS: no bytes');
      } else if (source !== undefined && !startsWithBytes(read.bytes, source)) {
        fail('/LETTER.WS: read bytes do not start with the authored bytes');
      }
    }

    // /_LDCUST.DBF: the Reader's lost result, no conversion.
    const oldCust = byPath.get('/_LDCUST.DBF');
    if (oldCust !== undefined && oldCust.state !== 'lost') fail('/_LDCUST.DBF: expected state lost');

    // /CHAPTER1.WS: Markdown with authored text and an emphasis marker.
    const chapter1 = byPath.get('/CHAPTER1.WS');
    if (chapter1 !== undefined) {
      const read = readOf(chapter1);
      if (read !== undefined && read.ok) {
        const converted = convertAuto(read.bytes, 'CHAPTER1.WS');
        if (!converted.ok || typeof converted.output !== 'string') {
          fail('/CHAPTER1.WS: no Markdown');
        } else {
          if (converted.output.replace(/[*\s]/g, '').length < 100) fail('/CHAPTER1.WS: Markdown holds too little text');
          if (!converted.output.includes('*')) fail('/CHAPTER1.WS: Markdown holds no emphasis marker');
        }
      }
    }

    // /CUSTOMER.DBF: CSV equal to the authored rows.
    const customer = byPath.get('/CUSTOMER.DBF');
    if (customer !== undefined) {
      const read = readOf(customer);
      if (read !== undefined && read.ok) {
        const converted = convertAuto(read.bytes, 'CUSTOMER.DBF');
        if (!converted.ok || typeof converted.output !== 'string') {
          fail('/CUSTOMER.DBF: no CSV');
        } else if (!sameRows(parseCsv(converted.output), OFFICE_CUSTOMER_DBF.expectedCsv)) {
          fail('/CUSTOMER.DBF: CSV rows differ from the authored rows');
        }
      }
    }

    // /LOGO.PCX: PNG with the authored size and pixels.
    const logo = byPath.get('/LOGO.PCX');
    if (logo !== undefined) {
      const read = readOf(logo);
      if (read !== undefined && read.ok) {
        const converted = convertAuto(read.bytes, 'LOGO.PCX');
        if (!converted.ok || typeof converted.output === 'string') {
          fail('/LOGO.PCX: no PNG');
        } else {
          const png = decodePng(converted.output);
          if (png.width !== LOGO.width || png.height !== LOGO.height) {
            fail('/LOGO.PCX: PNG size differs from the authored size');
          } else if (!sameBytes(png.rgba, OFFICE_LOGO_PCX.expectedRgba)) {
            fail('/LOGO.PCX: PNG pixels differ from the authored pixels');
          }
        }
      }
    }
  } catch (error) {
    fail(`unexpected exception (${error instanceof Error ? error.name : 'unknown'})`);
  }
  return failures;
}
