import type { DiskReport, GraveKind, GraveState } from '../../core/fat12/index';
import { formatBytes } from './size';
import { formatDate, lastSegment, segmentCount, toLabel } from './text';

export const STATE_WORDS = {
  alive: 'Alive',
  recovered: 'Recovered',
  partial: 'Partly back',
  lost: 'Lost',
} as const satisfies Record<GraveState, string>;

export type StateWord = (typeof STATE_WORDS)[GraveState];

export function stateWord(state: GraveState): StateWord {
  return STATE_WORDS[state];
}

export interface ItemViewModel {
  id: number;
  kind: GraveKind;
  state: GraveState;
  stateLabel: string;
  visual: 'tombstone' | 'open-grave';
  name: string;
  path: string;
  showPath: boolean;
  sizeText: string;
  dateText: string;
  reason: string | null;
  marker: 'directory' | null;
  action: 'exhume' | 'none';
  note: string | null;
  /** Set for a deleted entry whose displayed name starts with '_'; null otherwise. */
  nameHint: string | null;
}

export const UNDERSCORE_HINT = 'When the file was deleted, DOS overwrote this name\u2019s first letter.';

export function underscoreHint(state: GraveState, name: string): string | null {
  return state !== 'alive' && name.startsWith('_') ? UNDERSCORE_HINT : null;
}

export interface VolumeSummary {
  label: string;
  fileCount: number;
  directoryCount: number;
  /** File entries whose state is not 'alive'. */
  deletedCount: number;
  empty: null | 'unreadable' | 'no-files';
}

export function toItemViewModels(report: DiskReport): ItemViewModel[] {
  return report.files.map((g): ItemViewModel => {
    const rawName = lastSegment(g.path);
    const name = rawName === '' ? '(unnamed)' : toLabel(rawName);
    return {
      id: g.id,
      kind: g.kind,
      state: g.state,
      stateLabel: stateWord(g.state),
      visual: g.state === 'alive' ? 'tombstone' : 'open-grave',
      name,
      path: toLabel(g.path),
      showPath: segmentCount(g.path) > 1,
      sizeText: formatBytes(g.size),
      dateText: formatDate(g.date),
      reason: g.state === 'alive' ? null : (g.reason ?? null),
      marker: g.kind === 'directory' ? 'directory' : null,
      action: g.kind === 'file' && g.state !== 'lost' ? 'exhume' : 'none',
      note: g.state === 'lost' ? 'not previewable' : null,
      nameHint: underscoreHint(g.state, name),
    };
  });
}

export function summarize(report: DiskReport): VolumeSummary {
  let fileCount = 0;
  let directoryCount = 0;
  let deletedCount = 0;
  for (const g of report.files) {
    if (g.kind === 'directory') directoryCount++;
    else {
      fileCount++;
      if (g.state !== 'alive') deletedCount++;
    }
  }
  let empty: VolumeSummary['empty'] = null;
  if (report.files.length === 0) {
    empty = report.volume.geometrySource === 'none' ? 'unreadable' : 'no-files';
  }
  return {
    label: report.volume.label === '' ? '(no label)' : toLabel(report.volume.label),
    fileCount,
    directoryCount,
    deletedCount,
    empty,
  };
}

export function warningLines(report: DiskReport): string[] {
  return report.warnings.map((w) => (w.path !== undefined && w.path !== '' ? `${w.message} (${w.path})` : w.message));
}
