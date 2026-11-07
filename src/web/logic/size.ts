import { MAX_IMAGE_BYTES } from './limits';

export type SizeCheck =
  | { ok: true }
  | { ok: false; reason: 'empty' | 'too-large' | 'invalid'; message: string };

/** Human-readable size: "512 B", "1.5 KB", "2.8 MB". Total; never throws. */
export function formatBytes(n: number): string {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return '0 B';
  if (n < 1024) return `${Math.floor(n)} B`;
  const kb = Math.round((n / 1024) * 10) / 10;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = Math.round((n / 1_048_576) * 10) / 10;
  return `${mb.toFixed(1)} MB`;
}

/** Accepts exactly the integers 1..cap. */
export function checkImageSize(bytes: number, cap: number = MAX_IMAGE_BYTES): SizeCheck {
  if (typeof bytes !== 'number' || !Number.isInteger(bytes) || bytes < 0) {
    return { ok: false, reason: 'invalid', message: 'This file size could not be read.' };
  }
  if (bytes === 0) {
    return { ok: false, reason: 'empty', message: 'This file is empty.' };
  }
  if (bytes > cap) {
    return {
      ok: false,
      reason: 'too-large',
      message: `This file is ${formatBytes(bytes)}. Floppy images up to ${formatBytes(cap)} are supported.`,
    };
  }
  return { ok: true };
}
