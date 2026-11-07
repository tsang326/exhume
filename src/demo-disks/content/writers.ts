// Writer's disk plan: three live chapters, two deleted drafts and a README.
// Tree order is allocation order. DRAFT1.WS sits in a hole of free clusters (recovered);
// DRAFT2.WS has two free clusters and a declared size one cluster too large, and the next
// cluster belongs to CHAPTER3.WS (partial). The disk itself has no defect.

import type { DamageSpec, TreeNode } from '../../test-support/fat12/index';
import type { DiskPlan } from '../build';
import { asciiBytes, WRITERS_README } from './readme';
import {
  WRITERS_CHAPTER1,
  WRITERS_CHAPTER2,
  WRITERS_CHAPTER3,
  WRITERS_DRAFT1,
  WRITERS_DRAFT2,
  WRITERS_README as WRITERS_README_DATE,
} from './dates';
import { chapter1Bytes, chapter2Bytes, chapter3Bytes, draft1Bytes, draft2Bytes } from './prose';

export const WRITERS_LABEL = 'WRITER DEMO';

export function writersPlan(): DiskPlan {
  const chapter1 = chapter1Bytes();
  const draft1 = draft1Bytes();
  const chapter2 = chapter2Bytes();
  const draft2 = draft2Bytes();
  const chapter3 = chapter3Bytes();
  const readme = asciiBytes(WRITERS_README);

  const children: TreeNode[] = [
    { kind: 'file', name: 'CHAPTER1.WS', content: chapter1, modified: WRITERS_CHAPTER1.modified },
    { kind: 'file', name: 'DRAFT1.WS', content: draft1, modified: WRITERS_DRAFT1.modified, deleted: true },
    { kind: 'file', name: 'CHAPTER2.WS', content: chapter2, modified: WRITERS_CHAPTER2.modified },
    { kind: 'file', name: 'DRAFT2.WS', content: draft2, modified: WRITERS_DRAFT2.modified, deleted: true },
    { kind: 'file', name: 'CHAPTER3.WS', content: chapter3, modified: WRITERS_CHAPTER3.modified },
    { kind: 'file', name: 'README.TXT', content: readme, modified: WRITERS_README_DATE.modified },
  ];

  const damage: DamageSpec[] = [{ type: 'size-exceeds-chain', path: '/DRAFT2.WS', extraBytes: 1024 }];

  const sources = new Map<string, Uint8Array>([
    ['/CHAPTER1.WS', chapter1],
    ['/DRAFT1.WS', draft1],
    ['/CHAPTER2.WS', chapter2],
    ['/DRAFT2.WS', draft2],
    ['/CHAPTER3.WS', chapter3],
    ['/README.TXT', readme],
  ]);

  return { tree: { volumeLabel: WRITERS_LABEL, children }, damage, sources };
}
