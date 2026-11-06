// Post-layout damage for the test-only FAT12 image writer (Requirement 9.6).
// Each function mutates `result.image` and produces ONLY its own defect.
// FAT changes are applied to every FAT copy so 'fat copies differ' is never a side effect.
// No imports from src/core, vitest, fast-check or Node.

import { LFN_LAST_FLAG, writeFatEntry } from './encode';
import type { LayoutResult, NodeInfo } from './layout';
import type { DamageSpec } from './types';

const ENTRY_BYTES = 32;
const MAX_NEXT_LINK = 0xfef; // highest value still classified as a next-cluster link

function lookup(result: LayoutResult, path: string, kind: 'file' | 'directory'): NodeInfo {
  const info = result.nodes.get(path);
  if (info === undefined) throw new Error(`damage: no such path: ${path}`);
  if (info.kind !== kind) throw new Error(`damage: path is not a ${kind}: ${path}`);
  return info;
}

function lookupChained(result: LayoutResult, path: string): NodeInfo {
  const info = lookup(result, path, 'file');
  if (info.deleted || info.placed) throw new Error(`damage: node has no live FAT chain: ${path}`);
  if (info.clusters.length === 0) throw new Error(`damage: file has no clusters: ${path}`);
  return info;
}

/** Set one FAT entry in every FAT copy. */
function setFat(result: LayoutResult, cluster: number, value: number): void {
  const { fatStart, fatBytes, fatCount } = result.offsets;
  for (let c = 0; c < fatCount; c++) {
    const start = fatStart + c * fatBytes;
    writeFatEntry(result.image.subarray(start, start + fatBytes), cluster, value);
  }
}

function setU16(b: Uint8Array, o: number, v: number): void {
  b[o] = v & 0xff;
  b[o + 1] = (v >>> 8) & 0xff;
}

function setU32(b: Uint8Array, o: number, v: number): void {
  setU16(b, o, v & 0xffff);
  setU16(b, o + 2, (v >>> 16) & 0xffff);
}

/**
 * Last cluster of the file's chain is linked back to the first cluster
 * (to itself for a one-cluster file). Only that FAT entry (both copies) changes.
 */
export function damageCyclicChain(result: LayoutResult, path: string): void {
  const info = lookupChained(result, path);
  const first = info.clusters[0] as number;
  const last = info.clusters[info.clusters.length - 1] as number;
  setFat(result, last, first);
}

/**
 * The FAT link of the file's first cluster is set to maxCluster + 1
 * (dataClusters + 2), which still classifies as a next-link. Only that FAT
 * entry (both copies) changes. Throws if that value would exceed 0xFEF.
 */
export function damageClusterOutOfRange(result: LayoutResult, path: string): void {
  const info = lookupChained(result, path);
  const value = result.offsets.dataClusters + 2;
  if (value > MAX_NEXT_LINK) {
    throw new Error(
      `damage: cannot make an out-of-range link on this disk: maxCluster ${value - 1} is too close to 0x${MAX_NEXT_LINK.toString(16)}`,
    );
  }
  setFat(result, info.clusters[0] as number, value);
}

/**
 * `path` names a directory C. C's first live child directory S gets its start
 * cluster (u16 at entry+26 of S's entry in C) rewritten to C's own start
 * cluster, so S refers to the directory that contains it. Nothing else changes.
 */
export function damageSelfReferencingDirectory(result: LayoutResult, path: string): void {
  const dir = lookup(result, path, 'directory');
  let child: NodeInfo | undefined;
  for (const info of result.nodes.values()) {
    if (info.parentPath === path && info.kind === 'directory' && !info.deleted) {
      child = info;
      break;
    }
  }
  if (child === undefined) throw new Error(`damage: directory has no live subdirectory: ${path}`);
  setU16(result.image, child.entryOffset + 26, dir.startCluster);
}

/**
 * Set one BPB field to an invalid value (0, except bytesPerSector = 513).
 * For totalSectors both the 16-bit and 32-bit fields are zeroed.
 */
export function damageInvalidBpb(
  result: LayoutResult,
  field: Extract<DamageSpec, { type: 'invalid-bpb' }>['field'],
): void {
  const img = result.image;
  switch (field) {
    case 'bytesPerSector':
      setU16(img, 0x0b, 513);
      break;
    case 'sectorsPerCluster':
      img[0x0d] = 0;
      break;
    case 'fatCount':
      img[0x10] = 0;
      break;
    case 'rootEntryCount':
      setU16(img, 0x11, 0);
      break;
    case 'totalSectors':
      setU16(img, 0x13, 0);
      setU32(img, 0x20, 0);
      break;
    case 'sectorsPerFat':
      setU16(img, 0x16, 0);
      break;
  }
}

/**
 * Declared size (u32 at entry+28) becomes chain bytes + extraBytes, capped at 0xFFFFFFFF.
 * Only those four bytes change.
 */
export function damageSizeExceedsChain(
  result: LayoutResult,
  path: string,
  extraBytes: number,
): void {
  const info = lookup(result, path, 'file');
  if (!Number.isInteger(extraBytes) || extraBytes < 1) {
    throw new Error(`damage: extraBytes must be a positive integer: ${path}`);
  }
  const chainBytes = info.clusters.length * result.offsets.clusterBytes;
  setU32(result.image, info.entryOffset + 28, Math.min(chainBytes + extraBytes, 0xffffffff));
}

/**
 * Long-name corruption on a node that has long-name records:
 * - corrupt-checksum: the checksum byte (offset 13) of every record is XORed with 0xFF.
 * - swap-order: the first two records on disk swap places (needs at least two).
 * - drop-last: the 0x40 flag is cleared in the first-on-disk record, so the
 *   sequence no longer has a valid start.
 */
export function damageLfn(
  result: LayoutResult,
  path: string,
  mode: 'corrupt-checksum' | 'swap-order' | 'drop-last',
): void {
  const info = result.nodes.get(path);
  if (info === undefined) throw new Error(`damage: no such path: ${path}`);
  const offs = info.lfnOffsets;
  if (offs.length === 0) throw new Error(`damage: node has no long name: ${path}`);
  const img = result.image;
  if (mode === 'corrupt-checksum') {
    for (const o of offs) img[o + 13] = (img[o + 13] as number) ^ 0xff;
  } else if (mode === 'swap-order') {
    if (offs.length < 2) throw new Error(`damage: long name has only one record: ${path}`);
    const a = offs[0] as number;
    const b = offs[1] as number;
    const tmp = img.slice(a, a + ENTRY_BYTES);
    img.copyWithin(a, b, b + ENTRY_BYTES);
    img.set(tmp, b);
  } else {
    const o = offs[0] as number;
    img[o] = (img[o] as number) & ~LFN_LAST_FLAG & 0xff;
  }
}

/** Apply damage specs in order. Throws a plain Error naming the path for bad targets. */
export function applyDamage(result: LayoutResult, specs: DamageSpec[]): void {
  for (const spec of specs) {
    switch (spec.type) {
      case 'cyclic-chain':
        damageCyclicChain(result, spec.path);
        break;
      case 'cluster-out-of-range':
        damageClusterOutOfRange(result, spec.path);
        break;
      case 'self-referencing-directory':
        damageSelfReferencingDirectory(result, spec.path);
        break;
      case 'invalid-bpb':
        damageInvalidBpb(result, spec.field);
        break;
      case 'size-exceeds-chain':
        damageSizeExceedsChain(result, spec.path, spec.extraBytes);
        break;
      case 'lfn':
        damageLfn(result, spec.path, spec.mode);
        break;
    }
  }
}
