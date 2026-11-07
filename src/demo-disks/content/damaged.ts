import type { DamageSpec, FileTree } from '../../test-support/fat12/index';
import type { DiskPlan } from '../build';
import { DAMAGED_LETTER, DAMAGED_MEMO, DAMAGED_README } from './dates';
import { LETTER, MEMO } from './prose';
import { DAMAGED_README as DAMAGED_README_TEXT, asciiBytes } from './readme';
import { writeWordStar } from '../../test-support/formats/index';

/**
 * Damaged disk, 360K, label DAMAGE DEMO.
 * Three files: LETTER.WS (3 clusters, the looping chain), MEMO.WS and README.TXT.
 */
export function damagedPlan(): DiskPlan {
  const letter = writeWordStar(LETTER);
  const memo = writeWordStar(MEMO);
  const readme = asciiBytes(DAMAGED_README_TEXT);

  const tree: FileTree = {
    volumeLabel: 'DAMAGE DEMO',
    children: [
      { kind: 'file', name: 'LETTER.WS', content: letter, modified: DAMAGED_LETTER.modified },
      { kind: 'file', name: 'MEMO.WS', content: memo, modified: DAMAGED_MEMO.modified },
      { kind: 'file', name: 'README.TXT', content: readme, modified: DAMAGED_README.modified },
    ],
  };

  // The first damage is the boot sector defect (sectors per cluster set to zero).
  // The last two together are ONE defect, the looping cluster chain: a cyclic chain alone
  // is not visible to the Reader when the declared size is covered by the file's own
  // clusters, so the declared size is raised by one cluster to make the loop observable.
  const damage: DamageSpec[] = [
    { type: 'invalid-bpb', field: 'sectorsPerCluster' },
    { type: 'cyclic-chain', path: '/LETTER.WS' },
    { type: 'size-exceeds-chain', path: '/LETTER.WS', extraBytes: 1024 },
  ];

  const sources = new Map<string, Uint8Array>([
    ['/LETTER.WS', letter],
    ['/MEMO.WS', memo],
    ['/README.TXT', readme],
  ]);

  return { tree, damage, sources };
}
