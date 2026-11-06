import fc from 'fast-check';
import { describe, it } from 'vitest';
import { openDisk } from './index';
import { expandContent, fittedTreeArb } from '../../test-support/fat12/arbitraries';
import { capacityOf, standardGeometry, writeFat12Image } from '../../test-support/fat12/index';
import type {
  DosDateTime,
  FileTree,
  StandardGeometryName,
  TreeNode,
} from '../../test-support/fat12/index';
import { numRuns } from '../../test-support/runs';

interface Expected {
  path: string;
  kind: 'file' | 'directory';
  size: number;
  content?: Uint8Array;
  date: string;
  attributes: { readOnly: boolean; hidden: boolean; system: boolean; archive: boolean };
}

const DEFAULT_DATE = '1980-01-01T00:00:00';

function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}

function isoOf(d: DosDateTime | undefined): string {
  if (d === undefined) return DEFAULT_DATE;
  return `${pad(d.year, 4)}-${pad(d.month, 2)}-${pad(d.day, 2)}T${pad(d.hour, 2)}:${pad(d.minute, 2)}:${pad(d.second, 2)}`;
}

/** Depth-first pre-order: a directory, then its contents, then the next sibling. */
function expectedList(nodes: TreeNode[], prefix: string, out: Expected[]): Expected[] {
  for (const node of nodes) {
    const path = `${prefix}/${node.name}`;
    const attributes = {
      readOnly: node.attributes?.readOnly ?? false,
      hidden: node.attributes?.hidden ?? false,
      system: node.attributes?.system ?? false,
      archive: node.attributes?.archive ?? false,
    };
    if (node.kind === 'file') {
      out.push({ path, kind: 'file', size: node.content.length, content: node.content, date: isoOf(node.modified), attributes });
    } else {
      out.push({ path, kind: 'directory', size: 0, date: isoOf(node.modified), attributes });
      expectedList(node.children, path, out);
    }
  }
  return out;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * The writer puts 'NO NAME' in the boot sector label when the tree has none, and the
 * reader reports it as 'NO NAME' (trailing spaces trimmed). Accept exactly that.
 */
function expectedLabel(tree: FileTree): string {
  return tree.volumeLabel ?? 'NO NAME';
}

describe('reader round trip: file tree', () => {
  it('Property 8: reading a written tree returns the same tree', () => {
    // Feature: fat12-core, Property 8: File tree round trip
    // **Validates: Requirements 1.7, 3.10, 6.1, 6.2, 6.4, 6.10, 6.11, 7.1, 7.8, 7.10, 7.11, 8.2, 11.2**
    fc.assert(
      fc.property(fittedTreeArb, ({ tree, geometryName }) => {
        const image = writeFat12Image(tree, geometryName);
        const handle = openDisk(image);
        const { report } = handle;
        const expected = expectedList(tree.children, '', []);

        if (report.files.length !== expected.length) return false;
        if (report.warnings.length !== 0) return false;
        if (report.volume.label !== expectedLabel(tree)) return false;
        if (report.volume.geometrySource !== 'bpb') return false;

        const g = standardGeometry(geometryName);
        const vg = report.volume.geometry;
        if (vg === null) return false;
        if (
          vg.bytesPerSector !== g.bytesPerSector ||
          vg.sectorsPerCluster !== g.sectorsPerCluster ||
          vg.reservedSectors !== g.reservedSectors ||
          vg.fatCount !== g.fatCount ||
          vg.rootEntryCount !== g.rootEntryCount ||
          vg.totalSectors !== g.totalSectors ||
          vg.sectorsPerFat !== g.sectorsPerFat ||
          vg.mediaDescriptor !== g.mediaDescriptor
        ) {
          return false;
        }

        for (let i = 0; i < expected.length; i++) {
          const e = expected[i]!;
          const grave = report.files[i]!;
          if (grave.id !== i) return false;
          if (grave.path !== e.path) return false;
          if (grave.kind !== e.kind) return false;
          if (grave.size !== e.size) return false;
          if (grave.state !== 'alive') return false;
          if (grave.reason !== undefined) return false;
          if (grave.date !== e.date) return false;
          if (
            grave.attributes.readOnly !== e.attributes.readOnly ||
            grave.attributes.hidden !== e.attributes.hidden ||
            grave.attributes.system !== e.attributes.system ||
            grave.attributes.archive !== e.attributes.archive
          ) {
            return false;
          }
          if (e.kind === 'file') {
            const read = handle.readBytes(grave);
            if (!read.ok) return false;
            if (!sameBytes(read.bytes, e.content!)) return false;
          }
        }
        return true;
      }),
      { numRuns: numRuns(100) },
    );
  });
});

// All 8 geometries; smaller ones weighted up so full-capacity runs stay fast.
const weightedGeometryArb = fc.constantFrom<StandardGeometryName>(
  '160K', '160K', '160K', '180K', '180K', '180K', '320K', '320K', '360K', '360K',
  '720K', '720K', '1200K', '1440K', '2880K',
);

const singleFileCaseArb = weightedGeometryArb.chain((geometryName) => {
  const cap = capacityOf(standardGeometry(geometryName));
  const { clusterBytes, dataBytes } = cap;
  const clusters = Math.floor(dataBytes / clusterBytes);
  const clamp = (n: number) => Math.min(dataBytes, Math.max(0, n));
  const boundaryArb = fc
    .tuple(fc.integer({ min: 0, max: clusters }), fc.integer({ min: -1, max: 1 }))
    .map(([k, d]) => clamp(k * clusterBytes + d));
  const lengthArb = fc.oneof(
    { weight: 3, arbitrary: boundaryArb },
    { weight: 2, arbitrary: fc.constantFrom(dataBytes, dataBytes - 1, 0, 1) },
    { weight: 2, arbitrary: fc.integer({ min: 0, max: dataBytes }) },
  );
  return fc.record({
    geometryName: fc.constant(geometryName),
    length: lengthArb,
    seed: fc.integer({ min: 0, max: 0xffffffff }),
  });
});

describe('reader round trip: single file content', () => {
  it('Property 9: single file content round trip up to capacity', () => {
    // Feature: fat12-core, Property 9: Single file content round trip up to capacity
    // **Validates: Requirements 5.11**
    fc.assert(
      fc.property(singleFileCaseArb, ({ geometryName, length, seed }) => {
        const content = expandContent(seed, length);
        const tree: FileTree = {
          children: [{ kind: 'file', name: 'DATA.BIN', content }],
        };
        const image = writeFat12Image(tree, geometryName);
        const handle = openDisk(image);
        const { report } = handle;

        if (report.warnings.length !== 0) return false;
        if (report.files.length !== 1) return false;
        const grave = report.files[0]!;
        if (grave.kind !== 'file' || grave.state !== 'alive') return false;
        if (grave.size !== length) return false;

        const read = handle.readBytes(grave);
        if (!read.ok) return false;
        if (read.warnings !== undefined && read.warnings.length !== 0) return false;
        return sameBytes(read.bytes, content);
      }),
      { numRuns: numRuns(100) },
    );
  });
});

/** Marks files deleted by a running file index into `mask` (wrapping); directories stay live. */
function markDeleted(nodes: TreeNode[], mask: boolean[], counter: { n: number }): TreeNode[] {
  return nodes.map((node): TreeNode => {
    if (node.kind === 'file') {
      const del = mask.length > 0 && mask[counter.n % mask.length] === true;
      counter.n++;
      return del ? { ...node, deleted: true } : node;
    }
    return { ...node, children: markDeleted(node.children, mask, counter) };
  });
}

interface UndeleteExpected extends Expected {
  deleted: boolean;
}

function undeleteExpectedList(nodes: TreeNode[], prefix: string, out: UndeleteExpected[]): UndeleteExpected[] {
  for (const node of nodes) {
    if (node.kind === 'file') {
      const del = node.deleted === true;
      const name = del ? `_${node.name.slice(1)}` : node.name;
      out.push({
        path: `${prefix}/${name}`,
        kind: 'file',
        size: node.content.length,
        content: node.content,
        date: '',
        attributes: { readOnly: false, hidden: false, system: false, archive: false },
        deleted: del,
      });
    } else {
      out.push({
        path: `${prefix}/${node.name}`,
        kind: 'directory',
        size: 0,
        date: '',
        attributes: { readOnly: false, hidden: false, system: false, archive: false },
        deleted: false,
      });
      undeleteExpectedList(node.children, `${prefix}/${node.name}`, out);
    }
  }
  return out;
}

describe('reader round trip: undelete', () => {
  it('Property 13: Undelete restores contiguous deleted files', () => {
    // Feature: fat12-core, Property 13: Undelete restores contiguous deleted files
    // **Validates: Requirements 8.1, 8.14, 9.5**
    fc.assert(
      fc.property(
        fittedTreeArb,
        fc.array(fc.boolean(), { minLength: 1, maxLength: 32 }),
        ({ tree, geometryName }, mask) => {
          const marked: FileTree = {
            ...tree,
            children: markDeleted(tree.children, mask, { n: 0 }),
          };
          const image = writeFat12Image(marked, geometryName);
          const handle = openDisk(image);
          const { report } = handle;
          const expected = undeleteExpectedList(marked.children, '', []);

          if (report.files.length !== expected.length) return false;

          for (let i = 0; i < expected.length; i++) {
            const e = expected[i]!;
            const grave = report.files[i]!;
            if (grave.path !== e.path) return false;
            if (grave.kind !== e.kind) return false;
            if (grave.size !== e.size) return false;
            if (e.deleted) {
              if (grave.state !== 'recovered') return false;
              if (grave.reason === undefined || grave.reason.length === 0) return false;
            } else if (grave.state !== 'alive') {
              return false;
            }
            if (e.kind === 'file') {
              const read = handle.readBytes(grave);
              if (!read.ok) return false;
              if (!sameBytes(read.bytes, e.content!)) return false;
            }
          }
          return true;
        },
      ),
      { numRuns: numRuns(100) },
    );
  });
});
