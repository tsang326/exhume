import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { numRuns } from '../runs';
import {
  FitError,
  capacityOf,
  measureTree,
  standardGeometry,
  writeFat12Image,
  writeFat12ImageWithLayout,
} from './index';
import type { FileTree, StandardGeometryName, TreeNode } from './index';

// Small geometries only: keeps each run cheap (no 2.88 MB images).
const SMALL_GEOMETRIES: StandardGeometryName[] = ['160K', '180K', '320K', '360K', '720K', '1440K'];

const nameArb = fc.stringMatching(/^[A-Z][A-Z0-9]{0,7}$/);
const extArb = fc.stringMatching(/^[A-Z0-9]{0,3}$/);
const contentArb = fc.uint8Array({ minLength: 0, maxLength: 1500 });

function fileArb(): fc.Arbitrary<TreeNode> {
  return fc
    .record({ base: nameArb, ext: extArb, content: contentArb })
    .map(({ base, ext, content }) => ({
      kind: 'file' as const,
      name: ext.length > 0 ? `${base}.${ext}` : base,
      content,
    }));
}

function dirArb(): fc.Arbitrary<TreeNode> {
  return fc
    .record({ base: nameArb, kids: fc.array(fileArb(), { maxLength: 3 }) })
    .map(({ base, kids }) => ({
      kind: 'directory' as const,
      name: base,
      children: uniqueByName(kids),
    }));
}

function uniqueByName(nodes: TreeNode[]): TreeNode[] {
  const seen = new Set<string>();
  const out: TreeNode[] = [];
  for (const n of nodes) {
    const key = n.name.toUpperCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(n);
    }
  }
  return out;
}

const treeArb: fc.Arbitrary<FileTree> = fc
  .array(fc.oneof({ weight: 3, arbitrary: fileArb() }, { weight: 1, arbitrary: dirArb() }), {
    maxLength: 5,
  })
  .map((children) => ({ children: uniqueByName(children) }));

const caseArb = fc
  .tuple(treeArb, fc.constantFrom(...SMALL_GEOMETRIES))
  .filter(([tree, name]) => {
    const g = standardGeometry(name);
    const m = measureTree(tree, g);
    const c = capacityOf(g);
    return m.nameProblems.length === 0 && m.rootEntries <= c.rootEntries && m.clusters <= c.dataClusters;
  });

function u16(b: Uint8Array, o: number): number {
  return (b[o] as number) | ((b[o + 1] as number) << 8);
}

function fatEntry(image: Uint8Array, fatStart: number, n: number): number {
  const o = fatStart + Math.floor((n * 3) / 2);
  const v = u16(image, o);
  return n % 2 === 0 ? v & 0xfff : v >> 4;
}

function shortNameBytes(name: string): string {
  const dot = name.indexOf('.');
  const base = dot < 0 ? name : name.slice(0, dot);
  const ext = dot < 0 ? '' : name.slice(dot + 1);
  return base.padEnd(8, ' ') + ext.padEnd(3, ' ');
}

function contentOf(tree: FileTree, path: string): Uint8Array | undefined {
  const parts = path.split('/').filter((p) => p.length > 0);
  let level: TreeNode[] = tree.children;
  for (let i = 0; i < parts.length; i++) {
    const n = level.find((x) => x.name === parts[i]);
    if (n === undefined) return undefined;
    if (i === parts.length - 1) return n.kind === 'file' ? n.content : undefined;
    if (n.kind !== 'directory') return undefined;
    level = n.children;
  }
  return undefined;
}

function layoutIsValid(tree: FileTree, geoName: StandardGeometryName): boolean {
  const g = standardGeometry(geoName);
  const r = writeFat12ImageWithLayout(tree, geoName);
  const img = r.image;
  const o = r.offsets;

  if (img.length !== g.totalSectors * g.bytesPerSector) return false;

  // BPB at standard offsets
  if (u16(img, 11) !== g.bytesPerSector) return false;
  if (img[13] !== g.sectorsPerCluster) return false;
  if (u16(img, 14) !== g.reservedSectors) return false;
  if (img[16] !== g.fatCount) return false;
  if (u16(img, 17) !== g.rootEntryCount) return false;
  if (u16(img, 19) !== g.totalSectors) return false;
  if (img[21] !== g.mediaDescriptor) return false;
  if (u16(img, 22) !== g.sectorsPerFat) return false;
  if (img[510] !== 0x55 || img[511] !== 0xaa) return false;

  // Layout offsets derived independently from the geometry
  const fatBytes = g.sectorsPerFat * g.bytesPerSector;
  const rootBytes = g.rootEntryCount * 32;
  const fatStart = g.reservedSectors * g.bytesPerSector;
  const rootStart = fatStart + g.fatCount * fatBytes;
  const dataStart = rootStart + Math.ceil(rootBytes / g.bytesPerSector) * g.bytesPerSector;
  const clusterBytes = g.bytesPerSector * g.sectorsPerCluster;
  if (o.fatStart !== fatStart || o.rootStart !== rootStart || o.dataStart !== dataStart) return false;

  // FAT copies identical
  const first = img.subarray(fatStart, fatStart + fatBytes);
  for (let c = 1; c < g.fatCount; c++) {
    const other = img.subarray(fatStart + c * fatBytes, fatStart + (c + 1) * fatBytes);
    for (let i = 0; i < fatBytes; i++) if (first[i] !== other[i]) return false;
  }

  // Reserved FAT entries
  if (fatEntry(img, fatStart, 0) !== (0xf00 | g.mediaDescriptor)) return false;
  if (fatEntry(img, fatStart, 1) !== 0xfff) return false;

  for (const path of r.order) {
    const info = r.nodes.get(path);
    if (info === undefined) return false;
    if (info.deleted) continue;

    // Entry location and short name
    if (info.parentPath === '') {
      if (info.entryOffset < rootStart || info.entryOffset >= rootStart + rootBytes) return false;
    }
    const leaf = path.slice(path.lastIndexOf('/') + 1);
    let entryName = '';
    for (let i = 0; i < 11; i++) entryName += String.fromCharCode(img[info.entryOffset + i] as number);
    if (entryName !== shortNameBytes(leaf)) return false;

    // Chain: contiguous from start cluster, terminated by 0xFFF
    const content = info.kind === 'file' ? contentOf(tree, path) : undefined;
    if (info.kind === 'file') {
      if (content === undefined || info.size !== content.length) return false;
      if (content.length === 0) {
        if (info.startCluster !== 0 || info.clusters.length !== 0) return false;
        continue;
      }
      if (info.clusters.length !== Math.ceil(content.length / clusterBytes)) return false;
    }
    if (info.clusters.length === 0) return false;
    if (info.startCluster !== info.clusters[0]) return false;
    for (let i = 0; i < info.clusters.length; i++) {
      const c = info.clusters[i] as number;
      if (c < 2 || c >= 2 + o.dataClusters) return false;
      if (i > 0 && c !== (info.clusters[i - 1] as number) + 1) return false;
      const next = fatEntry(img, fatStart, c);
      const expected = i === info.clusters.length - 1 ? 0xfff : c + 1;
      if (next !== expected) return false;
    }

    // Data bytes
    if (content !== undefined) {
      const base = dataStart + ((info.clusters[0] as number) - 2) * clusterBytes;
      for (let i = 0; i < content.length; i++) if (img[base + i] !== content[i]) return false;
    }
  }
  return true;
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

describe('writer layout', () => {
  // Feature: fat12-core, Property 20: Writer layout is valid and deterministic
  // **Validates: Requirements 9.1, 9.3, 9.4, 9.10**
  it('Property 20: layout is valid and deterministic', () => {
    fc.assert(
      fc.property(caseArb, ([tree, geoName]) => {
        if (!layoutIsValid(tree, geoName)) return false;
        const a = writeFat12Image(tree, geoName);
        const b = writeFat12Image(tree, geoName);
        return sameBytes(a, b);
      }),
      { numRuns: numRuns(100) },
    );
  });
});

// ---- Property 21 helpers ----

type FitLimitName = FitError['limit'];

interface Overflow {
  tree: FileTree;
  geo: StandardGeometryName;
  limit: FitLimitName;
  /** Expected limitValue; undefined when not meaningful (name format). */
  limitValue: number | undefined;
}

function emptyFile(name: string): TreeNode {
  return { kind: 'file', name, content: new Uint8Array(0) };
}

const rootOverflowArb: fc.Arbitrary<Overflow> = fc
  .tuple(fc.constantFrom<StandardGeometryName>('160K', '180K', '320K', '360K'), fc.integer({ min: 1, max: 10 }))
  .map(([geo, extra]) => {
    const limit = standardGeometry(geo).rootEntryCount;
    const children: TreeNode[] = [];
    for (let i = 0; i < limit + extra; i++) children.push(emptyFile(`F${i}`));
    return { tree: { children }, geo, limit: 'root-entry-count' as const, limitValue: limit };
  });

const clusterOverflowArb: fc.Arbitrary<Overflow> = fc
  .tuple(fc.constant<StandardGeometryName>('160K'), fc.integer({ min: 1, max: 2000 }))
  .map(([geo, extraBytes]) => {
    const cap = capacityOf(standardGeometry(geo));
    const content = new Uint8Array(cap.dataBytes + extraBytes).fill(0x41);
    return {
      tree: { children: [{ kind: 'file' as const, name: 'BIG.BIN', content }] },
      geo,
      limit: 'data-cluster-count' as const,
      limitValue: cap.dataClusters,
    };
  });

const badNameArb: fc.Arbitrary<string[]> = fc.oneof(
  fc.stringMatching(/^[a-z]{1,8}$/).map((s) => [s]),
  fc.stringMatching(/^[A-Z]{9,14}$/).map((s) => [s]),
  fc.stringMatching(/^[A-Z]{1,8}\.[A-Z]{4,6}$/).map((s) => [s]),
  fc.stringMatching(/^[A-Z]{1,4}\.[A-Z]{1,3}\.[A-Z]{1,3}$/).map((s) => [s]),
  fc.constantFrom('', '.', '.TXT').map((s) => [s]),
  fc.stringMatching(/^[A-Z]{1,3} [A-Z]{1,3}$/).map((s) => [s]),
  fc.stringMatching(/^[A-Z][A-Z0-9]{0,7}$/).map((s) => [s, s]),
);

const nameOverflowArb: fc.Arbitrary<Overflow> = fc
  .tuple(
    fc.constantFrom<StandardGeometryName>('160K', '720K', '1440K'),
    badNameArb,
    fc.boolean(),
  )
  .map(([geo, names, nested]) => {
    const nodes: TreeNode[] = names.map((n) => emptyFile(n));
    const children: TreeNode[] = nested ? [{ kind: 'directory', name: 'SUB', children: nodes }] : nodes;
    return { tree: { children }, geo, limit: 'file-name-format' as const, limitValue: undefined };
  });

const overflowArb = fc.oneof(rootOverflowArb, clusterOverflowArb, nameOverflowArb);

function refusedCorrectly(c: Overflow): boolean {
  let image: Uint8Array | undefined;
  try {
    image = writeFat12Image(c.tree, c.geo);
  } catch (e) {
    if (!(e instanceof FitError)) return false;
    if (e.limit !== c.limit) return false;
    if (c.limitValue !== undefined) {
      if (e.limitValue !== c.limitValue) return false;
      if (e.requestedValue <= e.limitValue) return false;
    }
    return image === undefined;
  }
  return false;
}

describe('writer fit errors', () => {
  // Feature: fat12-core, Property 21: The writer refuses trees that do not fit
  // **Validates: Requirements 9.7, 9.2**
  it('Property 21: the writer refuses trees that do not fit', () => {
    fc.assert(
      fc.property(overflowArb, (c) => refusedCorrectly(c)),
      { numRuns: numRuns(100) },
    );
  });

  // Requirement 9.2: nesting up to 17 levels
  it('builds a 17-level directory chain with a file at the bottom on 1440K', () => {
    const names = Array.from({ length: 17 }, (_, i) => `D${i}`);
    let node: TreeNode = { kind: 'file', name: 'DEEP.TXT', content: new Uint8Array([1, 2, 3]) };
    for (let i = names.length - 1; i >= 0; i--) {
      node = { kind: 'directory', name: names[i] as string, children: [node] };
    }
    const tree: FileTree = { children: [node] };
    const r = writeFat12ImageWithLayout(tree, '1440K');
    const paths: string[] = [];
    for (let i = 1; i <= 17; i++) paths.push('/' + names.slice(0, i).join('/'));
    paths.push('/' + names.join('/') + '/DEEP.TXT');
    for (const p of paths) expect(r.nodes.has(p)).toBe(true);
    expect(r.nodes.get(paths[17] as string)?.kind).toBe('file');
  });
});
