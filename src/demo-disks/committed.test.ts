import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MAX_IMAGE_BYTES } from '../core/fat12/index';
import { DEMO_REGISTRY } from '../web/demos';
import { buildAllDemoDisks, runSharedChecks } from './index';
import type { FreshDisk } from './index';

// Committed_Image tests (Requirements 3.7, 4.7, 9.7, 10.7, 10.10, 10.11, 10.12).
// These only READ public/. They are expected to fail until the user has run
// `npm run make:demos` and committed the images. Nothing is written anywhere.

/** Reads a path relative to `public/`; returns undefined when the file is absent. */
export type PublicReader = (relativePath: string) => Uint8Array | undefined;

const publicReader: PublicReader = (relativePath) => {
  try {
    return new Uint8Array(readFileSync(new URL(`../../public/${relativePath}`, import.meta.url)));
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined;
    throw error;
  }
};

/** The failure text for a missing or differing Committed_Image. */
export function committedMessage(file: string): string {
  return `Committed image public/disks/${file} is missing or differs from the generated one. Run \`npm run make:demos\` and commit the result.`;
}

/**
 * Returns the committed bytes of a disk, or throws the fixed message when the file is absent.
 * The reader is injected so the logic can be tested without the real folder.
 */
export function committedBytes(read: PublicReader, file: string): Uint8Array {
  const bytes = read(`disks/${file}`);
  if (bytes === undefined) throw new Error(committedMessage(file));
  return bytes;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

describe('committed image message builder (in memory)', () => {
  it('returns the bytes the injected reader supplies', () => {
    const bytes = new Uint8Array([1, 2, 3]);
    let asked = '';
    const read: PublicReader = (path) => {
      asked = path;
      return bytes;
    };
    expect(committedBytes(read, 'x.img')).toBe(bytes);
    expect(asked).toBe('disks/x.img');
  });

  it('throws the fixed message naming the file when the reader finds nothing', () => {
    expect(() => committedBytes(() => undefined, 'writers-disk.img')).toThrow(
      'Committed image public/disks/writers-disk.img is missing or differs from the generated one. Run `npm run make:demos` and commit the result.',
    );
  });

  it('compares bytes by value', () => {
    expect(sameBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(sameBytes(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(sameBytes(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
  });
});

// Built once, in memory. Never written.
const fresh: FreshDisk[] = buildAllDemoDisks();

describe('Committed_Images in public/disks/ (fail until the user generates them)', () => {
  for (const disk of fresh) {
    const file = disk.spec.fileName;

    it(`${file} equals the generated image`, () => {
      const committed = committedBytes(publicReader, file);
      expect(sameBytes(committed, disk.image), committedMessage(file)).toBe(true);
    });

    it(`${file} has the generated length and fits the Reader limit`, () => {
      const committed = committedBytes(publicReader, file);
      expect(committed.length).toBe(disk.image.length);
      expect(committed.length).toBeLessThanOrEqual(MAX_IMAGE_BYTES);
    });

    it(`${file} passes the Shared_Checks`, () => {
      const committed = committedBytes(publicReader, file);
      expect(runSharedChecks(disk.spec.id, committed)).toEqual([]);
    });
  }
});

describe('DEMO_REGISTRY urls resolve to committed files', () => {
  for (const entry of DEMO_REGISTRY) {
    it(`${entry.url} exists under public/ with the generated length`, () => {
      const disk = fresh.find((d) => d.spec.id === entry.id);
      expect(disk, `no generated disk for ${entry.id}`).toBeDefined();
      if (disk === undefined) return;
      const bytes = publicReader(entry.url.replace(/^\//, ''));
      if (bytes === undefined) throw new Error(committedMessage(disk.spec.fileName));
      expect(bytes.length).toBe(disk.image.length);
      expect(bytes.length).toBeLessThanOrEqual(MAX_IMAGE_BYTES);
    });
  }
});
