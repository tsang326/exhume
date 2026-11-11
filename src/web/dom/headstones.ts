// Headstones: binds the static `button.hs[data-path]` stones in index.html.
// It reads nothing from the disk; the path is only handed to the callback.

/** Calls onOpen(path) when a stone is clicked. A missing root is a no-op. */
export function bindHeadstones(root: HTMLElement | null, onOpen: (path: string) => void): void {
  if (!root) return;
  const stones = root.querySelectorAll<HTMLButtonElement>('button.hs[data-path]');
  for (const stone of Array.from(stones)) {
    stone.addEventListener('click', () => {
      const path = stone.getAttribute('data-path');
      if (path) onOpen(path);
    });
  }
}
