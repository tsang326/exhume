// Status region: the single place that writes announcements. Text only, via textContent.

export interface StatusRegion {
  set(text: string): void;
  clear(): void;
}

/** Wraps the element carrying role="status"; every write goes through textContent. */
export function createStatusRegion(el: HTMLElement): StatusRegion {
  return {
    set(text: string): void {
      el.textContent = text;
    },
    clear(): void {
      el.textContent = '';
    },
  };
}
