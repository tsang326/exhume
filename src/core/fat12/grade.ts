/**
 * Undelete grader (Requirement 8). Reads only the FAT and the directory entry,
 * never throws, and never allocates from a disk-controlled size: the returned
 * run has at most `maxCluster - start + 1` elements. Reasons are numeric
 * templates (no disk text) clamped to MAX_REASON_CHARS.
 */

import type { ChainResult, ScanContext } from './chain';
import { classifyFat, FatClass, readFatEntry } from './fat';
import { GraveState } from './types';
import { clampText } from './warnings';

/** The fields of a directory entry that grading needs. */
export interface GradeInput {
  size: number;
  startCluster: number;
  isDirectory: boolean;
}

/** `run` lists the clusters usable for recovery (free, unclaimed prefix); empty unless recovered/partial. */
export interface Grade {
  state: GraveState;
  reason: string;
  run: number[];
}

function make(state: GraveState, reason: string, run: number[] = []): Grade {
  return { state, reason: clampText(reason), run };
}

/**
 * Grade a deleted entry. `claimed` is a Uint8Array of length maxCluster + 1
 * allocated by the caller; clusters of recovered/partial runs are marked in it
 * so that later entries see the overlap (8.12). `path` is accepted for
 * symmetry with the other scan functions; grading adds no warnings.
 */
export function gradeDeleted(ctx: ScanContext, claimed: Uint8Array, e: GradeInput, _path: string): Grade {
  const { layout, view } = ctx;

  // 8.13: deleted directories are never listed.
  if (e.isDirectory) return make(GraveState.Lost, 'deleted directory; its contents are not listed');
  // 8.3: empty files are recoverable without looking at the start cluster.
  if (e.size === 0) return make(GraveState.Recovered, 'file is empty');

  const start = e.startCluster;
  // 8.7
  if (!Number.isInteger(start) || start < 2 || start > layout.maxCluster) {
    return make(GraveState.Lost, `start cluster ${start} is invalid; valid range is 2 to ${layout.maxCluster}`);
  }

  const clusterBytes = Math.max(1, layout.clusterBytes);
  const needed = Math.ceil(e.size / clusterBytes); // N; used only as a loop bound, never to allocate
  const limit = Math.min(needed, layout.maxCluster - start + 1);
  const run: number[] = [];

  for (let i = 0; i < limit; i++) {
    const c = start + i;
    const value = readFatEntry(view, layout, c);
    let blocked: string | undefined;
    if (value === undefined) {
      blocked = i === 0 ? 'FAT entry of start cluster is unreadable' : `FAT entry of cluster ${c} is unreadable`;
    } else if (classifyFat(value) !== FatClass.Free) {
      blocked = i === 0 ? `start cluster ${c} has been reused` : `cluster ${c} is allocated`;
    } else if (claimed[c] === 1) {
      blocked = i === 0 ? `start cluster ${c} overlaps an earlier deleted file` : `cluster ${c} overlaps an earlier deleted file`;
    }
    if (blocked !== undefined) {
      if (i === 0) return make(GraveState.Lost, blocked);
      for (const r of run) claimed[r] = 1;
      return make(GraveState.Partial, `${i} of ${needed} clusters still free; ${blocked}`, run);
    }
    run.push(c);
  }

  for (const r of run) claimed[r] = 1;
  // 8.8: run is cut off by the end of the disk (limit < needed); at least one cluster is free here.
  if (limit < needed) {
    return make(GraveState.Partial, `${limit} of ${needed} clusters still free; run exceeds the disk`, run);
  }
  return make(GraveState.Recovered, `${needed} clusters are contiguous and unallocated`, run);
}

/**
 * Grade a live entry from its chain (decision 2). Returns undefined for a clean
 * file (state `alive`, no reason).
 *
 * "Damaged" means any of:
 *  - the chain did not finish with end 'end' or 'enough' (cycle, range, bad,
 *    truncated, oob);
 *  - the chain is short: end === 'end' but fewer clusters than size needs;
 *  - the declared size exceeds the data capacity of the disk (decision 7:
 *    size-exceeds-disk is reported, so the file cannot be complete and is
 *    treated as damaged; chain-short is suppressed in that case).
 * A damaged file is `partial` when at least one cluster was read, else `lost`.
 * Zero-length files are never damaged. A chain longer than the size is normal slack.
 */
export function gradeLive(chain: ChainResult, size: number, ctx: ScanContext): Grade | undefined {
  if (size === 0) return undefined;
  const { layout } = ctx;
  const clusterBytes = Math.max(1, layout.clusterBytes);
  const got = chain.clusters.length;
  const capacity = Math.max(0, layout.dataClusters) * clusterBytes;

  let reason: string | undefined;
  if (chain.end !== 'end' && chain.end !== 'enough') {
    reason = `cluster chain is damaged (${chain.end}) after ${got} clusters`;
  } else if (size > capacity) {
    reason = `declared size ${size} exceeds disk data capacity ${capacity}`;
  } else if (chain.end === 'end' && got * clusterBytes < size) {
    reason = `chain has ${got} of ${Math.ceil(size / clusterBytes)} clusters needed`;
  }
  if (reason === undefined) return undefined;

  if (got === 0) return make(GraveState.Lost, reason);
  return make(GraveState.Partial, reason);
}
