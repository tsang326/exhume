/**
 * Scan orchestration and file reads (Requirements 1, 2, 3, 5, 8, 10).
 *
 * `openDisk` throws only for a non-Uint8Array input (before any state exists). Everything
 * else is reported as warnings. The image is never mutated; the handle keeps a reference
 * to it, so callers must not change it while the handle is in use.
 */

import { makeByteView, type ByteView } from './bytes';
import { makeScanContext, walkChain } from './chain';
import { decodeCp437 } from './cp437';
import { walkDirectories, type EntryRecord } from './directory';
import { fatCopiesDiffer } from './fat';
import { chooseGeometry, type Layout } from './geometry';
import { guarded } from './guard';
import { MAX_FILE_OUTPUT_BYTES, MAX_IMAGE_BYTES } from './limits';
import { GeometrySource, WarningCode } from './types';
import type { DiskReport, GeometryInfo, Grave, ReadResult, Volume } from './types';
import { makeWarningSink } from './warnings';

export interface DiskHandle {
  readonly report: DiskReport;
  /** Bytes of one file. Never throws; failures are `{ ok: false }`. */
  readBytes(grave: Grave): ReadResult;
}

const ERR_NOT_FOUND = 'grave not found in this disk image';
const ERR_DIRECTORY = 'directory has no file bytes';
const ERR_LOST = 'data is not recoverable';

function geometryInfo(layout: Layout): GeometryInfo {
  return {
    bytesPerSector: layout.bytesPerSector,
    sectorsPerCluster: layout.sectorsPerCluster,
    reservedSectors: layout.reservedSectors,
    fatCount: layout.fatCount,
    rootEntryCount: layout.rootEntryCount,
    totalSectors: layout.totalSectors,
    sectorsPerFat: layout.sectorsPerFat,
    mediaDescriptor: layout.mediaDescriptor,
    dataClusters: layout.dataClusters,
  };
}

/** CP437 label, control characters to '_', trailing spaces removed. '' when unavailable. */
function labelOf(raw: Uint8Array | undefined): string {
  if (raw === undefined) return '';
  let text = '';
  for (const ch of decodeCp437(raw)) {
    const code = ch.codePointAt(0) as number;
    text += code < 0x20 || code === 0x7f ? '_' : ch;
  }
  let end = text.length;
  while (end > 0 && text[end - 1] === ' ') end--;
  return text.slice(0, end);
}

function emptyHandle(volume: Volume, warnings: DiskReport['warnings']): DiskHandle {
  return {
    report: { volume, files: [], warnings },
    readBytes: () => ({ ok: false, error: ERR_NOT_FOUND }),
  };
}

export function openDisk(image: Uint8Array): DiskHandle {
  if (Object.prototype.toString.call(image) !== '[object Uint8Array]') {
    throw new TypeError('invalid input type: expected Uint8Array');
  }

  const sink = makeWarningSink();
  const noneVolume: Volume = { label: '', geometrySource: GeometrySource.None, geometry: null };

  // Length checks come first: nothing is parsed (or even read) for these images.
  if (image.length === 0) {
    sink.add(WarningCode.ImageEmpty, 'image has no bytes');
    return emptyHandle(noneVolume, sink.list());
  }
  if (image.length > MAX_IMAGE_BYTES) {
    sink.add(WarningCode.ImageTooLarge, `image is larger than ${MAX_IMAGE_BYTES} bytes`);
    return emptyHandle(noneVolume, sink.list());
  }

  const view = makeByteView(image);
  const choice = chooseGeometry(view, sink);
  if (choice.source === GeometrySource.None) {
    const volume: Volume = { label: labelOf(choice.rawLabel), geometrySource: GeometrySource.None, geometry: null };
    return emptyHandle(volume, sink.list());
  }

  const layout = choice.layout;
  const volume: Volume = {
    label: labelOf(choice.rawLabel),
    geometrySource: choice.source,
    geometry: geometryInfo(layout),
  };
  if (!choice.fat12) return emptyHandle(volume, sink.list());

  if (fatCopiesDiffer(view, layout)) {
    sink.add(WarningCode.FatCopiesDiffer, 'the two FAT copies are not identical');
  }

  const ctx = makeScanContext(view, layout, sink);
  const out = { graves: [] as Grave[], records: [] as EntryRecord[] };
  // On an unexpected error the entries completed so far stay in `out`.
  guarded('directory walk', () => walkDirectories(ctx, out), () => out, sink);
  const { graves, records } = out;

  const report: DiskReport = { volume, files: graves, warnings: sink.list() };
  return {
    report,
    readBytes: (grave: Grave): ReadResult =>
      guarded<ReadResult>(
        'file read',
        () => readRecord(view, layout, records, grave),
        () => ({ ok: false, error: ERR_LOST }),
        makeWarningSink(),
      ),
  };
}

/** Find the stored record for a caller-supplied grave; undefined unless every field matches. */
function lookup(records: readonly EntryRecord[], grave: Grave): EntryRecord | undefined {
  if (typeof grave !== 'object' || grave === null) return undefined;
  const id = grave.id;
  if (typeof id !== 'number' || !Number.isInteger(id) || id < 0 || id >= records.length) return undefined;
  const rec = records[id];
  if (rec === undefined) return undefined;
  if (grave.path !== rec.path || grave.size !== rec.size || grave.startCluster !== rec.startCluster) return undefined;
  if (grave.kind !== rec.kind) return undefined;
  return rec;
}

function readRecord(view: ByteView, layout: Layout, records: readonly EntryRecord[], grave: Grave): ReadResult {
  const rec = lookup(records, grave);
  if (rec === undefined) return { ok: false, error: ERR_NOT_FOUND };
  if (rec.kind === 'directory') return { ok: false, error: ERR_DIRECTORY };
  if (rec.state === 'lost') return { ok: false, error: ERR_LOST };

  const local = makeWarningSink();
  if (rec.size === 0) return { ok: true, bytes: new Uint8Array(0), warnings: local.list() };

  const clusterBytes = Math.max(1, layout.clusterBytes);
  const capacity = Math.max(0, layout.dataClusters) * clusterBytes;
  if (rec.size > capacity) {
    local.add(WarningCode.SizeExceedsDisk, `declared size ${rec.size} exceeds disk data capacity ${capacity}`, rec.path);
  }
  if (rec.size > MAX_FILE_OUTPUT_BYTES) {
    local.add(WarningCode.OutputCapped, `output limited to ${MAX_FILE_OUTPUT_BYTES} bytes`, rec.path);
  }
  const wanted = Math.min(rec.size, MAX_FILE_OUTPUT_BYTES);

  let clusters: number[];
  if (rec.readPlan.kind === 'run') {
    clusters = rec.readPlan.clusters;
  } else if (rec.readPlan.kind === 'chain') {
    const ctx = makeScanContext(view, layout, local);
    const chain = walkChain(ctx, rec.startCluster, Math.ceil(wanted / clusterBytes), rec.path);
    clusters = chain.clusters;
    if (chain.end === 'end' && chain.clusters.length * clusterBytes < wanted && rec.size <= capacity) {
      local.add(
        WarningCode.ChainShort,
        `chain has ${chain.clusters.length} of ${Math.ceil(wanted / clusterBytes)} clusters needed`,
        rec.path,
      );
    }
  } else {
    return { ok: false, error: ERR_LOST };
  }

  // Collect chunks first: the output is allocated only once its final length is known.
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (const cluster of clusters) {
    const remaining = wanted - total;
    if (remaining <= 0) break;
    const chunk = view.copy(layout.dataStart + (cluster - 2) * clusterBytes, Math.min(clusterBytes, remaining));
    if (chunk === undefined) {
      local.add(WarningCode.OutOfBoundsRead, `cluster ${cluster} lies outside the image`, rec.path);
      break;
    }
    chunks.push(chunk);
    total += chunk.length;
  }
  const bytes = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, at);
    at += chunk.length;
  }
  return { ok: true, bytes, warnings: local.list() };
}

/** Convenience: openDisk(image).report */
export function readDisk(image: Uint8Array): DiskReport {
  return openDisk(image).report;
}

/** Convenience: openDisk(image).readBytes(grave) */
export function readGraveBytes(image: Uint8Array, grave: Grave): ReadResult {
  return openDisk(image).readBytes(grave);
}
