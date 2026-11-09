// Public entry point of the test-only FAT12 image writer.
// No test-runner, Node or src/core imports: callable from scripts/make-demo-disks.ts.

import { applyDamage } from './damage';
import { layoutImage } from './layout';
import type { LayoutResult } from './layout';
import { standardGeometry } from './measure';
import type { FileTree, Geometry, StandardGeometryName, WriteOptions } from './types';

export { FitError } from './errors';
export {
  capacityOf,
  fitTree,
  measureTree,
  pickGeometry,
  STANDARD_GEOMETRY_NAMES,
  standardGeometry,
} from './measure';
export type { LayoutResult, NodeInfo } from './layout';
export type {
  Capacity,
  DamageSpec,
  DirNode,
  DosDateTime,
  FileNode,
  NeverUsedSlot,
  FileTree,
  Geometry,
  Measure,
  StandardGeometryName,
  TreeNode,
  WriteOptions,
} from './types';

/**
 * Lay out the tree (all fit checks run first; throws FitError, no partial
 * image), then apply damage. Returns the layout with offsets and node info.
 */
export function writeFat12ImageWithLayout(
  tree: FileTree,
  geometry: StandardGeometryName | Geometry,
  options: WriteOptions = {},
): LayoutResult {
  const g = typeof geometry === 'string' ? standardGeometry(geometry) : geometry;
  const result = layoutImage(tree, g, options.serial === undefined ? {} : { serial: options.serial });
  applyDamage(result, options.damage ?? []);
  return result;
}

/** Complete image bytes, or throws. */
export function writeFat12Image(
  tree: FileTree,
  geometry: StandardGeometryName | Geometry,
  options: WriteOptions = {},
): Uint8Array {
  return writeFat12ImageWithLayout(tree, geometry, options).image;
}
