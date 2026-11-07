// Tab trap for the preview dialog. The index math lives in logic/focus-order.ts.

import { nextFocusIndex } from '../logic/focus-order';

const FOCUSABLE =
  'button, [href], input, select, textarea, summary, [tabindex]:not([tabindex="-1"])';

function isVisibleFocusable(el: HTMLElement): boolean {
  if (el.hasAttribute('disabled') || el.hasAttribute('hidden') || el.hasAttribute('inert')) return false;
  if (el.getAttribute('tabindex') === '-1') return false;
  if (typeof el.getClientRects === 'function' && el.getClientRects().length === 0) return false;
  return true;
}

/** Focusable, visible descendants of `root` in document order. */
export function focusableIn(root: HTMLElement): HTMLElement[] {
  const found = root.querySelectorAll<HTMLElement>(FOCUSABLE);
  const out: HTMLElement[] = [];
  for (let i = 0; i < found.length; i++) {
    const el = found[i] as HTMLElement;
    if (isVisibleFocusable(el)) out.push(el);
  }
  return out;
}

/** Keeps Tab and Shift+Tab inside `root`, wrapping at both ends. Other keys are ignored. */
export function trapTab(root: HTMLElement, e: KeyboardEvent): void {
  if (e.key !== 'Tab') return;
  const items = focusableIn(root);
  const active = root.ownerDocument.activeElement;
  let current = -1;
  for (let i = 0; i < items.length; i++) {
    if (items[i] === active) {
      current = i;
      break;
    }
  }
  const next = nextFocusIndex(items.length, current, e.shiftKey);
  e.preventDefault();
  if (next >= 0) (items[next] as HTMLElement).focus();
}
