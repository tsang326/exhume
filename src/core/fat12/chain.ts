/** Cluster chain walker (Requirement 5): bounded, cycle-safe, never throws. */

import type { ByteView } from './bytes';
import { classifyFat, FatClass, readFatEntry } from './fat';
import type { Layout } from './geometry';
import { WarningCode } from './types';
import type { WarningSink } from './warnings';

export type ChainEnd = 'end' | 'enough' | 'cycle' | 'range' | 'bad' | 'truncated' | 'oob';
export interface ChainResult {
  clusters: number[];
  end: ChainEnd;
}

export interface ScanContext {
  view: ByteView;
  layout: Layout;
  sink: WarningSink;
  /** Length maxCluster + 1; stamp[c] === walkId means visited in the current walk. */
  stamp: Uint32Array;
  nextWalkId: number;
}

const MAX_WALK_ID = 0xffffffff;

/** Build a context from an already validated layout. */
export function makeScanContext(view: ByteView, layout: Layout, sink: WarningSink): ScanContext {
  const size = Math.max(0, layout.maxCluster) + 1;
  return { view, layout, sink, stamp: new Uint32Array(size), nextWalkId: 1 };
}

/** Take a fresh walk id; clears stamps instead of overflowing 2^32 - 1. */
function takeWalkId(ctx: ScanContext): number {
  if (ctx.nextWalkId >= MAX_WALK_ID || ctx.nextWalkId < 1) {
    ctx.stamp.fill(0);
    ctx.nextWalkId = 1;
  }
  const id = ctx.nextWalkId;
  ctx.nextWalkId = id + 1;
  return id;
}

/**
 * Follow the chain from `start`, collecting at most `wantClusters` clusters
 * (Infinity allowed). At most one warning is recorded per walk.
 */
export function walkChain(ctx: ScanContext, start: number, wantClusters: number, path: string): ChainResult {
  const { layout, sink, view } = ctx;
  const clusters: number[] = [];
  const walkId = takeWalkId(ctx);
  const maxSteps = Math.max(0, layout.dataClusters);
  let current = start;
  let result: ChainEnd | undefined;

  sink.beginWalk();
  try {
    for (let step = 0; step < maxSteps; step++) {
      // 1. range
      if (!Number.isInteger(current) || current < 2 || current > layout.maxCluster) {
        sink.add(
          WarningCode.ClusterOutOfRange,
          `cluster ${current} is outside the valid range 2 to ${layout.maxCluster}`,
          path,
        );
        result = 'range';
        break;
      }
      // 2. cycle, stamp, append
      if (ctx.stamp[current] === walkId) {
        sink.add(WarningCode.ChainCycle, `cluster chain revisits cluster ${current}`, path);
        result = 'cycle';
        break;
      }
      ctx.stamp[current] = walkId;
      clusters.push(current);
      // 3. enough
      if (clusters.length >= wantClusters) {
        result = 'enough';
        break;
      }
      // 4. FAT read
      const value = readFatEntry(view, layout, current);
      if (value === undefined) {
        sink.add(WarningCode.OutOfBoundsRead, `FAT entry for cluster ${current} lies outside the image`, path);
        result = 'oob';
        break;
      }
      const cls = classifyFat(value);
      if (cls === FatClass.Free) {
        sink.add(WarningCode.ChainTruncated, `cluster chain reaches free cluster after cluster ${current}`, path);
        result = 'truncated';
        break;
      }
      if (cls === FatClass.Reserved || cls === FatClass.Bad) {
        sink.add(WarningCode.ChainBadCluster, `cluster ${current} links to bad or reserved value ${value}`, path);
        result = 'bad';
        break;
      }
      if (cls === FatClass.End) {
        result = 'end';
        break;
      }
      current = value;
    }
    if (result === undefined) {
      // Step cap reached: more links than clusters exist, so the chain must loop.
      sink.add(WarningCode.ChainCycle, `cluster chain exceeds ${maxSteps} clusters`, path);
      result = 'cycle';
    }
  } finally {
    sink.endWalk();
  }
  return { clusters, end: result };
}
