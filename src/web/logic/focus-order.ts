/**
 * Next index when Tab is pressed inside a dialog with `count` focusable items.
 * `current` is the focused index, or -1 when focus is outside the list.
 * Wraps at both ends. Returns -1 when there is nothing to focus.
 */
export function nextFocusIndex(count: number, current: number, backwards: boolean): number {
  if (!Number.isInteger(count) || count <= 0) return -1;
  if (!Number.isInteger(current) || current < 0 || current >= count) {
    return backwards ? count - 1 : 0;
  }
  if (backwards) return current === 0 ? count - 1 : current - 1;
  return current === count - 1 ? 0 : current + 1;
}
