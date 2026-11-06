/** Boot sector parsing, BPB validation, fallback geometries and derived layout. */

import type { ByteView } from './bytes';
import { DIR_ENTRY_BYTES, FAT12_MAX_DATA_CLUSTERS, MIN_IMAGE_BYTES } from './limits';
import { GeometrySource, WarningCode } from './types';
import type { WarningSink } from './warnings';

export interface Geometry {
  bytesPerSector: number;
  sectorsPerCluster: number;
  reservedSectors: number;
  fatCount: number;
  rootEntryCount: number;
  totalSectors: number;
  sectorsPerFat: number;
  mediaDescriptor: number;
}

export interface Layout extends Geometry {
  /** Byte offset of FAT 1. */
  fatStart: number;
  /** sectorsPerFat * bytesPerSector. */
  fatBytes: number;
  /** Byte offset of the root directory. */
  rootStart: number;
  rootSectors: number;
  /** Byte offset of cluster 2. */
  dataStart: number;
  clusterBytes: number;
  /** floor((totalSectors - dataStartSector) / sectorsPerCluster), never negative. */
  dataClusters: number;
  /** dataClusters + 1 (highest valid cluster number). */
  maxCluster: number;
}

/** Offset of the volume label in the boot sector (extended BPB). */
export const VOLUME_LABEL_OFFSET = 43;
/** Length of the raw volume label field. */
export const VOLUME_LABEL_BYTES = 11;

function fb(
  sectorsPerCluster: number,
  rootEntryCount: number,
  totalSectors: number,
  sectorsPerFat: number,
  mediaDescriptor: number,
): Geometry {
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

const FALLBACK_LIST: readonly Geometry[] = [
  fb(1, 64, 320, 1, 0xfe), // 160 KB
  fb(1, 64, 360, 2, 0xfc), // 180 KB
  fb(2, 112, 640, 1, 0xff), // 320 KB
  fb(2, 112, 720, 2, 0xfd), // 360 KB
  fb(2, 112, 1440, 3, 0xf9), // 720 KB
  fb(1, 224, 2400, 7, 0xf9), // 1.2 MB
  fb(1, 224, 2880, 9, 0xf0), // 1.44 MB
  fb(2, 240, 5760, 9, 0xf0), // 2.88 MB
];

/** Standard geometries keyed by image length in bytes (totalSectors * bytesPerSector). */
export const FALLBACK_GEOMETRIES: ReadonlyMap<number, Geometry> = new Map(
  FALLBACK_LIST.map((g): [number, Geometry] => [g.totalSectors * g.bytesPerSector, g]),
);

/**
 * Read the BPB fields from the boot sector. The 16-bit total sectors field is used,
 * falling back to the 32-bit field at 0x20 when it is zero.
 * Returns undefined when any field lies outside the image.
 */
export function parseBpb(view: ByteView): Geometry | undefined {
  const bytesPerSector = view.u16(0x0b);
  const sectorsPerCluster = view.u8(0x0d);
  const reservedSectors = view.u16(0x0e);
  const fatCount = view.u8(0x10);
  const rootEntryCount = view.u16(0x11);
  const total16 = view.u16(0x13);
  const mediaDescriptor = view.u8(0x15);
  const sectorsPerFat = view.u16(0x16);
  if (
    bytesPerSector === undefined ||
    sectorsPerCluster === undefined ||
    reservedSectors === undefined ||
    fatCount === undefined ||
    rootEntryCount === undefined ||
    total16 === undefined ||
    mediaDescriptor === undefined ||
    sectorsPerFat === undefined
  ) {
    return undefined;
  }
  let totalSectors = total16;
  if (totalSectors === 0) {
    const total32 = view.u32(0x20);
    if (total32 === undefined) return undefined;
    totalSectors = total32;
  }
  return {
    bytesPerSector,
    sectorsPerCluster,
    reservedSectors,
    fatCount,
    rootEntryCount,
    totalSectors,
    sectorsPerFat,
    mediaDescriptor,
  };
}

function rootSectorsOf(g: Geometry): number {
  return Math.ceil((g.rootEntryCount * DIR_ENTRY_BYTES) / g.bytesPerSector);
}

function dataStartSectorOf(g: Geometry): number {
  return g.reservedSectors + g.fatCount * g.sectorsPerFat + rootSectorsOf(g);
}

function isPowerOfTwoUpTo128(n: number): boolean {
  return n >= 1 && n <= 128 && (n & (n - 1)) === 0;
}

/** The nine validity conditions of Requirement 3.2 as one pure predicate. */
export function isValidBpb(g: Geometry, imageLength: number): boolean {
  const bps = g.bytesPerSector;
  if (bps !== 512 && bps !== 1024 && bps !== 2048 && bps !== 4096) return false;
  if (!isPowerOfTwoUpTo128(g.sectorsPerCluster)) return false;
  if (g.reservedSectors < 1) return false;
  if (g.fatCount !== 1 && g.fatCount !== 2) return false;
  if (g.rootEntryCount <= 0) return false;
  if (g.sectorsPerFat <= 0) return false;
  if (g.totalSectors <= 0) return false;
  if (g.totalSectors * bps > imageLength) return false;
  // The data area must start inside the image (and inside the declared sectors).
  return dataStartSectorOf(g) < g.totalSectors;
}

/** Compute byte offsets and cluster counts. Safe on any numeric input; never throws. */
export function deriveLayout(g: Geometry): Layout {
  const bps = g.bytesPerSector;
  const rootSectors = rootSectorsOf(g);
  const dataStartSector = dataStartSectorOf(g);
  const spc = g.sectorsPerCluster;
  const rawClusters = spc > 0 ? Math.floor((g.totalSectors - dataStartSector) / spc) : 0;
  const dataClusters = Number.isFinite(rawClusters) && rawClusters > 0 ? rawClusters : 0;
  return {
    ...g,
    fatStart: g.reservedSectors * bps,
    fatBytes: g.sectorsPerFat * bps,
    rootStart: (g.reservedSectors + g.fatCount * g.sectorsPerFat) * bps,
    rootSectors,
    dataStart: dataStartSector * bps,
    clusterBytes: spc * bps,
    dataClusters,
    maxCluster: dataClusters + 1,
  };
}

/** Raw 11-byte volume label from the boot sector (CP437 decoding happens in disk.ts). */
export function readRawVolumeLabel(view: ByteView): Uint8Array | undefined {
  return view.copy(VOLUME_LABEL_OFFSET, VOLUME_LABEL_BYTES);
}

/**
 * Media check (Requirement 3.8, decision 6): compare the first byte of FAT 1 with the
 * media descriptor of the selected Geometry. Adds `media-mismatch` on difference.
 * An unreadable FAT byte is not reported here; FAT reads report their own bounds errors.
 * Returns true when the check passed or could not be made.
 */
export function checkMedia(view: ByteView, layout: Layout, sink: WarningSink): boolean {
  const first = view.u8(layout.fatStart);
  if (first === undefined) return true;
  if (first === layout.mediaDescriptor) return true;
  sink.add(
    WarningCode.MediaMismatch,
    `media descriptor ${layout.mediaDescriptor} differs from first FAT byte ${first}`,
  );
  return false;
}

export type GeometryChoice =
  | {
      source: typeof GeometrySource.Bpb | typeof GeometrySource.Fallback;
      layout: Layout;
      /** False when the data cluster count says this is not FAT12 (`not-fat12` already warned). */
      fat12: boolean;
      /** Raw 11-byte volume label, undefined if the boot sector is too short. */
      rawLabel: Uint8Array | undefined;
    }
  | { source: typeof GeometrySource.None; rawLabel: Uint8Array | undefined };

/**
 * Select the Geometry for an image (Requirement 3).
 *
 * Order: boot signature check (`boot-signature-missing`, never changes validation),
 * parse and validate the BPB, else a fallback by image length (`bpb-invalid`),
 * else `none` (`geometry-unknown`). For bpb and fallback sources the cluster count is
 * checked (`not-fat12` when 4085 or more; `fat12` is false then) and, when FAT12,
 * the media check runs. The caller handles empty and oversized images first.
 */
export function chooseGeometry(view: ByteView, sink: WarningSink): GeometryChoice {
  if (view.length < MIN_IMAGE_BYTES) {
    sink.add(WarningCode.GeometryUnknown, 'image is smaller than one boot sector');
    return { source: GeometrySource.None, rawLabel: undefined };
  }

  if (view.u8(510) !== 0x55 || view.u8(511) !== 0xaa) {
    sink.add(WarningCode.BootSignatureMissing, 'boot signature 0x55 0xAA not found');
  }
  const rawLabel = readRawVolumeLabel(view);

  let source: typeof GeometrySource.Bpb | typeof GeometrySource.Fallback;
  let geometry: Geometry;

  const bpb = parseBpb(view);
  if (bpb !== undefined && isValidBpb(bpb, view.length)) {
    source = GeometrySource.Bpb;
    geometry = bpb;
  } else {
    const fallback = FALLBACK_GEOMETRIES.get(view.length);
    if (fallback === undefined) {
      sink.add(WarningCode.GeometryUnknown, 'boot sector is invalid and image size is not a standard floppy size');
      return { source: GeometrySource.None, rawLabel };
    }
    sink.add(WarningCode.BpbInvalid, 'boot sector parameters are invalid; using standard geometry for image size');
    source = GeometrySource.Fallback;
    geometry = fallback;
  }

  const layout = deriveLayout(geometry);
  if (layout.dataClusters > FAT12_MAX_DATA_CLUSTERS) {
    sink.add(WarningCode.NotFat12, `${layout.dataClusters} data clusters; FAT12 allows at most ${FAT12_MAX_DATA_CLUSTERS}`);
    return { source, layout, fat12: false, rawLabel };
  }

  checkMedia(view, layout, sink);
  return { source, layout, fat12: true, rawLabel };
}
