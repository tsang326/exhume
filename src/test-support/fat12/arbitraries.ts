// fast-check arbitraries for FAT12 file trees (test-only).
// NOT exported from ./index.ts. No vitest or src/core imports.
//
// Trees are generated inside the ranges of Requirement 11.2 (0..64 files,
// at most 32 directories, nesting 0..4, sizes 0..65,536) and then passed
// through `toFitted`, which picks a standard geometry and shrinks file sizes
// when needed. Round-trip comparisons MUST be made against the fitted tree
// (`FittedTree.tree`), not the raw generated one.

import * as fc from 'fast-check';

import { fitTree, pickGeometry, standardGeometry } from './index';
import type {
  DirNode,
  DosDateTime,
  FileNode,
  FileTree,
  Geometry,
  StandardGeometryName,
  TreeNode,
} from './index';
import type { WriterAttributes } from './types';

const NAME_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!#$%&'()-@^_`{}~".split('');
const MAX_FILES = 64;
const MAX_DIRS = 32;
const MAX_DIR_DEPTH = 4;
export const MAX_FILE_SIZE = 65_536;

const nameCharArb = fc.constantFrom(...NAME_CHARS);

/** Valid 8.3 name: base 1..8 chars, optional extension 1..3 chars. */
export const shortNameArb: fc.Arbitrary<string> = fc
  .tuple(
    fc.array(nameCharArb, { minLength: 1, maxLength: 8 }),
    fc.option(fc.array(nameCharArb, { minLength: 1, maxLength: 3 }), { nil: undefined }),
  )
  .map(([base, ext]) => (ext === undefined ? base.join('') : `${base.join('')}.${ext.join('')}`));

/** Valid DOS date-time: years 1980..2107, even seconds (the writer would round odd ones down). */
export const dosDateTimeArb: fc.Arbitrary<DosDateTime> = fc.record({
  year: fc.integer({ min: 1980, max: 2107 }),
  month: fc.integer({ min: 1, max: 12 }),
  day: fc.integer({ min: 1, max: 28 }),
  hour: fc.integer({ min: 0, max: 23 }),
  minute: fc.integer({ min: 0, max: 59 }),
  second: fc.integer({ min: 0, max: 29 }).map((s) => s * 2),
});

/** Fully specified attribute flags. */
export const attributesArb: fc.Arbitrary<WriterAttributes> = fc.record({
  readOnly: fc.boolean(),
  hidden: fc.boolean(),
  system: fc.boolean(),
  archive: fc.boolean(),
});

/** Volume label: 1..11 chars from the 8.3 set, no spaces (so no leading or trailing space). */
export const volumeLabelArb: fc.Arbitrary<string> = fc
  .array(nameCharArb, { minLength: 1, maxLength: 11 })
  .map((chars) => chars.join(''));

/** Deterministic mulberry32 expansion of (seed, length) into bytes. */
export function expandContent(seed: number, length: number): Uint8Array {
  const out = new Uint8Array(length);
  let a = seed >>> 0;
  for (let i = 0; i < length; i++) {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    out[i] = ((t ^ (t >>> 14)) >>> 0) & 0xff;
  }
  return out;
}

export interface ContentSpec {
  seed: number;
  length: number;
}

/** Seed and length pair; shrinks toward seed 0 and length 0. Most files are small. */
export const contentArb: fc.Arbitrary<ContentSpec> = fc.record({
  seed: fc.integer({ min: 0, max: 0xffffffff }),
  length: fc.oneof(
    { weight: 3, arbitrary: fc.integer({ min: 0, max: 1200 }) },
    { weight: 1, arbitrary: fc.integer({ min: 0, max: MAX_FILE_SIZE }) },
  ),
});

interface NodeExtras {
  modified: DosDateTime | undefined;
  attributes: WriterAttributes | undefined;
}

const extrasArb: fc.Arbitrary<NodeExtras> = fc.record({
  modified: fc.option(dosDateTimeArb, { nil: undefined }),
  attributes: fc.option(attributesArb, { nil: undefined }),
});

interface DirSpec {
  parentSel: number;
  extras: NodeExtras;
}
interface FileSpec {
  parentSel: number;
  content: ContentSpec;
  extras: NodeExtras;
}

const selArb = fc.nat({ max: 1000 });
const dirSpecArb: fc.Arbitrary<DirSpec> = fc.record({ parentSel: selArb, extras: extrasArb });
const fileSpecArb: fc.Arbitrary<FileSpec> = fc.record({
  parentSel: selArb,
  content: contentArb,
  extras: extrasArb,
});

function withExtras<T extends TreeNode>(node: T, extras: NodeExtras): T {
  if (extras.modified !== undefined) node.modified = extras.modified;
  if (extras.attributes !== undefined) node.attributes = extras.attributes;
  return node;
}

function build(
  dirs: DirSpec[],
  files: FileSpec[],
  names: string[],
  volumeLabel: string | undefined,
): FileTree {
  const root: TreeNode[] = [];
  // Container list per directory, plus its nesting level (root-level dir = 1).
  const dirNodes: { node: DirNode; depth: number }[] = [];
  let n = 0;
  for (const spec of dirs) {
    const candidates = [-1, ...dirNodes.flatMap((d, i) => (d.depth < MAX_DIR_DEPTH ? [i] : []))];
    const parent = candidates[spec.parentSel % candidates.length] as number;
    const node = withExtras<DirNode>(
      { kind: 'directory', name: names[n++] as string, children: [] },
      spec.extras,
    );
    (parent === -1 ? root : (dirNodes[parent] as { node: DirNode }).node.children).push(node);
    dirNodes.push({ node, depth: parent === -1 ? 1 : (dirNodes[parent] as { depth: number }).depth + 1 });
  }
  for (const spec of files) {
    const slot = spec.parentSel % (dirNodes.length + 1);
    const node = withExtras<FileNode>(
      {
        kind: 'file',
        name: names[n++] as string,
        content: expandContent(spec.content.seed, spec.content.length),
      },
      spec.extras,
    );
    (slot === dirNodes.length ? root : (dirNodes[slot] as { node: DirNode }).node.children).push(node);
  }
  const tree: FileTree = { children: root };
  if (volumeLabel !== undefined) tree.volumeLabel = volumeLabel;
  return tree;
}

/**
 * Raw file tree: 0..64 files, 0..32 directories, nesting 0..4, unique valid
 * 8.3 names (drawn from one globally unique pool, so unique per directory),
 * optional label. May be too large for any geometry: use `fittedTreeArb`.
 */
export const fileTreeArb: fc.Arbitrary<FileTree> = fc
  .tuple(
    fc.array(dirSpecArb, { maxLength: MAX_DIRS }),
    fc.array(fileSpecArb, { maxLength: MAX_FILES }),
    fc.option(volumeLabelArb, { nil: undefined }),
  )
  .chain(([dirs, files, label]) =>
    fc
      .uniqueArray(shortNameArb, {
        minLength: dirs.length + files.length,
        maxLength: dirs.length + files.length,
        selector: (s) => s.toUpperCase(),
      })
      .map((names) => build(dirs, files, names, label)),
  );

export interface FittedTree {
  /** The tree actually written; compare read-back results against this one. */
  tree: FileTree;
  geometryName: StandardGeometryName;
  geometry: Geometry;
}

/** Shrinks file sizes if needed and picks the smallest geometry. Never throws for `fileTreeArb` output. */
export function toFitted(raw: FileTree): FittedTree {
  const tree = fitTree(raw);
  const geometryName = pickGeometry(tree);
  if (geometryName === undefined) throw new Error('arbitraries: tree does not fit any geometry');
  return { tree, geometryName, geometry: standardGeometry(geometryName) };
}

/** File tree already fitted to a standard geometry, safe to give to the writer. */
export const fittedTreeArb: fc.Arbitrary<FittedTree> = fileTreeArb.map(toFitted);
