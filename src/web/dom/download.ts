// Starts a download from in-memory data through a temporary link.
import type { DownloadSpec } from '../logic/preview-model';
import { DOWNLOAD_REVOKE_MS } from '../logic/limits';
import type { BlobUrlManager } from './blob-urls';
import { setDownloadHref } from './h';

export type DownloadResult = { ok: true } | { ok: false; message: string };

export interface Downloader {
  start(spec: DownloadSpec): DownloadResult;
}

export const DOWNLOAD_FAILED_MESSAGE = 'The download could not be started.';

const ALLOWED_MIME: ReadonlySet<string> = new Set([
  'text/markdown',
  'text/csv',
  'image/png',
  'application/octet-stream',
]);

const defaultScheduler = (fn: () => void, ms: number): void => {
  setTimeout(fn, ms);
};

export function createDownloader(
  blobs: BlobUrlManager,
  scheduler: (fn: () => void, ms: number) => void = defaultScheduler,
): Downloader {
  return {
    start(spec: DownloadSpec): DownloadResult {
      try {
        if (!ALLOWED_MIME.has(spec.mime)) throw new Error('unsupported type');
        const blob = new Blob([spec.data as BlobPart], { type: spec.mime });
        const url = blobs.create(blob);
        const a = document.createElement('a');
        setDownloadHref(a, url, spec.fileName, blobs.isOwned);
        document.body.appendChild(a);
        try {
          a.click();
        } finally {
          a.remove();
        }
        // Release only this download's URL, once.
        scheduler(() => {
          blobs.revoke(url);
        }, DOWNLOAD_REVOKE_MS);
        return { ok: true };
      } catch {
        return { ok: false, message: DOWNLOAD_FAILED_MESSAGE };
      }
    },
  };
}
