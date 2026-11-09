/**
 * Real-disk grading: FreeDOS 1.3 floppy images graded against manifest.json.
 * Expected values come only from the manifest (made by an independent oracle, not by Exhume).
 * Read-only: no writes, no network.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../test-support/sha256';
import { openDisk } from './fat12';
import { detectFormat } from './formats';

interface ManifestFile {
  path: string;
  size: number;
  sha256: string;
}
interface DeletedEntry {
  path: string;
  size: number;
}
interface ManifestImage {
  file: string;
  bytes: number;
  sha256: string;
  volumeLabel: string;
  directories: string[];
  files: ManifestFile[];
  deletedEntries: DeletedEntry[];
}
interface Manifest {
  images: ManifestImage[];
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function field(obj: Record<string, unknown>, key: string, where: string): unknown {
  if (!(key in obj)) throw new Error(`${where}.${key} is missing`);
  return obj[key];
}

function str(obj: Record<string, unknown>, key: string, where: string): string {
  const v = field(obj, key, where);
  if (typeof v !== 'string') throw new Error(`${where}.${key} must be a string`);
  return v;
}

function num(obj: Record<string, unknown>, key: string, where: string): number {
  const v = field(obj, key, where);
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
    throw new Error(`${where}.${key} must be a non-negative integer`);
  }
  return v;
}

function list(obj: Record<string, unknown>, key: string, where: string): unknown[] {
  const v = field(obj, key, where);
  if (!Array.isArray(v)) throw new Error(`${where}.${key} must be an array`);
  return v;
}

export function parseManifest(json: unknown): Manifest {
  if (!isRecord(json)) throw new Error('manifest must be an object');
  const images = list(json, 'images', 'manifest');
  return {
    images: images.map((raw, i): ManifestImage => {
      const w = `images[${i}]`;
      if (!isRecord(raw)) throw new Error(`${w} must be an object`);
      const directories = list(raw, 'directories', w).map((d, j) => {
        if (typeof d !== 'string') throw new Error(`${w}.directories[${j}] must be a string`);
        return d;
      });
      const files = list(raw, 'files', w).map((f, j): ManifestFile => {
        const fw = `${w}.files[${j}]`;
        if (!isRecord(f)) throw new Error(`${fw} must be an object`);
        return { path: str(f, 'path', fw), size: num(f, 'size', fw), sha256: str(f, 'sha256', fw) };
      });
      const deletedEntries = list(raw, 'deletedEntries', w).map((d, j): DeletedEntry => {
        const dw = `${w}.deletedEntries[${j}]`;
        if (!isRecord(d)) throw new Error(`${dw} must be an object`);
        return { path: str(d, 'path', dw), size: num(d, 'size', dw) };
      });
      return {
        file: str(raw, 'file', w),
        bytes: num(raw, 'bytes', w),
        sha256: str(raw, 'sha256', w),
        volumeLabel: str(raw, 'volumeLabel', w),
        directories,
        files,
        deletedEntries,
      };
    }),
  };
}

/** Case fold of A-Z only. */
export function foldAscii(s: string): string {
  return s.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
}

function lastSegment(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? path : path.slice(i + 1);
}

/** Long-name forms the reader may report for entries the manifest lists with an underscore. */
const LONG_NAME_ALTERNATIVES: Readonly<Record<string, string>> = {
  '/_reedos.012': '/freedos.012',
  '/_reedos.020': '/freedos.020',
};

function dupes(keys: string[]): string[] {
  const seen = new Set<string>();
  const out = new Set<string>();
  for (const k of keys) {
    if (seen.has(k)) out.add(k);
    seen.add(k);
  }
  return [...out];
}

export function gradeImage(entry: ManifestImage, image: Uint8Array): string[] {
  const problems: string[] = [];

  // 1. Integrity of the image itself, before reading it.
  if (image.length !== entry.bytes) problems.push(`image length ${image.length} != ${entry.bytes}`);
  if (sha256Hex(image) !== entry.sha256) problems.push('image sha256 differs from manifest');
  if (problems.length > 0) return problems;

  // 2. Open, zero warnings.
  const handle = openDisk(image);
  const report = handle.report;
  if (report.warnings.length !== 0) {
    problems.push(`expected 0 warnings, got ${report.warnings.length}: ${report.warnings.map((w) => w.code).join(',')}`);
  }

  // 3. Alive files.
  const aliveFiles = report.files.filter((g) => g.kind === 'file' && g.state === 'alive');
  const actual = new Map<string, (typeof aliveFiles)[number]>();
  for (const d of dupes(aliveFiles.map((g) => foldAscii(g.path)))) problems.push(`duplicate folded path in report: ${d}`);
  for (const g of aliveFiles) actual.set(foldAscii(g.path), g);
  for (const d of dupes(entry.files.map((f) => foldAscii(f.path)))) problems.push(`duplicate folded path in manifest: ${d}`);
  const expected = new Map(entry.files.map((f) => [foldAscii(f.path), f]));
  for (const key of expected.keys()) if (!actual.has(key)) problems.push(`missing file: ${key}`);
  for (const key of actual.keys()) if (!expected.has(key)) problems.push(`unexpected file: ${key}`);

  const bytesByKey = new Map<string, Uint8Array>();
  for (const [key, want] of expected) {
    const grave = actual.get(key);
    if (grave === undefined) continue;
    if (grave.size !== want.size) problems.push(`size of ${key}: ${grave.size} != ${want.size}`);
    const read = handle.readBytes(grave);
    if (!read.ok) {
      problems.push(`read failed for ${key}`);
      continue;
    }
    bytesByKey.set(key, read.bytes);
    if (sha256Hex(read.bytes) !== want.sha256) problems.push(`sha256 of ${key} differs`);
  }

  // 4. Directories.
  const aliveDirs = new Set(report.files.filter((g) => g.kind === 'directory' && g.state === 'alive').map((g) => foldAscii(g.path)));
  const wantDirs = new Set(entry.directories.map(foldAscii));
  for (const d of wantDirs) if (!aliveDirs.has(d)) problems.push(`missing directory: ${d}`);
  for (const d of aliveDirs) if (!wantDirs.has(d)) problems.push(`unexpected directory: ${d}`);

  // 5. No WordStar false positives.
  for (const [key, bytes] of bytesByKey) {
    if (detectFormat(bytes, lastSegment(key)).format === 'wordstar') problems.push(`detected as wordstar: ${key}`);
  }

  // 6. Deleted entries, as folded (path, size) pairs.
  const graves = report.files.filter((g) => g.state !== 'alive').map((g) => `${foldAscii(g.path)}|${g.size}`);
  const remaining = new Map<string, number>();
  for (const g of graves) remaining.set(g, (remaining.get(g) ?? 0) + 1);
  for (const d of entry.deletedEntries) {
    const key = `${foldAscii(d.path)}|${d.size}`;
    const alt = LONG_NAME_ALTERNATIVES[foldAscii(d.path)];
    const altKey = alt === undefined ? undefined : `${alt}|${d.size}`;
    const hit = (remaining.get(key) ?? 0) > 0 ? key : altKey !== undefined && (remaining.get(altKey) ?? 0) > 0 ? altKey : undefined;
    if (hit === undefined) {
      problems.push(`missing deleted entry: ${key}`);
    } else {
      remaining.set(hit, (remaining.get(hit) ?? 0) - 1);
    }
  }
  for (const [k, n] of remaining) if (n > 0) problems.push(`unexpected deleted entry: ${k}`);

  return problems;
}

const dir = resolve(__dirname, '../../fixtures/real-disks/freedos13');
const manifest = parseManifest(JSON.parse(readFileSync(resolve(dir, 'manifest.json'), 'utf8')) as unknown);

describe('parseManifest', () => {
  it('names the first bad field and ignores note fields', () => {
    expect(() => parseManifest({})).toThrow('manifest.images is missing');
    expect(() => parseManifest({ images: [{ file: 'a' }] })).toThrow('images[0].directories is missing');
    expect(manifest.images.length).toBe(3);
  });
});

describe('foldAscii', () => {
  it('folds only A-Z', () => {
    expect(foldAscii('/KERNEL.SYS')).toBe('/kernel.sys');
    expect(foldAscii('É_1')).toBe('É_1');
  });
});

describe.each(manifest.images.map((m) => [m.file, m] as const))('real disk %s', (_name, entry) => {
  const image = new Uint8Array(readFileSync(resolve(dir, entry.file)));

  it('matches the manifest', () => {
    expect(gradeImage(entry, image)).toEqual([]);
  });

  it('negative controls fail', () => {
    const first = entry.files[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    expect(gradeImage({ ...entry, sha256: '0'.repeat(64) }, image)).not.toEqual([]);
    const flipped = image.slice();
    flipped[flipped.length - 1] = (flipped[flipped.length - 1] ?? 0) ^ 1;
    expect(gradeImage(entry, flipped)).not.toEqual([]);
    expect(gradeImage({ ...entry, files: [{ ...first, sha256: '0'.repeat(64) }, ...entry.files.slice(1)] }, image)).not.toEqual([]);
    expect(gradeImage({ ...entry, files: [{ ...first, size: first.size + 1 }, ...entry.files.slice(1)] }, image)).not.toEqual([]);
    expect(gradeImage({ ...entry, files: entry.files.slice(1) }, image)).not.toEqual([]);
    expect(gradeImage({ ...entry, deletedEntries: [...entry.deletedEntries, { path: '/nope.bin', size: 1 }] }, image)).not.toEqual([]);
  });
});

describe('extra negative controls', () => {
  const entry = manifest.images[0];
  const image = entry === undefined ? new Uint8Array(0) : new Uint8Array(readFileSync(resolve(dir, entry.file)));

  it('reports a differing directory set (in-memory copy)', () => {
    if (entry === undefined) throw new Error('manifest has no images');
    expect(gradeImage({ ...entry, directories: [...entry.directories, '/no-such-dir'] }, image)).not.toEqual([]);
    expect(gradeImage({ ...entry, directories: [...entry.directories, '/no-such-dir'] }, image).join('\n')).toContain('missing directory');
  });

  it('reports an expected file that is not on the disk (in-memory copy)', () => {
    if (entry === undefined) throw new Error('manifest has no images');
    const ghost = { path: '/ghost.bin', size: 1, sha256: '0'.repeat(64) };
    const problems = gradeImage({ ...entry, files: [...entry.files, ghost] }, image);
    expect(problems.join('\n')).toContain('missing file: /ghost.bin');
  });
});

describe('fixture handling', () => {
  const expectedImages = ['fd13-1200k-dsk01.img', 'fd13-1440k-boot.img', 'fd13-720k-dsk01.img'];

  it('manifest lists exactly the three fixture images and each exists', () => {
    expect(manifest.images.map((m) => m.file).sort()).toEqual(expectedImages);
    for (const m of manifest.images) expect(statSync(resolve(dir, m.file)).isFile()).toBe(true);
  });

  it('NOTICE.md exists next to the images', () => {
    expect(statSync(resolve(dir, 'NOTICE.md')).isFile()).toBe(true);
  });

  it('no file under public/ carries a fixture name (names only, bounded, no bytes read)', () => {
    const forbidden = new Set([...manifest.images.map((m) => m.file), 'manifest.json', 'NOTICE.md'].map(foldAscii));
    const root = resolve(__dirname, '../../public');
    const MAX_DEPTH = 8;
    const MAX_ENTRIES = 5000;
    let seen = 0;
    const hits: string[] = [];
    const walk = (p: string, depth: number): void => {
      if (depth > MAX_DEPTH) return;
      for (const d of readdirSync(p, { withFileTypes: true })) {
        if (++seen > MAX_ENTRIES) return;
        if (forbidden.has(foldAscii(d.name))) hits.push(resolve(p, d.name));
        if (d.isDirectory()) walk(resolve(p, d.name), depth + 1);
      }
    };
    walk(root, 0);
    expect(seen).toBeLessThanOrEqual(MAX_ENTRIES);
    expect(hits).toEqual([]);
  });
});
