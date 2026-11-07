// Rising animation: class toggles and one aria-hidden ghost span. No inline styling.
// The timer, not animationend, decides when the animation is over.

import { RISE_MAX_MS, RISE_MS } from '../logic/limits';

export interface RiseHandle {
  cancel(): void;
  finished: Promise<void>;
}

const RISING_CLASS = 'is-rising';
const GHOST_CLASS = 'rise-ghost';

/** Marks the item as rising for RISE_MS, then removes every animated element. */
export function playRise(item: HTMLElement, reduced: boolean): RiseHandle {
  if (reduced) {
    return { cancel(): void {}, finished: Promise.resolve() };
  }

  const doc = item.ownerDocument;
  const ghost = doc.createElement('span');
  ghost.className = GHOST_CLASS;
  ghost.setAttribute('aria-hidden', 'true');
  item.classList.add(RISING_CLASS);
  item.appendChild(ghost);

  let done = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let resolveFinished: () => void = () => {};
  const finished = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });

  const finish = (): void => {
    if (done) return;
    done = true;
    try {
      if (timer !== undefined) clearTimeout(timer);
    } finally {
      try {
        item.classList.remove(RISING_CLASS);
        ghost.remove();
      } finally {
        resolveFinished();
      }
    }
  };

  timer = setTimeout(finish, Math.min(RISE_MS, RISE_MAX_MS));

  return { cancel: finish, finished };
}
