/**
 * Local-only corpus run: reads every `.img` in the folder named by EXHUME_EXTRA_DISKS and prints a summary.
 * Skipped when the variable is unset or empty. Image content never fails the test.
 * Read-only: nothing is written, copied or fetched.
 */
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_BYTES, openDisk } from './fat12';
import { detectFormat } from './formats';

export type CorpusRow =
  | { kind: 'image'; name: string; files: number; graves: number; warnings: number; formats: Record<string, number> }
  | { kind: 'note'; name: string; note: string };

function formatCounts(formats: Record<string, number>): string {
  const keys = Object.keys(formats).sort();
  return keys.length === 0 ? '-' : keys.map((k) => `${k}=${formats[k]}`).join(' ');
}

/** Pure: one line per row, then a totals line. */
export function summarise(rows: readonly CorpusRow[]): string[] {
  const lines: string[] = [];
  let images = 0;
  let notes = 0;
  let files = 0;
  let graves = 0;
  let warnings = 0;
  const total: Record<string, number> = {};
  for (const row of rows) {
    if (row.kind === 'note') {
      notes++;
      lines.push(`${row.name}: NOTE ${row.note}`);
      continue;
    }
    images++;
    files += row.files;
    graves += row.graves;
    warnings += row.warnings;
    for (const [k, v] of Object.entries(row.formats)) total[k] = (total[k] ?? 0) + v;
    lines.push(`${row.name}: files=${row.files} graves=${row.graves} warnings=${row.warnings} formats: ${formatCounts(row.formats)}`);
  }
  lines.push(
    `TOTAL: images=${images} notes=${notes} files=${files} graves=${graves} warnings=${warnings} formats: ${formatCounts(total)}`,
  );
  return lines;
}

function lastSegment(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? path : path.slice(i + 1);
}

function isImgName(name: string): boolean {
  return name.length >= 4 && name.slice(-4).replace(/[A-Z]/g, (c) => c.toLowerCase()) === '.img';
}

function scanFolder(dir: string): CorpusRow[] {
  const rows: CorpusRow[] = [];
  let names: string[];
  try {
    names = readdirSync(dir).filter(isImgName).sort();
  } catch (e) {
    return [{ kind: 'note', name: dir, note: `cannot list folder: ${e instanceof Error ? e.message : 'error'}` }];
  }
  for (const name of names) {
    try {
      const full = join(dir, name);
      const st = lstatSync(full);
      if (!st.isFile()) {
        rows.push({ kind: 'note', name, note: 'skipped: not a regular file' });
        continue;
      }
      if (st.size > MAX_IMAGE_BYTES) {
        rows.push({ kind: 'note', name, note: `skipped: ${st.size} bytes exceeds ${MAX_IMAGE_BYTES}` });
        continue;
      }
      const handle = openDisk(new Uint8Array(readFileSync(full)));
      const report = handle.report;
      const formats: Record<string, number> = {};
      let files = 0;
      let graves = 0;
      for (const g of report.files) {
        if (g.state !== 'alive') graves++;
        if (g.kind !== 'file') continue;
        files++;
        const read = handle.readBytes(g);
        if (!read.ok) continue;
        const f = detectFormat(read.bytes, lastSegment(g.path)).format;
        formats[f] = (formats[f] ?? 0) + 1;
      }
      rows.push({ kind: 'image', name, files, graves, warnings: report.warnings.length, formats });
    } catch (e) {
      rows.push({ kind: 'note', name, note: `skipped: ${e instanceof Error ? e.message : 'read error'}` });
    }
  }
  return rows;
}

describe('summarise', () => {
  it('prints one line per row and totals, including notes', () => {
    const lines = summarise([
      { kind: 'image', name: 'a.img', files: 3, graves: 1, warnings: 0, formats: { pcx: 1, unknown: 2 } },
      { kind: 'note', name: 'b.img', note: 'too big' },
      { kind: 'image', name: 'c.img', files: 2, graves: 0, warnings: 4, formats: { pcx: 1, dbase: 1 } },
    ]);
    expect(lines).toEqual([
      'a.img: files=3 graves=1 warnings=0 formats: pcx=1 unknown=2',
      'b.img: NOTE too big',
      'c.img: files=2 graves=0 warnings=4 formats: dbase=1 pcx=1',
      'TOTAL: images=2 notes=1 files=5 graves=1 warnings=4 formats: dbase=1 pcx=2 unknown=2',
    ]);
  });

  it('handles no rows', () => {
    expect(summarise([])).toEqual(['TOTAL: images=0 notes=0 files=0 graves=0 warnings=0 formats: -']);
  });
});

const extraDir = process.env.EXHUME_EXTRA_DISKS;

describe.skipIf(extraDir === undefined || extraDir === '')('extra corpus (local only)', () => {
  it('reads every .img and prints a summary', () => {
    let completed = false;
    const rows = scanFolder(extraDir ?? '');
    for (const line of summarise(rows)) console.log(line);
    completed = true;
    expect(completed).toBe(true);
  });
});
