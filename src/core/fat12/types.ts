/** Report types for the FAT12 core. Plain JSON-safe data only. */

export const GraveState = {
  Alive: 'alive',
  Recovered: 'recovered',
  Partial: 'partial',
  Lost: 'lost',
} as const;
export type GraveState = (typeof GraveState)[keyof typeof GraveState];

export const GraveKind = {
  File: 'file',
  Directory: 'directory',
} as const;
export type GraveKind = (typeof GraveKind)[keyof typeof GraveKind];

export const GeometrySource = {
  Bpb: 'bpb',
  Fallback: 'fallback',
  None: 'none',
} as const;
export type GeometrySource = (typeof GeometrySource)[keyof typeof GeometrySource];

export interface Attributes {
  readOnly: boolean;
  hidden: boolean;
  system: boolean;
  archive: boolean;
}

export interface Grave {
  /** Index in DiskReport.files. */
  id: number;
  /** Absolute, '/' separated, sanitised. */
  path: string;
  /** Declared size, integer 0..4_294_967_295. */
  size: number;
  /** 'YYYY-MM-DDTHH:MM:SS' or null. */
  date: string | null;
  state: GraveState;
  kind: GraveKind;
  /** 1..200 chars, present for non-alive states. */
  reason?: string;
  attributes: Attributes;
  startCluster: number;
}

export interface GeometryInfo {
  bytesPerSector: number;
  sectorsPerCluster: number;
  reservedSectors: number;
  fatCount: number;
  rootEntryCount: number;
  totalSectors: number;
  sectorsPerFat: number;
  mediaDescriptor: number;
  dataClusters: number;
}

export interface Volume {
  /** CP437, trailing spaces removed, control chars replaced with '_'. */
  label: string;
  geometrySource: GeometrySource;
  /** Null when source is 'none'. */
  geometry: GeometryInfo | null;
}

export const WarningCode = {
  ImageTooLarge: 'image-too-large',
  ImageEmpty: 'image-empty',
  GeometryUnknown: 'geometry-unknown',
  BpbInvalid: 'bpb-invalid',
  BootSignatureMissing: 'boot-signature-missing',
  MediaMismatch: 'media-mismatch',
  NotFat12: 'not-fat12',
  FatCopiesDiffer: 'fat-copies-differ',
  OutOfBoundsRead: 'out-of-bounds-read',
  ChainCycle: 'chain-cycle',
  ClusterOutOfRange: 'cluster-out-of-range',
  ChainBadCluster: 'chain-bad-cluster',
  ChainTruncated: 'chain-truncated',
  ChainShort: 'chain-short',
  OutputCapped: 'output-capped',
  SizeExceedsDisk: 'size-exceeds-disk',
  DepthExceeded: 'depth-exceeded',
  DirectoryLoop: 'directory-loop',
  DirectoryDuplicate: 'directory-duplicate',
  EntryLimit: 'entry-limit',
  LfnInvalid: 'lfn-invalid',
  DateInvalid: 'date-invalid',
  InternalError: 'internal-error',
} as const;
export type WarningCode = (typeof WarningCode)[keyof typeof WarningCode];

export interface Warning {
  code: WarningCode;
  /** Template text, numbers only, no disk text. */
  message: string;
  /** Sanitised path of the affected item, when one exists. */
  path?: string;
}

export interface DiskReport {
  volume: Volume;
  files: Grave[];
  warnings: Warning[];
}

export type ReadResult =
  | { ok: true; bytes: Uint8Array; warnings: Warning[] }
  | { ok: false; error: string };
