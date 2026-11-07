export interface DropInfo {
  itemKinds: readonly string[];
  fileCount: number;
  firstIsDirectory: boolean;
}

export type DropDecision =
  | { action: 'use-first'; ignoredOthers: boolean }
  | { action: 'reject'; message: string };

export const DROP_REJECT_MESSAGE = 'Please drop a disk image file.';

/** Decide what to do with a drop, from facts about it only. Pure and total. */
export function classifyDrop(info: DropInfo): DropDecision {
  if (info.fileCount < 1 || info.firstIsDirectory) {
    return { action: 'reject', message: DROP_REJECT_MESSAGE };
  }
  return { action: 'use-first', ignoredOthers: info.fileCount > 1 };
}
