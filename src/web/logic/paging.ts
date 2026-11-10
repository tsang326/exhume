import { MAX_TOTAL_ENTRIES, PAGE_SIZE } from './limits';

/** min(total, pages * PAGE_SIZE, MAX_TOTAL_ENTRIES), never negative. */
export function visibleCount(total: number, pages: number): number {
  const t = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  const p = Number.isFinite(pages) ? Math.max(0, Math.floor(pages)) : 0;
  return Math.min(t, p * PAGE_SIZE, MAX_TOTAL_ENTRIES);
}

export function hasMore(total: number, pages: number): boolean {
  return visibleCount(total, pages) < Math.min(Math.max(0, Math.floor(total)), MAX_TOTAL_ENTRIES);
}

export function progressText(visible: number, total: number): string {
  return `Showing ${visible} of ${total} items`;
}
