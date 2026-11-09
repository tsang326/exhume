/**
 * Directory walker (Requirements 6, 7, 8). Explicit stack, depth counter, global record
 * budget and an outer iteration cap: no recursion, no throws. Every name, size, date and
 * cluster number comes from the untrusted image.
 */

import { walkChain, type ChainResult, type ScanContext } from './chain';
import { decodeDosDateTime, isZeroDosDateTime } from './dates';
import { gradeDeleted, gradeLive, type Grade } from './grade';
import { DIR_ENTRY_BYTES, MAX_DIR_DEPTH, MAX_TOTAL_ENTRIES } from './limits';
import { decodeShortName, lfnReset, lfnTake, lfnFeed, makeLfnState, type LfnState } from './names';
import { GraveKind, GraveState, WarningCode } from './types';
import type { Attributes, Grave } from './types';
import { clampText } from './warnings';

/** How `readBytes` fetches the bytes of an entry, decided during the scan. */
export type ReadPlan =
  | { kind: 'none' }
  /** Live file: re-walk the chain from the start cluster. */
  | { kind: 'chain' }
  /** Deleted file (recovered or partial): copy exactly these free clusters, in order. */
  | { kind: 'run'; clusters: number[] };

export interface EntryRecord {
  path: string;
  size: number;
  startCluster: number;
  kind: GraveKind;
  state: GraveState;
  deleted: boolean;
  readPlan: ReadPlan;
}

type DirSource = { kind: 'root'; records: number } | { kind: 'clusters'; clusters: number[]; perCluster: number; records: number };

interface DirFrame {
  /** '/' for the root, else the sanitised path of the directory. */
  path: string;
  /** Number of path components (root = 0). */
  depth: number;
  /** 0 for the root. */
  startCluster: number;
  parent: DirFrame | null;
  source: DirSource;
  /** Next record index. */
  index: number;
  lfn: LfnState;
}

const ATTR_READ_ONLY = 0x01;
const ATTR_HIDDEN = 0x02;
const ATTR_SYSTEM = 0x04;
const ATTR_VOLUME = 0x08;
const ATTR_DIRECTORY = 0x10;
const ATTR_ARCHIVE = 0x20;
const DELETED_MARK = 0xe5;
const PLACEHOLDER = 0x5f; // '_'
const NEVER_USED_FILL_F6 = 0xf6;
const NEVER_USED_FILL_ZERO = 0x00;

/** E5 followed by 31 bytes that are all F6 or all 00: a slot DOS never used. One pass over at most 31 bytes. */
export function isNeverUsedSlot(rec: Uint8Array): boolean {
  if (rec.length < DIR_ENTRY_BYTES || rec[0] !== DELETED_MARK) return false;
  const fill = rec[1];
  if (fill !== NEVER_USED_FILL_F6 && fill !== NEVER_USED_FILL_ZERO) return false;
  for (let i = 2; i < DIR_ENTRY_BYTES; i++) if (rec[i] !== fill) return false;
  return true;
}

function childPath(parent: string, name: string): string {
  return parent === '/' ? '/' + name : parent + '/' + name;
}

function u16(rec: Uint8Array, o: number): number {
  return (rec[o] ?? 0) | ((rec[o + 1] ?? 0) << 8);
}

function u32(rec: Uint8Array, o: number): number {
  return (rec[o] ?? 0) + (rec[o + 1] ?? 0) * 0x100 + (rec[o + 2] ?? 0) * 0x10000 + (rec[o + 3] ?? 0) * 0x1000000;
}

/** Byte offset of record `index` in a frame, or undefined when the index is past the source. */
function recordOffset(ctx: ScanContext, frame: DirFrame): number | undefined {
  const { layout } = ctx;
  const src = frame.source;
  if (src.kind === 'root') return layout.rootStart + frame.index * DIR_ENTRY_BYTES;
  const slot = Math.floor(frame.index / src.perCluster);
  const cluster = src.clusters[slot];
  if (cluster === undefined) return undefined;
  return layout.dataStart + (cluster - 2) * layout.clusterBytes + (frame.index % src.perCluster) * DIR_ENTRY_BYTES;
}

/** A pending long name that no 8.3 entry claimed: one `lfn-invalid` warning with the directory path. */
function flushOrphan(ctx: ScanContext, frame: DirFrame): void {
  if (!frame.lfn.pending) return;
  ctx.sink.add(WarningCode.LfnInvalid, 'long-name records have no matching 8.3 entry', frame.path);
  lfnReset(frame.lfn);
}

function attributesOf(attr: number): Attributes {
  return {
    readOnly: (attr & ATTR_READ_ONLY) !== 0,
    hidden: (attr & ATTR_HIDDEN) !== 0,
    system: (attr & ATTR_SYSTEM) !== 0,
    archive: (attr & ATTR_ARCHIVE) !== 0,
  };
}

function notListed(reason: string): Grade {
  return { state: GraveState.Partial, reason: clampText(reason), run: [] };
}

/**
 * Walk the directory tree. Callers that need partial results after an unexpected error
 * may pass their own output arrays; entries are pushed as they are completed.
 */
export function walkDirectories(
  ctx: ScanContext,
  out?: { graves: Grave[]; records: EntryRecord[] },
): { graves: Grave[]; records: EntryRecord[] } {
  const { layout, sink, view } = ctx;
  const graves: Grave[] = out?.graves ?? [];
  const records: EntryRecord[] = out?.records ?? [];
  const claimed = new Uint8Array(Math.max(0, layout.maxCluster) + 1);
  const readDirs = new Set<number>();
  const capacity = Math.max(0, layout.dataClusters) * layout.clusterBytes;
  const perCluster = Math.max(1, Math.floor(layout.clusterBytes / DIR_ENTRY_BYTES));

  const root: DirFrame = {
    path: '/',
    depth: 0,
    startCluster: 0,
    parent: null,
    source: { kind: 'root', records: Math.max(0, layout.rootEntryCount) },
    index: 0,
    lfn: makeLfnState(),
  };
  const stack: DirFrame[] = [root];
  let framesPushed = 1;
  let recordsRead = 0;
  let iterations = 0;
  const iterationCap = MAX_TOTAL_ENTRIES + Math.max(0, layout.maxCluster) + 8;

  while (stack.length > 0 && iterations < iterationCap) {
    iterations++;
    const frame = stack[stack.length - 1] as DirFrame;

    // End of the directory's source.
    if (frame.index >= frame.source.records) {
      flushOrphan(ctx, frame);
      stack.pop();
      continue;
    }

    // 1. Budget (decision 5): the 4,097th read attempt stops the whole scan.
    if (recordsRead >= MAX_TOTAL_ENTRIES) {
      sink.add(WarningCode.EntryLimit, `more than ${MAX_TOTAL_ENTRIES} directory records; scan stopped`);
      break;
    }
    recordsRead++;

    // 2. Fetch.
    const offset = recordOffset(ctx, frame);
    const rec = offset === undefined ? undefined : view.copy(offset, DIR_ENTRY_BYTES);
    frame.index++;
    if (rec === undefined) {
      sink.add(WarningCode.OutOfBoundsRead, 'directory record lies outside the image', frame.path);
      lfnReset(frame.lfn);
      stack.pop();
      continue;
    }

    const first = rec[0] as number;
    const attr = rec[11] as number;

    // 3. End marker.
    if (first === 0x00) {
      flushOrphan(ctx, frame);
      stack.pop();
      continue;
    }

    const deleted = first === DELETED_MARK;
    if (deleted && isNeverUsedSlot(rec)) continue;

    // 4. Long-name record.
    if ((attr & 0x3f) === 0x0f) {
      if (!deleted) lfnFeed(frame.lfn, rec);
      continue;
    }

    // 5. Volume label.
    if ((attr & ATTR_VOLUME) !== 0 && (attr & ATTR_DIRECTORY) === 0) {
      flushOrphan(ctx, frame);
      continue;
    }

    // 6. '.' and '..'
    if (!deleted && decodeShortName(rec).isDotEntry) {
      flushOrphan(ctx, frame);
      continue;
    }

    // 7. Build the entry.
    const isDirectory = (attr & ATTR_DIRECTORY) !== 0;
    let name: string;
    if (deleted) {
      flushOrphan(ctx, frame);
      const copy = new Uint8Array(rec);
      copy[0] = PLACEHOLDER;
      name = decodeShortName(copy).name;
    } else {
      name = decodeShortName(rec).name;
    }
    let entryPath = childPath(frame.path, name);
    if (!deleted) {
      const taken = lfnTake(frame.lfn, rec.subarray(0, 11));
      if (taken.kind === 'name') {
        entryPath = childPath(frame.path, taken.name);
      } else if (taken.kind === 'invalid') {
        sink.add(WarningCode.LfnInvalid, 'long-name records do not match the 8.3 entry', entryPath);
      }
    }

    const size = u32(rec, 28);
    const startCluster = u16(rec, 26);
    const dateWord = u16(rec, 24);
    const timeWord = u16(rec, 22);
    let date: string | null = null;
    if (!isZeroDosDateTime(dateWord, timeWord)) {
      date = decodeDosDateTime(dateWord, timeWord);
      if (date === null) sink.add(WarningCode.DateInvalid, 'modification date or time is invalid', entryPath);
    }

    // 8. Grade and descend.
    let state: GraveState = GraveState.Alive;
    let reason: string | undefined;
    let plan: ReadPlan = { kind: 'none' };
    let pushFrame: DirFrame | undefined;

    if (deleted) {
      const g = gradeDeleted(ctx, claimed, { size, startCluster, isDirectory }, entryPath);
      state = g.state;
      reason = g.reason;
      if (!isDirectory && g.run.length > 0 && (g.state === GraveState.Recovered || g.state === GraveState.Partial)) {
        plan = { kind: 'run', clusters: g.run };
      }
    } else if (isDirectory) {
      let g: Grade | undefined;
      if (startCluster < 2 || startCluster > layout.maxCluster) {
        sink.add(
          WarningCode.ClusterOutOfRange,
          `directory start cluster ${startCluster} is outside the valid range 2 to ${layout.maxCluster}`,
          entryPath,
        );
        g = { state: GraveState.Lost, reason: clampText(`start cluster ${startCluster} is invalid; contents not listed`), run: [] };
      } else if (frame.depth + 1 >= MAX_DIR_DEPTH) {
        sink.add(WarningCode.DepthExceeded, `directory is nested ${MAX_DIR_DEPTH} levels deep; contents not read`, entryPath);
        g = notListed('contents not listed: nested too deeply');
      } else if (isOnPath(frame, startCluster)) {
        sink.add(WarningCode.DirectoryLoop, `directory start cluster ${startCluster} is already on its own path`, entryPath);
        g = notListed('contents not listed: directory loop');
      } else if (readDirs.has(startCluster)) {
        sink.add(WarningCode.DirectoryDuplicate, `directory start cluster ${startCluster} was already read`, entryPath);
        g = notListed('contents not listed: directory already read through another entry');
      } else {
        readDirs.add(startCluster);
        const chain = walkChain(ctx, startCluster, Infinity, entryPath);
        if (chain.end !== 'end') g = gradeLive(chain, 1, ctx);
        if (chain.clusters.length > 0 && framesPushed < iterationCap) {
          pushFrame = {
            path: entryPath,
            depth: frame.depth + 1,
            startCluster,
            parent: frame,
            source: { kind: 'clusters', clusters: chain.clusters, perCluster, records: chain.clusters.length * perCluster },
            index: 0,
            lfn: makeLfnState(),
          };
        }
      }
      if (g !== undefined) {
        state = g.state;
        reason = g.reason;
      }
    } else {
      const g = gradeLiveFile(ctx, size, startCluster, capacity, entryPath);
      if (g !== undefined) {
        state = g.state;
        reason = g.reason;
      }
      if (size > 0 && state !== GraveState.Lost) plan = { kind: 'chain' };
    }

    const kind = isDirectory ? GraveKind.Directory : GraveKind.File;
    const grave: Grave = {
      id: graves.length,
      path: entryPath,
      size,
      date,
      state,
      kind,
      attributes: attributesOf(attr),
      startCluster,
    };
    if (state !== GraveState.Alive) grave.reason = clampText(reason ?? 'unknown');
    graves.push(grave);
    records.push({ path: entryPath, size, startCluster, kind, state, deleted, readPlan: plan });

    if (pushFrame !== undefined) {
      stack.push(pushFrame);
      framesPushed++;
    }
  }

  return { graves, records };
}

/** True when `start` equals the start cluster of `frame` or of any ancestor. Bounded by MAX_DIR_DEPTH. */
function isOnPath(frame: DirFrame, start: number): boolean {
  let cur: DirFrame | null = frame;
  for (let i = 0; cur !== null && i <= MAX_DIR_DEPTH + 1; i++) {
    if (cur.startCluster === start) return true;
    cur = cur.parent;
  }
  return false;
}

/** Walk and grade a live file (decisions 2 and 7). Emits size-exceeds-disk and chain-short. */
function gradeLiveFile(
  ctx: ScanContext,
  size: number,
  startCluster: number,
  capacity: number,
  path: string,
): Grade | undefined {
  if (size === 0) return undefined;
  const clusterBytes = Math.max(1, ctx.layout.clusterBytes);
  const needed = Math.ceil(size / clusterBytes);
  const tooBig = size > capacity;
  if (tooBig) {
    ctx.sink.add(WarningCode.SizeExceedsDisk, `declared size ${size} exceeds disk data capacity ${capacity}`, path);
  }
  const chain: ChainResult = walkChain(ctx, startCluster, needed, path);
  if (!tooBig && chain.end === 'end' && chain.clusters.length < needed) {
    ctx.sink.add(WarningCode.ChainShort, `chain has ${chain.clusters.length} of ${needed} clusters needed`, path);
  }
  return gradeLive(chain, size, ctx);
}
