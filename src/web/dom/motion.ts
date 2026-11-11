// Scroll entrances. The hidden start state lives in CSS under `.js` only, so if this
// module never runs, nothing is hidden. Only classList is used (no style API).

export interface MotionEnv {
  doc: Document;
  reduced: boolean;
  observerCtor: typeof IntersectionObserver | undefined;
}

const ENTRANCE_SELECTOR = '.rise, .bar-track';
const THRESHOLD = 0.2;

export function initMotion(env: MotionEnv): void {
  const { doc, reduced, observerCtor } = env;
  doc.documentElement.classList.add('js');
  const targets = Array.from(doc.querySelectorAll(ENTRANCE_SELECTOR));

  if (reduced || observerCtor === undefined) {
    for (const el of targets) el.classList.add('in');
    return;
  }

  let observer: IntersectionObserver;
  try {
    observer = new observerCtor(
      (entries, obs) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('in');
          obs.unobserve(entry.target);
        }
      },
      { threshold: THRESHOLD },
    );
  } catch {
    // A throwing observer must not leave content hidden.
    for (const el of targets) el.classList.add('in');
    return;
  }
  for (const el of targets) observer.observe(el);
}
