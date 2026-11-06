import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FitError,
  standardGeometry,
  writeFat12Image,
  writeFat12ImageWithLayout,
} from './index';
import type { FileTree } from './index';

const tree: FileTree = {
  children: [{ kind: 'file', name: 'A.TXT', content: new Uint8Array(700).fill(9) }],
};

describe('writeFat12Image', () => {
  it('accepts a geometry by name and by object, with identical output', () => {
    const byName = writeFat12Image(tree, '1440K');
    const byObject = writeFat12Image(tree, standardGeometry('1440K'));
    expect(byName.length).toBe(1440 * 1024);
    expect(byObject).toEqual(byName);
  });

  it('applies damage from options', () => {
    const clean = writeFat12Image(tree, '1440K');
    const damaged = writeFat12Image(tree, '1440K', {
      damage: [{ type: 'invalid-bpb', field: 'bytesPerSector' }],
    });
    expect(damaged).not.toEqual(clean);
    expect(damaged.length).toBe(clean.length);
  });

  it('honours the serial option', () => {
    expect(writeFat12Image(tree, '1440K', { serial: 1 })).not.toEqual(
      writeFat12Image(tree, '1440K', { serial: 2 }),
    );
  });

  it('throws FitError and returns no image when the tree does not fit', () => {
    const big: FileTree = {
      children: [{ kind: 'file', name: 'BIG.BIN', content: new Uint8Array(200 * 1024) }],
    };
    let image: Uint8Array | undefined;
    expect(() => {
      image = writeFat12Image(big, '160K');
    }).toThrow(FitError);
    expect(image).toBeUndefined();
  });

  it('is deterministic', () => {
    expect(writeFat12Image(tree, '720K')).toEqual(writeFat12Image(tree, '720K'));
  });

  it('exposes node info through the layout variant', () => {
    const result = writeFat12ImageWithLayout(tree, '1440K');
    expect(result.image.length).toBe(1440 * 1024);
  });
});

describe('writer isolation', () => {
  it('has no test-runner, Node or core imports in its source files', () => {
    const files = ['index', 'types', 'errors', 'encode', 'measure', 'layout', 'damage'];
    for (const f of files) {
      const src = readFileSync(new URL(`./${f}.ts`, import.meta.url), 'utf8');
      expect(src, f).not.toContain("from 'vitest'");
      expect(src, f).not.toContain("from 'fast-check'");
      expect(src, f).not.toContain("from 'node:");
      expect(src, f).not.toContain("from '../../core");
    }
  });
});
