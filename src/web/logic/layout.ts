/** Same string as the CSS narrow block (`@media (max-width: 760px)`). */
export const NARROW_QUERY = '(max-width: 760px)';

export type MatchMediaLike = (query: string) => { matches: boolean };

/** True when the narrow query matches. False when `mm` is missing or throws. */
export function isNarrow(mm: MatchMediaLike | undefined): boolean {
  if (typeof mm !== 'function') return false;
  try {
    return mm(NARROW_QUERY).matches === true;
  } catch {
    return false;
  }
}
