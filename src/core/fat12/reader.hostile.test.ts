import * as fc from 'fast-check';
import { describe, it } from 'vitest';
import { fittedTreeArb } from '../../test-support/fat12/arbitraries';
import type { FittedTree } from '../../test-support/fat12/arbitraries';
import { writeFat12Image, writeFat12ImageWithLayout } from '../../test-support/fat12';
import type { DamageSpec, FileNode, FileTree, TreeNode } from '../../test-support/fat12';
import { encodeShortName, writeFatEntry } from '../../test-support/fat12/encode';
import { hostileImageArb, oversizedImageArb } from '../../test-support/hostile';
import { numRuns } from '../../test-support/runs';
import { timed } from '../../test-support/timed';
import {
  GraveKind,
  GraveState,
  MAX_DIR_DEPTH,
  MAX_FILE_OUTPUT_BYTES,
  MAX_REASON_CHARS,
  MAX_TOTAL_ENTRIES,
  WarningCode,
  openDisk,
  readDisk,
  readGraveBytes,
} from './index';
import type { Grave, ReadResult } from './index';

const STATES: readonly string[] = Object.values(GraveState);
const KINDS: readonly string[] = Object.values(GraveKind);
const CODES: readonly string[] = Object.values(WarningCode);

/** Structural equality for JSON-like values (no expect inside properties). */
function deepEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  const ra = a as Record<string, unknown>;
  const rb = b as Record<string, unknown>;
  return ka.every((k) => Object.prototype.hasOwnProperty.call(rb, k) && deepEq(ra[k], rb[k]));
}

function badComponent(c: string): boolean {
  if (c === '' || c === '.' || c === '..') return true;
  for (let i = 0; i < c.length; i++) {
    const code = c.charCodeAt(i);
    if (code < 0x20 || code === 0x7f || c[i] === '\\' || c[i] === '/') return true;
  }
  return false;
}

describe('Property 2: Report invariants', () => {
  // Feature: fat12-core, Property 2: Report invariants
  // **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.9, 6.8, 6.10, 6.12, 7.4, 11.7, 11.8**
  //
  // Timing: only readDisk is inside timed(); all checks run after it stops.
  it(
    'every report satisfies the structural invariants',
    () => {
      fc.assert(
        fc.property(hostileImageArb, ({ image }) => {
          const report = timed(() => readDisk(image));

          const keys = Object.keys(report).sort().join(',');
          if (keys !== 'files,volume,warnings') return false;
          if (report.files.length > MAX_TOTAL_ENTRIES) return false;

          const dirPaths = new Set<string>();
          for (let i = 0; i < report.files.length; i++) {
            const g = report.files[i];
            if (g.id !== i) return false;
            const p = g.path;
            if (typeof p !== 'string' || !p.startsWith('/') || p.length < 2 || p.endsWith('/')) {
              return false;
            }
            const comps = p.slice(1).split('/');
            if (comps.length > MAX_DIR_DEPTH) return false;
            if (comps.some(badComponent)) return false;
            if (!Number.isInteger(g.size) || g.size < 0 || g.size > 4_294_967_295) return false;
            if (!STATES.includes(g.state) || !KINDS.includes(g.kind)) return false;
            if (g.state === 'alive') {
              if (g.reason !== undefined) return false;
            } else if (
              typeof g.reason !== 'string' ||
              g.reason.length < 1 ||
              g.reason.length > MAX_REASON_CHARS
            ) {
              return false;
            }
            if (comps.length >= 2) {
              const parent = '/' + comps.slice(0, -1).join('/');
              if (!dirPaths.has(parent)) return false;
            }
            if (g.kind === 'directory') dirPaths.add(p);
          }

          let entryLimit = 0;
          for (const w of report.warnings) {
            if (!CODES.includes(w.code)) return false;
            if (typeof w.message !== 'string' || w.message.length > MAX_REASON_CHARS) return false;
            if (w.path !== undefined && typeof w.path !== 'string') return false;
            if (w.code === 'entry-limit') entryLimit++;
          }
          if (entryLimit > 1) return false;

          return deepEq(JSON.parse(JSON.stringify(report)), report);
        }),
        { numRuns: numRuns(100) },
      );
    },
    300_000,
  );
});

describe('Property 1: Totality on hostile input', () => {
  // Feature: fat12-core, Property 1: Totality on hostile input
  // **Validates: Requirements 2.1, 2.5, 2.10, 5.1, 11.3, 11.5**
  //
  // Timing: the image is generated before the callback runs; only the readDisk
  // call is inside timed(). A budget overrun makes timed() throw, and that
  // error is deliberately NOT caught so fc.assert reports the elapsed ms.
  // Any other throw from the reader is a totality violation: return false.
  it(
    'readDisk returns a well-formed DiskReport without throwing or internal-error',
    () => {
      fc.assert(
        fc.property(hostileImageArb, ({ image, expectWarning }) => {
          let report: ReturnType<typeof readDisk>;
          try {
            report = timed(() => readDisk(image));
          } catch (e) {
            if (e instanceof Error && e.message.startsWith('Time budget exceeded')) throw e;
            return false;
          }
          if (typeof report !== 'object' || report === null) return false;
          if (typeof report.volume !== 'object' || report.volume === null) return false;
          if (!Array.isArray(report.files) || !Array.isArray(report.warnings)) return false;
          if (report.warnings.some((w) => (w.code as string) === 'internal-error')) return false;
          if (expectWarning && report.warnings.length === 0) return false;
          return true;
        }),
        { numRuns: numRuns(100) },
      );
    },
    300_000,
  );
});

describe('Property 4: Oversized images are rejected unparsed', () => {
  // Feature: fat12-core, Property 4: Oversized images are rejected unparsed
  // **Validates: Requirements 2.2**
  //
  // Timing: all arrays are built before the timer; only each readDisk call is
  // inside timed(). "Unparsed" is shown by two same-length images with totally
  // different contents (all zero vs. a valid 1.44 MB BPB planted in sector 0)
  // producing deep-equal reports.
  it(
    'yields no files and one image-too-large warning, regardless of content',
    () => {
      fc.assert(
        fc.property(oversizedImageArb, ({ image }) => {
          const zeros = new Uint8Array(image.length);
          const planted = new Uint8Array(image.length);
          planted.set([0xeb, 0x3c, 0x90], 0);
          planted[11] = 0x00; planted[12] = 0x02; // 512 bytes/sector
          planted[13] = 1; // sectors/cluster
          planted[14] = 1; planted[15] = 0; // reserved sectors
          planted[16] = 2; // FATs
          planted[17] = 224; planted[18] = 0; // root entries
          planted[19] = 0x40; planted[20] = 0x0b; // 2880 sectors
          planted[21] = 0xf0; // media
          planted[22] = 9; planted[23] = 0; // sectors/FAT
          planted[510] = 0x55; planted[511] = 0xaa;

          const report = timed(() => readDisk(image));
          const repZeros = timed(() => readDisk(zeros));
          const repPlanted = timed(() => readDisk(planted));

          for (const r of [report, repZeros, repPlanted]) {
            if (r.files.length !== 0) return false;
            if (r.warnings.length !== 1) return false;
            if (r.warnings[0].code !== 'image-too-large') return false;
            if (r.volume.geometrySource !== 'none' || r.volume.geometry !== null) return false;
          }
          return deepEq(repZeros, repPlanted) && deepEq(report, repZeros);
        }),
        { numRuns: numRuns(100) },
      );
    },
    300_000,
  );
});

/** Paths of live files with at least one byte of content. */
function nonEmptyFilePaths(tree: FileTree): string[] {
  const out: string[] = [];
  const walk = (nodes: TreeNode[], parent: string): void => {
    for (const n of nodes) {
      const p = `${parent}/${n.name}`;
      if (n.kind === 'directory') walk(n.children, p);
      else if ((n as FileNode).content.length >= 1 && n.deleted !== true) out.push(p);
    }
  };
  walk(tree.children, '');
  return out;
}

function sameRead(a: ReadResult, b: ReadResult): boolean {
  if (a.ok !== b.ok) return false;
  if (!a.ok || !b.ok) return !a.ok && !b.ok && a.error === b.error;
  if (a.bytes.length !== b.bytes.length) return false;
  for (let i = 0; i < a.bytes.length; i++) if (a.bytes[i] !== b.bytes[i]) return false;
  return true;
}

function sameGrave(a: Grave, b: Grave): boolean {
  return (
    a.path === b.path &&
    a.kind === b.kind &&
    a.size === b.size &&
    a.state === b.state &&
    a.reason === b.reason &&
    a.date === b.date &&
    deepEq(a.attributes, b.attributes)
  );
}

interface VictimCase {
  fitted: FittedTree;
  victimSel: number;
  damageSel: number;
}

const victimCaseArb: fc.Arbitrary<VictimCase> = fc.record({
  fitted: fittedTreeArb.filter((f) => nonEmptyFilePaths(f.tree).length >= 2),
  victimSel: fc.nat({ max: 10_000 }),
  damageSel: fc.nat({ max: 3 }),
});

const DAMAGES: ReadonlyArray<{
  specs: (path: string) => DamageSpec[];
  codes: readonly string[];
}> = [
  {
    specs: (path) => [
      { type: 'cyclic-chain', path },
      { type: 'size-exceeds-chain', path, extraBytes: 1 },
    ],
    codes: ['chain-cycle'],
  },
  {
    specs: (path) => [
      { type: 'cluster-out-of-range', path },
      { type: 'size-exceeds-chain', path, extraBytes: 1 },
    ],
    codes: ['cluster-out-of-range'],
  },
  {
    specs: (path) => [{ type: 'size-exceeds-chain', path, extraBytes: 1 }],
    codes: ['chain-short'],
  },
  {
    specs: (path) => [{ type: 'size-exceeds-chain', path, extraBytes: 0xffffffff }],
    codes: ['size-exceeds-disk'],
  },
];

describe('Property 17: A damaged file is isolated', () => {
  // Feature: fat12-core, Property 17: A damaged file is isolated
  // **Validates: Requirements 2.4, 2.11, 5.2, 5.3, 5.6, 5.8, 5.9, 5.10, 9.6, 11.4**
  //
  // Timing: both images are built by the writer before any timer starts. Only
  // the reader calls on the DAMAGED image are inside timed(); the undamaged
  // reads used for comparison are untimed. Budget errors propagate.
  it(
    'damage to one file leaves every other file unchanged',
    () => {
      fc.assert(
        fc.property(victimCaseArb, ({ fitted, victimSel, damageSel }) => {
          const paths = nonEmptyFilePaths(fitted.tree);
          const victim = paths[victimSel % paths.length] as string;
          const damage = DAMAGES[damageSel] as (typeof DAMAGES)[number];

          const clean = writeFat12Image(fitted.tree, fitted.geometryName);
          const damaged = writeFat12ImageWithLayout(fitted.tree, fitted.geometryName, {
            damage: damage.specs(victim),
          }).image;

          const cleanReport = readDisk(clean);
          const report = timed(() => readDisk(damaged));

          if (report.warnings.some((w) => (w.code as string) === 'internal-error')) return false;
          if (!report.warnings.some((w) => w.path === victim && damage.codes.includes(w.code))) {
            return false;
          }
          if (report.files.length !== cleanReport.files.length) return false;

          const cleanByPath = new Map(cleanReport.files.map((g) => [g.path, g]));
          let victimFound = false;
          for (const g of report.files) {
            const before = cleanByPath.get(g.path);
            if (before === undefined) return false;

            let result: ReadResult;
            try {
              result = timed(() => readGraveBytes(damaged, g));
            } catch (e) {
              if (e instanceof Error && e.message.startsWith('Time budget exceeded')) throw e;
              return false;
            }

            if (g.path === victim) {
              victimFound = true;
              if (g.state !== 'partial' && g.state !== 'lost') return false;
              if (typeof g.reason !== 'string' || g.reason.length < 1) return false;
              if (result.ok && result.bytes.length > Math.min(g.size, MAX_FILE_OUTPUT_BYTES)) {
                return false;
              }
              continue;
            }
            if (!sameGrave(g, before)) return false;
            if (!sameRead(result, readGraveBytes(clean, before))) return false;
          }
          return victimFound;
        }),
        { numRuns: numRuns(100) },
      );
    },
    300_000,
  );
});

// ---------------------------------------------------------------------------
// Property 18 helpers
// ---------------------------------------------------------------------------

type ExpectedState = 'alive' | 'partial';

const baseNameArb = fc
  .array(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')), { minLength: 1, maxLength: 5 })
  .map((cs) => cs.join(''));

function mkFile(name: string): FileNode {
  return { kind: 'file', name, content: new Uint8Array([1, 2, 3]) };
}

function mkDir(name: string, children: TreeNode[]): TreeNode {
  return { kind: 'directory', name, children };
}

function setStartCluster(image: Uint8Array, entryOffset: number, cluster: number): void {
  image[entryOffset + 26] = cluster & 0xff;
  image[entryOffset + 27] = (cluster >> 8) & 0xff;
}

/** Common checks plus an exact path -> state comparison of the report's files. */
function structureOk(
  report: ReturnType<typeof readDisk>,
  expected: Map<string, ExpectedState>,
): boolean {
  if (report.warnings.some((w) => (w.code as string) === 'internal-error')) return false;
  if (report.files.length > MAX_TOTAL_ENTRIES) return false;
  if (report.files.length !== expected.size) return false;
  for (const g of report.files) {
    if (g.path.slice(1).split('/').length > MAX_DIR_DEPTH) return false;
    if (expected.get(g.path) !== g.state) return false;
    if (g.state === 'partial' && (typeof g.reason !== 'string' || g.reason.length < 1)) return false;
  }
  return true;
}

function warningsWith(report: ReturnType<typeof readDisk>, code: string) {
  return report.warnings.filter((w) => w.code === code);
}

const dirPathOf = (names: string[], k: number): string =>
  k === 0 ? '' : '/' + names.slice(0, k).join('/');

describe('Property 18: Directory structure limits hold', () => {
  // Feature: fat12-core, Property 18: Directory structure limits hold
  // **Validates: Requirements 2.6, 6.5, 6.6, 6.7, 9.6, 11.4**
  //
  // Timing: every image is built before the timer; only readDisk is inside
  // timed(). Budget errors propagate (nothing here catches them).

  // Family 1: nesting depth.
  it(
    'nesting beyond 16 components is cut off with exactly one depth-exceeded',
    () => {
      const arb = fc.record({
        d: fc.integer({ min: 1, max: 24 }),
        bases: fc.array(baseNameArb, { minLength: 24, maxLength: 24 }),
        fileAt: fc.array(fc.boolean(), { minLength: 25, maxLength: 25 }),
      });
      fc.assert(
        fc.property(arb, ({ d, bases, fileAt }) => {
          const names = bases.map((b, i) => `${b}${i + 1}`);
          const level = (k: number): TreeNode[] => {
            const out: TreeNode[] = [];
            if (fileAt[k]) out.push(mkFile(`F${k}.TXT`));
            if (k < d) out.push(mkDir(names[k] as string, level(k + 1)));
            return out;
          };
          const image = writeFat12Image({ children: level(0) }, '1440K');

          const expected = new Map<string, ExpectedState>();
          for (let k = 0; k <= Math.min(d, 15); k++) {
            if (fileAt[k]) expected.set(`${dirPathOf(names, k)}/F${k}.TXT`, 'alive');
          }
          for (let j = 1; j <= Math.min(d, 16); j++) {
            expected.set(dirPathOf(names, j), j === 16 ? 'partial' : 'alive');
          }

          const report = timed(() => readDisk(image));

          if (!structureOk(report, expected)) return false;
          const depthWarnings = warningsWith(report, 'depth-exceeded');
          if (d >= 16) {
            return depthWarnings.length === 1 && depthWarnings[0]?.path === dirPathOf(names, 16);
          }
          return depthWarnings.length === 0;
        }),
        { numRuns: numRuns(100) },
      );
    },
    300_000,
  );

  // Family 2: a child directory pointing back at an ancestor.
  it(
    'a directory pointing at an ancestor is reported once as directory-loop and not listed',
    () => {
      const arb = fc.record({
        r: fc.integer({ min: 1, max: 5 }),
        bases: fc.array(baseNameArb, { minLength: 5, maxLength: 5 }),
        ancestorSel: fc.nat({ max: 1000 }),
        useDamage: fc.boolean(),
      });
      fc.assert(
        fc.property(arb, ({ r, bases, ancestorSel, useDamage }) => {
          const names = bases.slice(0, r).map((b, i) => `${b}${i + 1}`);
          const build = (k: number): TreeNode[] => {
            const own = mkFile('L.TXT');
            if (k === r) {
              return [
                mkDir('X', [mkFile('KID.TXT')]),
                mkFile('SIB.TXT'),
                mkDir('SIBD', [mkFile('IN.TXT')]),
                own,
              ];
            }
            return [mkDir(names[k] as string, build(k + 1)), own];
          };
          const a = 1 + (ancestorSel % r); // ancestor depth, 1..r
          const container = dirPathOf(names, r);
          const xPath = `${container}/X`;

          const damage: DamageSpec[] =
            useDamage && a === r ? [{ type: 'self-referencing-directory', path: container }] : [];
          const layout = writeFat12ImageWithLayout({ children: build(0) }, '1440K', { damage });
          if (damage.length === 0) {
            const x = layout.nodes.get(xPath);
            const anc = layout.nodes.get(dirPathOf(names, a));
            if (x === undefined || anc === undefined) return false;
            setStartCluster(layout.image, x.entryOffset, anc.startCluster);
          }
          const image = layout.image;

          const expected = new Map<string, ExpectedState>();
          for (let k = 1; k <= r; k++) {
            expected.set(dirPathOf(names, k), 'alive');
            expected.set(`${dirPathOf(names, k)}/L.TXT`, 'alive');
          }
          expected.set(xPath, 'partial');
          expected.set(`${container}/SIB.TXT`, 'alive');
          expected.set(`${container}/SIBD`, 'alive');
          expected.set(`${container}/SIBD/IN.TXT`, 'alive');
          expected.set('/L.TXT', 'alive');

          const report = timed(() => readDisk(image));

          if (!structureOk(report, expected)) return false;
          const loops = warningsWith(report, 'directory-loop');
          if (loops.length !== 1 || loops[0]?.path !== xPath) return false;
          return warningsWith(report, 'directory-duplicate').length === 0;
        }),
        { numRuns: numRuns(100) },
      );
    },
    300_000,
  );

  // Family 3: two entries on different branches pointing at one cluster.
  it(
    'the later of two entries sharing a cluster is directory-duplicate and not listed twice',
    () => {
      const arb = fc.record({
        extraA: fc.array(baseNameArb, { minLength: 0, maxLength: 2 }),
        extraB: fc.array(baseNameArb, { minLength: 0, maxLength: 2 }),
        rootFile: fc.boolean(),
      });
      fc.assert(
        fc.property(arb, ({ extraA, extraB, rootFile }) => {
          const namesA = ['TA', ...extraA.map((b, i) => `${b}${i + 1}`)];
          const namesB = ['TB', ...extraB.map((b, i) => `${b}${i + 1}`)];
          const chain = (names: string[]): TreeNode => {
            let node = mkDir(names[names.length - 1] as string, [mkFile('IN.TXT')]);
            for (let i = names.length - 2; i >= 0; i--) node = mkDir(names[i] as string, [node]);
            return node;
          };
          const children: TreeNode[] = [chain(namesA), chain(namesB)];
          if (rootFile) children.push(mkFile('ROOT.TXT'));

          const layout = writeFat12ImageWithLayout({ children }, '1440K');
          const first = layout.nodes.get(dirPathOf(namesA, namesA.length));
          const second = layout.nodes.get(dirPathOf(namesB, namesB.length));
          if (first === undefined || second === undefined) return false;
          setStartCluster(layout.image, second.entryOffset, first.startCluster);
          const image = layout.image;

          const expected = new Map<string, ExpectedState>();
          for (let k = 1; k <= namesA.length; k++) expected.set(dirPathOf(namesA, k), 'alive');
          expected.set(`${dirPathOf(namesA, namesA.length)}/IN.TXT`, 'alive');
          for (let k = 1; k <= namesB.length; k++) {
            expected.set(dirPathOf(namesB, k), k === namesB.length ? 'partial' : 'alive');
          }
          if (rootFile) expected.set('/ROOT.TXT', 'alive');

          const report = timed(() => readDisk(image));

          if (!structureOk(report, expected)) return false;
          const dups = warningsWith(report, 'directory-duplicate');
          if (dups.length !== 1 || dups[0]?.path !== dirPathOf(namesB, namesB.length)) return false;
          return warningsWith(report, 'directory-loop').length === 0;
        }),
        { numRuns: numRuns(100) },
      );
    },
    300_000,
  );
});

// ---------------------------------------------------------------------------
// Property 19 helpers
// ---------------------------------------------------------------------------

const RECORD_BYTES = 32;
const RECORDS_PER_CLUSTER = 16; // 1440K: 512-byte clusters
const ROOT_SLOTS = 224;

/** Record kinds: 0 normal empty file, 1 deleted file, 2 volume label, 3 LFN-like. */
function kindOf(i: number, seed: number): number {
  const h = Math.imul(i + 1, 2654435761) ^ Math.imul(seed + 1, 40503);
  return (h >>> 28) & 3;
}

function entryLimitRecord(kind: number, name: string): Uint8Array {
  const r = new Uint8Array(RECORD_BYTES);
  if (kind === 0) {
    r.set(encodeShortName(name), 0);
    r[11] = 0x20;
  } else if (kind === 1) {
    r.set(encodeShortName('DEL'), 0);
    r[0] = 0xe5;
    r[11] = 0x20;
  } else if (kind === 2) {
    r.set(encodeShortName('VOL'), 0);
    r[11] = 0x08;
  } else {
    r[0] = 0x41;
    r[11] = 0x0f;
  }
  return r;
}

interface EntryLimitCase {
  image: Uint8Array;
  /** Records the reader examines, counted exactly as decision 5 defines them. */
  examined: number;
  expectedPaths: Set<string>;
}

function buildEntryLimitCase(f: number, big: number, seed: number): EntryLimitCase {
  const base = writeFat12ImageWithLayout({ children: [] }, '1440K');
  const { image, offsets } = base;
  const expectedPaths = new Set<string>();

  // Root: f filler records, then BIG, then (if a slot is left) a zero terminator.
  for (let i = 0; i < f; i++) {
    const kind = kindOf(i, seed);
    image.set(entryLimitRecord(kind, `F${i}`), offsets.rootStart + i * RECORD_BYTES);
    if (kind <= 1) expectedPaths.add(kind === 0 ? `/F${i}` : '*deleted');
  }
  const clusters = Math.ceil(big / RECORDS_PER_CLUSTER);
  const bigEntry = new Uint8Array(RECORD_BYTES);
  bigEntry.set(encodeShortName('BIG'), 0);
  bigEntry[11] = 0x10;
  bigEntry[26] = 2;
  image.set(bigEntry, offsets.rootStart + f * RECORD_BYTES);
  expectedPaths.add('/BIG');

  // BIG: '.', '..', then (big - 2) mixed records; unused slots stay 0x00.
  for (let j = 0; j < big; j++) {
    let r: Uint8Array;
    if (j < 2) {
      r = new Uint8Array(RECORD_BYTES);
      r.fill(0x20, 0, 11);
      r.set(new TextEncoder().encode(j === 0 ? '.' : '..'), 0);
      r[11] = 0x10;
      r[26] = j === 0 ? 2 : 0;
    } else {
      const kind = kindOf(f + j, seed);
      r = entryLimitRecord(kind, `G${j}`);
      if (kind <= 1) expectedPaths.add(kind === 0 ? `/BIG/G${j}` : '*deleted');
    }
    image.set(r, offsets.dataStart + j * RECORD_BYTES);
  }

  // FAT chain 2 .. clusters+1 in every copy.
  for (let copy = 0; copy < offsets.fatCount; copy++) {
    const start = offsets.fatStart + copy * offsets.fatBytes;
    const fat = image.subarray(start, start + offsets.fatBytes);
    for (let c = 2; c < clusters + 2; c++) writeFatEntry(fat, c, c === clusters + 1 ? 0xfff : c + 1);
  }

  const rootReads = f + 1 + (f + 1 < ROOT_SLOTS ? 1 : 0);
  const bigReads = big + (big % RECORDS_PER_CLUSTER !== 0 ? 1 : 0);
  return { image, examined: rootReads + bigReads, expectedPaths };
}

// ---------------------------------------------------------------------------
// Property 12 (reader part): fill-pattern directory regions
// ---------------------------------------------------------------------------

/** Slot kinds: 0 keep the real record, 1 `E5 F6...`, 2 `E5 00...`, 3 noise, 4 `E5` + mixed tail. */
const fillSlotArb = fc.record({
  kind: fc.nat({ max: 4 }),
  noise: fc.uint8Array({ minLength: RECORD_BYTES, maxLength: RECORD_BYTES }),
});

function applySlots(
  image: Uint8Array,
  regionStart: number,
  slots: ReadonlyArray<{ kind: number; noise: Uint8Array }>,
): void {
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i] as { kind: number; noise: Uint8Array };
    const at = regionStart + i * RECORD_BYTES;
    if (s.kind === 0) continue;
    if (s.kind === 3) {
      image.set(s.noise, at);
      continue;
    }
    image[at] = 0xe5;
    if (s.kind === 1) image.fill(0xf6, at + 1, at + RECORD_BYTES);
    else if (s.kind === 2) image.fill(0x00, at + 1, at + RECORD_BYTES);
    else image.set(s.noise.subarray(1), at + 1);
  }
}

describe('Property 12: Totality on hostile input', () => {
  // Feature: real-disk-hardening, Property 12: Totality on hostile input
  // **Validates: Requirements 3.8, 11.4**
  //
  // Timing: images are built before the timer; only openDisk is inside timed().
  it(
    'directory regions of E5 F6 / E5 00 fills mixed with real entries and noise never break openDisk',
    () => {
      const arb = fc.record({
        rootSlots: fc.array(fillSlotArb, { minLength: 0, maxLength: ROOT_SLOTS }),
        subSlots: fc.array(fillSlotArb, { minLength: 0, maxLength: RECORDS_PER_CLUSTER }),
        neverUsed: fc.array(
          fc.record({
            beforeChild: fc.nat({ max: 3 }),
            fill: fc.constantFrom<'f6' | 'zero'>('f6', 'zero'),
          }),
          { maxLength: 3 },
        ),
      });
      fc.assert(
        fc.property(arb, ({ rootSlots, subSlots, neverUsed }) => {
          const tree: FileTree = {
            children: [
              mkFile('A.TXT'),
              { kind: 'directory', name: 'SUB', children: [mkFile('B.TXT'), mkFile('C.TXT')] },
              mkFile('D.TXT'),
            ],
            slots: neverUsed.map((s) => ({ beforeChild: Math.min(s.beforeChild, 3), fill: s.fill })),
          };
          const layout = writeFat12ImageWithLayout(tree, '1440K');
          const image = layout.image;
          const { offsets } = layout;
          applySlots(image, offsets.rootStart, rootSlots);
          const sub = layout.nodes.get('/SUB');
          if (sub !== undefined) {
            applySlots(image, offsets.dataStart + (sub.startCluster - 2) * 512, subSlots);
          }
          const before = image.slice();

          let report: ReturnType<typeof readDisk>;
          let results: ReadResult[] = [];
          try {
            const handle = timed(() => openDisk(image));
            report = handle.report;
            results = report.files.map((g) => timed(() => handle.readBytes(g)));
          } catch (e) {
            if (e instanceof Error && e.message.startsWith('Time budget exceeded')) throw e;
            return false;
          }

          if (report.warnings.some((w) => (w.code as string) === 'internal-error')) return false;
          if (report.files.length > MAX_TOTAL_ENTRIES) return false;
          for (const r of results) {
            if (r.ok && r.bytes.length > MAX_FILE_OUTPUT_BYTES) return false;
          }
          if (image.length !== before.length) return false;
          for (let i = 0; i < image.length; i++) if (image[i] !== before[i]) return false;
          return true;
        }),
        { numRuns: numRuns(100) },
      );
    },
    300_000,
  );
});

describe('Property 19: Entry limit', () => {
  // Feature: fat12-core, Property 19: Entry limit
  // **Validates: Requirements 6.8, 11.8**
  //
  // Timing: every image is built before the timer; only readDisk is inside
  // timed(). Budget errors propagate.
  it(
    'warns exactly once iff more than 4096 records are examined, and never lists more than 4096 entries',
    () => {
      const targetArb = fc.oneof(
        { weight: 8, arbitrary: fc.integer({ min: 4090, max: 4102 }) },
        { weight: 1, arbitrary: fc.integer({ min: 20, max: 4089 }) },
        { weight: 1, arbitrary: fc.integer({ min: 4103, max: 6000 }) },
      );
      const arb = fc.record({
        f: fc.integer({ min: 0, max: ROOT_SLOTS - 1 }),
        target: targetArb,
        seed: fc.nat({ max: 1_000_000 }),
      });
      fc.assert(
        fc.property(arb, ({ f, target, seed }) => {
          const big = Math.max(2, target - f - 3);
          const { image, examined, expectedPaths } = buildEntryLimitCase(f, big, seed);

          const report = timed(() => readDisk(image));

          if (report.warnings.some((w) => (w.code as string) === 'internal-error')) return false;
          const limitWarnings = report.warnings.filter((w) => w.code === 'entry-limit');
          if (report.files.length > MAX_TOTAL_ENTRIES) return false;
          if (examined > MAX_TOTAL_ENTRIES) return limitWarnings.length === 1;
          if (limitWarnings.length !== 0) return false;

          // No limit hit: every normal entry plus BIG is reported, and the
          // total matches (normal + deleted entries + BIG).
          const paths = new Set(report.files.map((g) => g.path));
          for (const p of expectedPaths) if (p !== '*deleted' && !paths.has(p)) return false;
          let expectedCount = 0;
          for (let i = 0; i < f; i++) if (kindOf(i, seed) <= 1) expectedCount++;
          for (let j = 2; j < big; j++) if (kindOf(f + j, seed) <= 1) expectedCount++;
          return report.files.length === expectedCount + 1;
        }),
        { numRuns: numRuns(100) },
      );
    },
    300_000,
  );
});
