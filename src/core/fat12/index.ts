/** Public API of the FAT12 core. Consumers import only from this module. */

export { openDisk, readDisk, readGraveBytes } from './disk';
export type { DiskHandle } from './disk';
export { FALLBACK_GEOMETRIES } from './geometry';
export * from './limits';

// Value objects whose names are shared with a type of the same name.
export { GraveState, GraveKind, GeometrySource, WarningCode } from './types';
export type {
  DiskReport,
  Volume,
  Grave,
  Attributes,
  Warning,
  ReadResult,
  GeometryInfo,
} from './types';
