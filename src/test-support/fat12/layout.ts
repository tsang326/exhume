// Deterministic layout and byte writer for the test-only FAT12 image writer.
// No imports from src/core, vitest, fast-check or Node. No clock, no randomness.

import {
  DELETED_MARK,
  buildLfnRecords,
  encodeDosDate,
  encodeDosTime,
  encodeShortName,
  lfnChecksum,
  LFN_UNITS_PER_RECORD,
  writeFatEntry,
} from './encode';
import { FitError } from './errors';
import { capacityOf, measureTree } from './measure';
import type { DirNode, DosDateTime, FileTree, Geometry, TreeNode } from './types';

const DEFAULT_DATE: DosDateTime = {
  year: 1980,
  month: 1,
  day: 1,
  hour: 0,
  minute: 0,
  second: 0,
};
const DEFAULT_SERIAL = 0x4558484d; // constant; no clock or random values
const ENTRY_BYTES = 32;
const FIRST_DATA_CLUSTER = 2;
const END_OF_CHAIN = 0xfff;

export interface LayoutOptions {
  /** Volume serial number; a fixed constant when omitted. */
  serial?: number;
}

/** Where one tree node ended up. Paths look like '/DIR/FILE.TXT' (root children: '/NAME'). */
export interface NodeInfo {
  path: string;
  /** Path of the containing directory; '' for children of the root. */
  parentPath: string;
  kind: 'file' | 'directory';
  /** The node's own `deleted` flag. */
  deleted: boolean;
  /** True when the node carried `placement` (its clusters were not allocated). */
  placed: boolean;
  /** Value written in the entry's start-cluster field (0 for an empty file). */
  startCluster: number;
  /** Clusters of the node's contiguous chain, in order (empty for an empty file). */
  clusters: number[];
  /** Declared size (0 for directories). */
  size: number;
  /** Absolute byte offset of the node's 8.3 directory entry. */
  entryOffset: number;
  /** Absolute offsets of its long-name records, in on-disk order (empty if none). */
  lfnOffsets: number[];
  /** Directories only: offsets of the '.' and '..' entries. */
  dotOffset?: number;
  dotDotOffset?: number;
}

export interface ImageOffsets {
  fatStart: number;
  fatBytes: number;
  fatCount: number;
  rootStart: number;
  rootBytes: number;
  dataStart: number;
  clusterBytes: number;
  dataClusters: number;
}

export interface LayoutResult {
  image: Uint8Array;
  geometry: Geometry;
  offsets: ImageOffsets;
  /** Offset of the volume-label root entry, when the tree has a label. */
  labelEntryOffset?: number;
  /** Every node by path. */
  nodes: Map<string, NodeInfo>;
  /** Paths in allocation (depth-first pre-order) order. */
  order: string[];
}

interface Plan {
  node: TreeNode;
  info: NodeInfo;
  children: Plan[];
}

function attributeByte(node: TreeNode): number {
  const a = node.attributes ?? {};
  return (
    (node.kind === 'directory' ? 0x10 : 0) |
    (a.readOnly === true ? 0x01 : 0) |
    (a.hidden === true ? 0x02 : 0) |
    (a.system === true ? 0x04 : 0) |
    (a.archive === true ? 0x20 : 0)
  );
}

function setU16(b: Uint8Array, o: number, v: number): void {
  b[o] = v & 0xff;
  b[o + 1] = (v >> 8) & 0xff;
}

function setU32(b: Uint8Array, o: number, v: number): void {
  setU16(b, o, v & 0xffff);
  setU16(b, o + 2, Math.floor(v / 0x10000) & 0xffff);
}

function lfnCount(node: TreeNode): number {
  return node.longName === undefined ? 0 : Math.ceil(node.longName.length / LFN_UNITS_PER_RECORD);
}

/**
 * Build the complete image for `tree` on `geometry`.
 * All fit checks run before any byte is written; throws FitError.
 */
export function layoutImage(
  tree: FileTree,
  geometry: Geometry,
  options: LayoutOptions = {},
): LayoutResult {
  // ---- Fit checks (no bytes written yet) --------------------------------
  const measure = measureTree(tree, geometry);
  const cap = capacityOf(geometry);
  if (measure.nameProblems.length > 0) {
    throw new FitError(
      'file-name-format',
      0,
      measure.nameProblems.length,
      measure.nameProblems[0],
    );
  }
  if (tree.volumeLabel !== undefined && tree.volumeLabel.length > 11) {
    throw new FitError('file-name-format', 11, tree.volumeLabel.length, 'volume label length');
  }
  if (measure.rootEntries > cap.rootEntries) {
    throw new FitError('root-entry-count', cap.rootEntries, measure.rootEntries);
  }
  if (measure.clusters > cap.dataClusters) {
    throw new FitError('data-cluster-count', cap.dataClusters, measure.clusters);
  }

  const bps = geometry.bytesPerSector;
  const clusterBytes = cap.clusterBytes;
  const fatBytes = geometry.sectorsPerFat * bps;
  const fatStart = geometry.reservedSectors * bps;
  const rootStart = fatStart + geometry.fatCount * fatBytes;
  const rootBytes = Math.ceil((geometry.rootEntryCount * ENTRY_BYTES) / bps) * bps;
  const dataStart = rootStart + rootBytes;
  const image = new Uint8Array(geometry.totalSectors * bps);

  // ---- Plan: iterative depth-first pre-order allocation ------------------
  const nodes = new Map<string, NodeInfo>();
  const order: string[] = [];
  const rootChildren: Plan[] = [];
  const all: Plan[] = [];
  let nextCluster = FIRST_DATA_CLUSTER;

  interface Item {
    node: TreeNode;
    path: string;
    parentPath: string;
    siblings: Plan[];
  }
  const stack: Item[] = [];
  const pushChildren = (list: TreeNode[], parentPath: string, siblings: Plan[]): void => {
    for (let i = list.length - 1; i >= 0; i--) {
      const node = list[i] as TreeNode;
      stack.push({ node, path: `${parentPath}/${node.name}`, parentPath, siblings });
    }
  };
  pushChildren(tree.children, '', rootChildren);

  // siblings arrays receive plans in listed order because pops are in listed order.
  while (stack.length > 0) {
    const item = stack.pop() as Item;
    const { node } = item;
    let need: number;
    if (node.kind === 'file') {
      need = Math.ceil(node.content.length / clusterBytes);
    } else {
      const records = 2 + node.children.reduce((s, c) => s + 1 + lfnCount(c), 0);
      need = Math.max(1, Math.ceil((records * ENTRY_BYTES) / clusterBytes));
    }
    const placed = node.placement !== undefined;
    let first = 0;
    const clusters: number[] = [];
    if (placed) {
      first = (node.placement as { startCluster: number }).startCluster;
      if (!Number.isInteger(first) || first < FIRST_DATA_CLUSTER) {
        throw new RangeError(`bad placement startCluster ${first} for ${item.path}`);
      }
    } else {
      first = nextCluster;
      nextCluster += need;
    }
    for (let i = 0; i < need; i++) clusters.push(first + i);

    const info: NodeInfo = {
      path: item.path,
      parentPath: item.parentPath,
      kind: node.kind,
      deleted: node.deleted === true,
      placed,
      startCluster: need === 0 ? 0 : first,
      clusters,
      size: node.kind === 'file' ? node.content.length : 0,
      entryOffset: -1,
      lfnOffsets: [],
    };
    const plan: Plan = { node, info, children: [] };
    item.siblings.push(plan);
    all.push(plan);
    nodes.set(info.path, info);
    order.push(info.path);
    if (node.kind === 'directory') pushChildren(node.children, item.path, plan.children);
  }

  // ---- Boot sector -------------------------------------------------------
  image[0] = 0xeb;
  image[1] = 0x3c;
  image[2] = 0x90;
  for (let i = 0; i < 8; i++) image[3 + i] = 'EXHUME  '.charCodeAt(i);
  setU16(image, 0x0b, bps);
  image[0x0d] = geometry.sectorsPerCluster;
  setU16(image, 0x0e, geometry.reservedSectors);
  image[0x10] = geometry.fatCount;
  setU16(image, 0x11, geometry.rootEntryCount);
  setU16(image, 0x13, geometry.totalSectors < 0x10000 ? geometry.totalSectors : 0);
  image[0x15] = geometry.mediaDescriptor;
  setU16(image, 0x16, geometry.sectorsPerFat);
  setU16(image, 0x18, 18); // sectors per track
  setU16(image, 0x1a, 2); // heads
  setU32(image, 0x1c, 0); // hidden sectors
  setU32(image, 0x20, geometry.totalSectors < 0x10000 ? 0 : geometry.totalSectors);
  image[0x24] = 0x00; // drive number
  image[0x26] = 0x29; // extended boot signature
  setU32(image, 0x27, options.serial ?? DEFAULT_SERIAL);
  const label = (tree.volumeLabel ?? 'NO NAME').padEnd(11, ' ');
  for (let i = 0; i < 11; i++) image[43 + i] = label.charCodeAt(i) & 0xff;
  for (let i = 0; i < 8; i++) image[54 + i] = 'FAT12   '.charCodeAt(i);
  image[510] = 0x55;
  image[511] = 0xaa;

  // ---- Helpers over the image -------------------------------------------
  const put = (offset: number, bytes: Uint8Array): void => {
    // Placed data may reach past the image end; clip instead of growing.
    if (offset < 0 || offset >= image.length) return;
    image.set(bytes.subarray(0, Math.min(bytes.length, image.length - offset)), offset);
  };
  const clusterOffset = (cluster: number): number =>
    dataStart + (cluster - FIRST_DATA_CLUSTER) * clusterBytes;

  const encodeEntry = (
    name11: Uint8Array,
    node: TreeNode,
    startCluster: number,
    size: number,
    deleted: boolean,
  ): Uint8Array => {
    const e = new Uint8Array(ENTRY_BYTES);
    e.set(name11, 0);
    if (deleted) e[0] = DELETED_MARK;
    e[11] = attributeByte(node);
    const when = node.modified ?? DEFAULT_DATE;
    setU16(e, 22, encodeDosTime(when));
    setU16(e, 24, encodeDosDate(when));
    setU16(e, 26, startCluster);
    setU32(e, 28, size);
    return e;
  };

  let labelEntryOffset: number | undefined;

  /** Write the records of one directory (root when `dir` is undefined). */
  const writeDirectory = (dir: Plan | undefined): void => {
    const children = dir === undefined ? rootChildren : dir.children;
    const recordAt = (i: number): number =>
      dir === undefined
        ? rootStart + i * ENTRY_BYTES
        : clusterOffset(dir.info.startCluster) + i * ENTRY_BYTES;
    let index = 0;
    if (dir === undefined) {
      if (tree.volumeLabel !== undefined) {
        const e = new Uint8Array(ENTRY_BYTES);
        const padded = tree.volumeLabel.padEnd(11, ' ');
        for (let i = 0; i < 11; i++) e[i] = padded.charCodeAt(i) & 0xff;
        e[11] = 0x08;
        labelEntryOffset = recordAt(index++);
        put(labelEntryOffset, e);
      }
    } else {
      const dirNode = dir.node as DirNode;
      const parentStart = parentStartOf(dir.info.parentPath);
      const dot = encodeEntry(new Uint8Array(11).fill(0x20), dirNode, dir.info.startCluster, 0, false);
      dot[0] = 0x2e;
      const dotdot = encodeEntry(new Uint8Array(11).fill(0x20), dirNode, parentStart, 0, false);
      dotdot[0] = 0x2e;
      dotdot[1] = 0x2e;
      dir.info.dotOffset = recordAt(index++);
      dir.info.dotDotOffset = recordAt(index++);
      put(dir.info.dotOffset, dot);
      put(dir.info.dotDotOffset, dotdot);
    }
    for (const child of children) {
      const name11 = encodeShortName(child.node.name);
      const isDeleted = child.info.deleted;
      if (child.node.longName !== undefined) {
        const recs = buildLfnRecords(child.node.longName, lfnChecksum(name11));
        for (const rec of recs) {
          if (isDeleted) rec[0] = DELETED_MARK;
          const off = recordAt(index++);
          child.info.lfnOffsets.push(off);
          put(off, rec);
        }
      }
      child.info.entryOffset = recordAt(index++);
      put(
        child.info.entryOffset,
        encodeEntry(name11, child.node, child.info.startCluster, child.info.size, isDeleted),
      );
    }
  };

  const parentStartOf = (parentPath: string): number =>
    parentPath === '' ? 0 : (nodes.get(parentPath) as NodeInfo).startCluster;

  // ---- Data and directory records: placed (deleted) nodes first ----------
  const writeNode = (plan: Plan): void => {
    if (plan.node.kind === 'file') {
      if (plan.info.clusters.length > 0) put(clusterOffset(plan.info.startCluster), plan.node.content);
    } else {
      writeDirectory(plan);
    }
  };
  for (const plan of all) if (plan.info.placed) writeNode(plan);
  writeDirectory(undefined);
  for (const plan of all) if (!plan.info.placed) writeNode(plan);

  // ---- FAT ---------------------------------------------------------------
  const fat = new Uint8Array(fatBytes);
  writeFatEntry(fat, 0, 0xf00 | geometry.mediaDescriptor);
  writeFatEntry(fat, 1, END_OF_CHAIN);
  for (const plan of all) {
    // Deleted nodes: entries stay 0x000. Placed nodes never touch the FAT.
    if (plan.info.deleted || plan.info.placed) continue;
    const cl = plan.info.clusters;
    for (let i = 0; i < cl.length; i++) {
      writeFatEntry(fat, cl[i] as number, i === cl.length - 1 ? END_OF_CHAIN : (cl[i + 1] as number));
    }
  }
  for (let c = 0; c < geometry.fatCount; c++) image.set(fat, fatStart + c * fatBytes);

  const result: LayoutResult = {
    image,
    geometry,
    offsets: {
      fatStart,
      fatBytes,
      fatCount: geometry.fatCount,
      rootStart,
      rootBytes,
      dataStart,
      clusterBytes,
      dataClusters: cap.dataClusters,
    },
    nodes,
    order,
  };
  if (labelEntryOffset !== undefined) result.labelEntryOffset = labelEntryOffset;
  return result;
}
