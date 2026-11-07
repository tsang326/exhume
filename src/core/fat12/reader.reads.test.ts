import * as fc from 'fast-check';
import { describe, it } from 'vitest';
import { MAX_FILE_OUTPUT_BYTES, openDisk, readDisk, readGraveBytes } from './index';
import type { Grave, ReadResult } from './index';
import { fittedTreeArb } from '../../test-support/fat12/arbitraries';
import { writeFat12Image } from '../../test-support/fat12/index';
import type { FileTree, TreeNode } from '../../test-support/fat12/index';
import {
  dirNoiseArb,
  fatNoiseArb,
  hostileImageArb,
  mutatedImageArb,
  targetedDefectArb,
} from '../../test-support/hostile';
import { numRuns } from '../../test-support/runs';
import { timed } from '../../test-support/timed';

/** Cap on Graves read per image, to keep runs fast. */
const MAX_GRAVES_PER_IMAGE = 64;

/** Marks files deleted by a running file index into `mask` (wrapping); directories stay live. */
function markDeleted(nodes: TreeNode[], mask: boolean[], counter: { n: number }): TreeNode[] {
  return nodes.map((node): TreeNode => {
    if (node.kind === 'file') {
      const del = mask.length > 0 && mask[counter.n % mask.length] === true;
      counter.n++;
      return del ? { ...node, deleted: true } : node;
    }
    return { ...node, children: markDeleted(node.children, mask, counter) };
  });
}

/** Valid or partly deleted writer images. */
const writerImageArb: fc.Arbitrary<Uint8Array> = fc
  .tuple(fittedTreeArb, fc.array(fc.boolean(), { minLength: 1, maxLength: 32 }))
  .map(([{ tree, geometryName }, mask]) => {
    const marked: FileTree = { ...tree, children: markDeleted(tree.children, mask, { n: 0 }) };
    return writeFat12Image(marked, geometryName);
  });

/** Hostile images (the oversized family has no files, so it is left to hostileImageArb's own mix) and writer images. */
const imageArb: fc.Arbitrary<Uint8Array> = fc.oneof(
  { weight: 3, arbitrary: hostileImageArb.map((h) => h.image) },
  { weight: 2, arbitrary: targetedDefectArb.map((h) => h.image) },
  { weight: 2, arbitrary: mutatedImageArb.map((h) => h.image) },
  { weight: 1, arbitrary: fatNoiseArb.map((h) => h.image) },
  { weight: 1, arbitrary: dirNoiseArb.map((h) => h.image) },
  { weight: 4, arbitrary: writerImageArb },
);

describe('reader reads: bounded file reads', () => {
  it('Property 15: File reads are bounded', () => {
    // Feature: fat12-core, Property 15: File reads are bounded
    // **Validates: Requirements 1.7, 5.7, 8.9, 11.6**
    fc.assert(
      fc.property(imageArb, (image) => {
        // Image generation and readDisk happen outside the timer.
        const report = readDisk(image);
        const graves = report.files.slice(0, MAX_GRAVES_PER_IMAGE);
        for (const grave of graves) {
          // Only the readGraveBytes call is timed; a budget overrun propagates.
          const r = timed(() => readGraveBytes(image, grave));
          if (r.ok) {
            if (!(r.bytes instanceof Uint8Array)) return false;
            if (r.bytes.length > Math.min(grave.size, MAX_FILE_OUTPUT_BYTES)) return false;
          } else if (typeof r.error !== 'string') {
            return false;
          }
        }
        return true;
      }),
      { numRuns: numRuns(100) },
    );
  });
});

const ERR_NOT_FOUND = 'grave not found in this disk image';
const ERR_DIRECTORY = 'directory has no file bytes';
const ERR_LOST = 'data is not recoverable';

/** A deleted file placed onto a live file's clusters: the deleted Grave is lost. */
const reusedClusterImageArb: fc.Arbitrary<Uint8Array> = fc
  .tuple(
    fc.integer({ min: 1, max: 3000 }),
    fc.integer({ min: 1, max: 3000 }),
    fc.boolean(),
  )
  .map(([liveLen, deadLen, withDir]) => {
    const children: TreeNode[] = [
      { kind: 'file', name: 'LIVE.BIN', content: new Uint8Array(liveLen).fill(0x41) },
      {
        kind: 'file',
        name: 'DEAD.BIN',
        content: new Uint8Array(deadLen).fill(0x42),
        deleted: true,
        placement: { startCluster: 2 },
      },
    ];
    if (withDir) children.push({ kind: 'directory', name: 'SUB', children: [] });
    return writeFat12Image({ children }, '1440K');
  });

const failImageArb: fc.Arbitrary<Uint8Array> = fc.oneof(
  { weight: 3, arbitrary: imageArb },
  { weight: 2, arbitrary: reusedClusterImageArb },
);

const FORGE_KINDS = [
  'id-out-of-range',
  'id-negative',
  'id-nan',
  'id-fraction',
  'path',
  'size',
  'start',
  'kind',
  'empty-object',
  'null',
] as const;

/** A forged Grave (typed as Grave for the call) that must not match any record, or null to skip. */
function forge(real: Grave, count: number, how: (typeof FORGE_KINDS)[number]): Grave | null {
  const raw: unknown = (() => {
    switch (how) {
      case 'id-out-of-range':
        return { ...real, id: count + 1 };
      case 'id-negative':
        return { ...real, id: -1 };
      case 'id-nan':
        return { ...real, id: Number.NaN };
      case 'id-fraction':
        return { ...real, id: real.id + 0.5 };
      case 'path':
        return { ...real, path: real.path + '/x' };
      case 'size':
        return { ...real, size: real.size + 1 };
      case 'start':
        return { ...real, startCluster: real.startCluster + 1 };
      case 'kind':
        return { ...real, kind: real.kind === 'file' ? 'directory' : 'file' };
      case 'empty-object':
        return {};
      case 'null':
        return null;
    }
  })();
  return raw as Grave;
}

describe('reader reads: failed reads', () => {
  it('Property 16: Failed reads are failures, not exceptions', () => {
    // Feature: fat12-core, Property 16: Failed reads are failures, not exceptions
    // **Validates: Requirements 1.8, 8.10, 8.13**
    fc.assert(
      fc.property(
        failImageArb,
        fc.array(fc.constantFrom(...FORGE_KINDS), { minLength: 1, maxLength: 4 }),
        (image, hows) => {
          const before = new Uint8Array(image);
          const handle = openDisk(image);
          const reportBefore = JSON.stringify(handle.report);
          const graves = handle.report.files.slice(0, MAX_GRAVES_PER_IMAGE);

          const check = (grave: Grave, expected: string): boolean => {
            for (const via of [0, 1]) {
              let r: ReadResult;
              try {
                // Only the read call is timed.
                r = timed(() => (via === 0 ? handle.readBytes(grave) : readGraveBytes(image, grave)));
              } catch (e) {
                if (e instanceof Error && /budget|timed|exceeded/i.test(e.message)) throw e;
                return false;
              }
              if (r.ok || r.error !== expected) return false;
            }
            return true;
          };

          for (const grave of graves) {
            if (grave.kind === 'directory') {
              if (!check(grave, ERR_DIRECTORY)) return false;
            } else if (grave.state === 'lost') {
              if (!check(grave, ERR_LOST)) return false;
            }
            for (const how of hows) {
              const forged = forge(grave, handle.report.files.length, how);
              if (forged === null) continue;
              if (!check(forged, ERR_NOT_FOUND)) return false;
            }
          }
          // Forgeries that need no real Grave.
          if (!check({} as unknown as Grave, ERR_NOT_FOUND)) return false;
          if (!check(null as unknown as Grave, ERR_NOT_FOUND)) return false;

          if (JSON.stringify(handle.report) !== reportBefore) return false;
          if (JSON.stringify(readDisk(image)) !== reportBefore) return false;
          if (image.length !== before.length) return false;
          for (let i = 0; i < before.length; i++) if (image[i] !== before[i]) return false;
          return true;
        },
      ),
      { numRuns: numRuns(100) },
    );
  });
});

/** Stable text form of a read result: ok flag plus error text or byte contents. */
function describeRead(r: ReadResult): string {
  return r.ok ? 'ok:' + Array.from(r.bytes).join(',') : 'err:' + r.error;
}

describe('reader reads: input immutability', () => {
  it('Property 3: Input is not modified and Buffer is equivalent', () => {
    // Feature: fat12-core, Property 3: Input is not modified and Buffer is equivalent
    // **Validates: Requirements 2.8, 10.3, 10.4**
    fc.assert(
      fc.property(imageArb, (image) => {
        const before = new Uint8Array(image);
        const handle = openDisk(image);
        const graves = handle.report.files.slice(0, MAX_GRAVES_PER_IMAGE);
        const plain: string[] = [];
        for (const grave of graves) {
          plain.push(describeRead(timed(() => handle.readBytes(grave))));
        }

        if (image.length !== before.length) return false;
        for (let i = 0; i < before.length; i++) if (image[i] !== before[i]) return false;

        const plainReport = JSON.stringify(readDisk(image));

        const pooled = Buffer.from(image);
        const big = Buffer.alloc(image.length + 17);
        const sliced = big.subarray(7, 7 + image.length);
        sliced.set(image);
        if (sliced.byteOffset === 0) return false;

        for (const buf of [pooled, sliced]) {
          if (JSON.stringify(readDisk(buf)) !== plainReport) return false;
          for (let g = 0; g < graves.length; g++) {
            const r = timed(() => readGraveBytes(buf, graves[g] as Grave));
            if (describeRead(r) !== plain[g]) return false;
          }
          // The Buffer inputs are untouched too.
          for (let i = 0; i < before.length; i++) if (buf[i] !== before[i]) return false;
        }
        return true;
      }),
      { numRuns: numRuns(100) },
    );
  });
});
