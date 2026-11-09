// Capacity and size measurement for the test-only FAT12 image writer.
// No imports from src/core, vitest, fast-check or Node.

import { LFN_UNITS_PER_RECORD, isValidShortName } from './encode';
import type {
  Capacity,
  FileTree,
  Geometry,
  Measure,
  StandardGeometryName,
  TreeNode,
} from './types';

type Row = [
  sectorsPerCluster: number,
  rootEntryCount: number,
  totalSectors: number,
  sectorsPerFat: number,
  mediaDescriptor: number,
];

// Independent literal table of the eight standard floppy formats.
const TABLE: Record<StandardGeometryName, Row> = {
  '160K': [1, 64, 320, 1, 0xfe],
  '180K': [1, 64, 360, 2, 0xfc],
  '320K': [2, 112, 640, 1, 0xff],
  '360K': [2, 112, 720, 2, 0xfd],
  '720K': [2, 112, 1440, 3, 0xf9],
  '1200K': [1, 224, 2400, 7, 0xf9],
  '1440K': [1, 224, 2880, 9, 0xf0],
  '2880K': [2, 240, 5760, 9, 0xf0],
};

/** Smallest to largest. */
export const STANDARD_GEOMETRY_NAMES: readonly StandardGeometryName[] = [
  '160K',
  '180K',
  '320K',
  '360K',
  '720K',
  '1200K',
  '1440K',
  '2880K',
];

export function standardGeometry(name: StandardGeometryName): Geometry {
  const [sectorsPerCluster, rootEntryCount, totalSectors, sectorsPerFat, mediaDescriptor] =
    TABLE[name];
  return {
    bytesPerSector: 512,
    sectorsPerCluster,
    reservedSectors: 1,
    fatCount: 2,
    rootEntryCount,
    totalSectors,
    sectorsPerFat,
    mediaDescriptor,
  };
}

export function capacityOf(g: Geometry): Capacity {
  const rootSectors = Math.ceil((g.rootEntryCount * 32) / g.bytesPerSector);
  const dataStart = g.reservedSectors + g.fatCount * g.sectorsPerFat + rootSectors;
  const dataClusters = Math.max(0, Math.floor((g.totalSectors - dataStart) / g.sectorsPerCluster));
  const clusterBytes = g.bytesPerSector * g.sectorsPerCluster;
  return {
    rootEntries: g.rootEntryCount,
    dataClusters,
    clusterBytes,
    dataBytes: dataClusters * clusterBytes,
  };
}

function lfnRecordCount(node: TreeNode): number {
  if (node.longName === undefined) return 0;
  return Math.ceil(node.longName.length / LFN_UNITS_PER_RECORD);
}

/**
 * Count the records and clusters `tree` needs on `geometry`.
 * Deleted nodes keep their entry and (unless they carry `placement`) their clusters.
 */
export function measureTree(tree: FileTree, geometry: Geometry): Measure {
  const clusterBytes = geometry.bytesPerSector * geometry.sectorsPerCluster;
  const nameProblems: string[] = [];
  let clusters = 0;
  let fileCount = 0;
  let maxDepth = 0;

  const entriesOf = (nodes: TreeNode[], slots?: readonly unknown[]): number =>
    nodes.reduce((sum, n) => sum + 1 + lfnRecordCount(n), 0) + (slots?.length ?? 0);

  const walk = (nodes: TreeNode[], path: string, depth: number, live: boolean): void => {
    const seen = new Set<string>();
    for (const node of nodes) {
      const full = `${path}/${node.name}`;
      if (!isValidShortName(node.name)) nameProblems.push(`invalid 8.3 name: ${full}`);
      else if (seen.has(node.name)) nameProblems.push(`duplicate name: ${full}`);
      seen.add(node.name);
      if (node.longName !== undefined && (node.longName.length < 1 || node.longName.length > 255)) {
        nameProblems.push(`bad long name length: ${full}`);
      }
      const isLive = live && node.deleted !== true;
      const takesClusters = node.placement === undefined;
      if (node.kind === 'file') {
        if (isLive) fileCount++;
        if (takesClusters) clusters += Math.ceil(node.content.length / clusterBytes);
      } else {
        maxDepth = Math.max(maxDepth, depth + 1);
        if (takesClusters) {
          const records = 2 + entriesOf(node.children, node.slots);
          clusters += Math.max(1, Math.ceil((records * 32) / clusterBytes));
        }
        walk(node.children, full, depth + 1, isLive);
      }
    }
  };
  walk(tree.children, '', 0, true);

  const labelEntry = tree.volumeLabel === undefined ? 0 : 1;
  return {
    rootEntries: labelEntry + entriesOf(tree.children, tree.slots),
    clusters,
    fileCount,
    maxDepth,
    nameProblems,
  };
}

function fits(tree: FileTree, geometry: Geometry): boolean {
  const m = measureTree(tree, geometry);
  const c = capacityOf(geometry);
  return m.rootEntries <= c.rootEntries && m.clusters <= c.dataClusters;
}

/** Smallest standard geometry the tree fits, or undefined. */
export function pickGeometry(tree: FileTree): StandardGeometryName | undefined {
  return STANDARD_GEOMETRY_NAMES.find((name) => fits(tree, standardGeometry(name)));
}

function halve(nodes: TreeNode[]): TreeNode[] {
  return nodes.map((n) =>
    n.kind === 'file'
      ? { ...n, content: n.content.slice(0, Math.floor(n.content.length / 2)) }
      : { ...n, children: halve(n.children) },
  );
}

/**
 * Return a tree that fits 2880K, halving every file size (rounding down,
 * content truncated) until it does. Sizes reach 0 within 32 rounds. When the
 * entry count alone exceeds the root or cluster limits, the best attempt (all
 * files empty) is returned and still does not fit; callers keep entry counts
 * within limits.
 */
export function fitTree(tree: FileTree): FileTree {
  const target = standardGeometry('2880K');
  let current = tree;
  for (let i = 0; i < 32 && !fits(current, target); i++) {
    current = { ...current, children: halve(current.children) };
  }
  return current;
}
