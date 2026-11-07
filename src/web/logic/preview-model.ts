import type { ExhumedResponse } from './protocol';
import { OUTPUT_BY_KIND } from './protocol';
import { parseCsv } from './csv-display';
import type { CsvTable } from './csv-display';
import { sanitizeFileName } from './filename';
import { hexRows } from './hex';
import type { HexRow } from './hex';
import { HEX_PREVIEW_BYTES } from './limits';
import { truncateForPreview } from './markdown';
import { toLabel } from './text';
import type { ItemViewModel } from './viewmodel';

export type DownloadMime = 'text/markdown' | 'text/csv' | 'text/plain' | 'image/png' | 'application/octet-stream';

export interface DownloadSpec {
  label: string;
  fileName: string;
  mime: DownloadMime;
  data: string | Uint8Array;
}

export type PreviewBody =
  | { kind: 'markdown'; text: string; shortened: boolean }
  | { kind: 'csv'; table: CsvTable }
  | { kind: 'text'; text: string; shortened: boolean }
  | { kind: 'png'; png: Uint8Array; alt: string }
  | { kind: 'hex'; rows: HexRow[]; totalBytes: number; shownBytes: number }
  | { kind: 'none' };

export interface PreviewModel {
  title: string;
  partialNote: string | null;
  error: string | null;
  warnings: string[];
  body: PreviewBody;
  downloads: DownloadSpec[];
}

export type ExhumeOutcome =
  | { status: 'ok'; response: ExhumedResponse }
  | { status: 'read-failed'; error: string }
  | { status: 'lost-disk'; error: string };

export function buildPreviewModel(item: ItemViewModel, outcome: ExhumeOutcome): PreviewModel {
  const title = toLabel(item.name);
  const partialNote = item.state === 'partial' ? item.reason : null;

  if (outcome.status !== 'ok') {
    return { title, partialNote, error: outcome.error, warnings: [], body: { kind: 'none' }, downloads: [] };
  }

  const { raw, readWarnings, result } = outcome.response;
  const warnings: string[] = [];
  for (const w of readWarnings) {
    warnings.push(w.path !== undefined && w.path !== '' ? `${w.message} (${w.path})` : w.message);
  }
  for (const w of result.warnings) warnings.push(w.message);

  const downloads: DownloadSpec[] = [];
  let body: PreviewBody;
  let error: string | null = null;

  switch (result.kind) {
    case 'markdown': {
      const t = truncateForPreview(result.text);
      body = { kind: 'markdown', text: t.text, shortened: t.shortened };
      break;
    }
    case 'csv':
      body = { kind: 'csv', table: parseCsv(result.text) };
      break;
    case 'text': {
      const t = truncateForPreview(result.text);
      body = { kind: 'text', text: t.text, shortened: t.shortened };
      break;
    }
    case 'png':
      body = { kind: 'png', png: result.png, alt: sanitizeFileName(item.name, '.png') };
      break;
    case 'raw':
      error = result.error;
      body = {
        kind: 'hex',
        rows: hexRows(raw, HEX_PREVIEW_BYTES),
        totalBytes: raw.length,
        shownBytes: Math.min(raw.length, HEX_PREVIEW_BYTES),
      };
      break;
  }

  if (result.kind !== 'raw') {
    const out = OUTPUT_BY_KIND[result.kind];
    downloads.push({
      label: `Download ${out.extension}`,
      fileName: sanitizeFileName(item.name, out.extension),
      mime: out.mime,
      data: result.kind === 'png' ? result.png : result.text,
    });
  }

  downloads.push({
    label: 'Download raw bytes',
    fileName: sanitizeFileName(item.name, '.bin'),
    mime: 'application/octet-stream',
    data: raw,
  });

  return { title, partialNote, error, warnings, body, downloads };
}
