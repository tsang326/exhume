// Types for the test-only FAT12 image writer.
// Independent of src/core internals: no imports at all, so the writer cannot
// accidentally share logic with the reader it is used to test.

export type StandardGeometryName =
  | '160K'
  | '180K'
  | '320K'
  | '360K'
  | '720K'
  | '1200K'
  | '1440K'
  | '2880K';

/** BPB-level geometry the writer needs to lay out an image. */
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

/** DOS attribute flags (writer-local copy; same shape as the reader's Attributes). */
export interface WriterAttributes {
  readOnly: boolean;
  hidden: boolean;
  system: boolean;
  archive: boolean;
}

export interface DosDateTime {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export interface NodeBase {
  /** 8.3 name, e.g. 'README.TXT'. */
  name: string;
  /** Emits VFAT records (up to 255 UTF-16 units). */
  longName?: string;
  modified?: DosDateTime;
  attributes?: Partial<WriterAttributes>;
  deleted?: boolean;
  /** Deleted nodes only: put the node's clusters at this start cluster. */
  placement?: { startCluster: number };
}

export interface FileNode extends NodeBase {
  kind: 'file';
  content: Uint8Array;
}

export interface DirNode extends NodeBase {
  kind: 'directory';
  children: TreeNode[];
}

export type TreeNode = FileNode | DirNode;

export interface FileTree {
  volumeLabel?: string;
  children: TreeNode[];
}

export type DamageSpec =
  | { type: 'cyclic-chain'; path: string }
  | { type: 'cluster-out-of-range'; path: string }
  | { type: 'self-referencing-directory'; path: string }
  | {
      type: 'invalid-bpb';
      field:
        | 'bytesPerSector'
        | 'sectorsPerCluster'
        | 'fatCount'
        | 'rootEntryCount'
        | 'sectorsPerFat'
        | 'totalSectors';
    }
  | { type: 'size-exceeds-chain'; path: string; extraBytes: number };

export interface WriteOptions {
  damage?: DamageSpec[];
  /** Long-name corruption hook for LFN tests. */
  lfn?: 'corrupt-checksum' | 'swap-order' | 'drop-last';
}

export interface Measure {
  rootEntries: number;
  clusters: number;
}

export interface Capacity {
  rootEntries: number;
  dataClusters: number;
  clusterBytes: number;
}
