// Decorative canvas fog and lantern. At most FX_MAX_SHAPES blobs per frame, at most
// FX_MAX_FPS frames per second, paused while hidden, static under reduced motion.
// Class toggles only; the canvas is sized through its width and height attributes.

import { canvasBacking, frameDue } from '../logic/effects-math';
import { FX_MAX_SHAPES } from '../logic/limits';

export interface Effects {
  setReducedMotion(on: boolean): void;
  destroy(): void;
}

const REDUCED_QUERY = '(prefers-reduced-motion: reduce)';
const BLOB_COUNT = Math.min(FX_MAX_SHAPES, 24);

function noopEffects(): Effects {
  return { setReducedMotion(): void {}, destroy(): void {} };
}

export function createEffects(host: HTMLElement): Effects {
  const doc = host.ownerDocument;
  const canvas = doc.createElement('canvas');
  canvas.className = 'fx-canvas';
  canvas.setAttribute('aria-hidden', 'true');

  let ctx: CanvasRenderingContext2D | null = null;
  try {
    ctx = canvas.getContext('2d');
  } catch {
    ctx = null;
  }
  if (ctx === null) return noopEffects();
  const g: CanvasRenderingContext2D = ctx;

  host.appendChild(canvas);

  let reduced = false;
  let destroyed = false;
  let frameId: number | null = null;
  let last = -Infinity;

  const resize = (): void => {
    const view = doc.defaultView;
    const size = canvasBacking(view?.innerWidth ?? 0, view?.innerHeight ?? 0, view?.devicePixelRatio ?? 1);
    if (canvas.width !== size.width) canvas.width = size.width;
    if (canvas.height !== size.height) canvas.height = size.height;
  };

  const draw = (now: number): void => {
    resize();
    const w = canvas.width;
    const h = canvas.height;
    g.clearRect(0, 0, w, h);
    const count = Math.min(BLOB_COUNT, FX_MAX_SHAPES);
    const t = reduced ? 0 : now / 1000;
    for (let i = 0; i < count; i++) {
      const phase = i * 2.399963;
      const x = (0.5 + 0.5 * Math.sin(phase + t * 0.05 * (1 + (i % 3)))) * w;
      const y = (0.5 + 0.5 * Math.cos(phase * 1.3 + t * 0.04 * (1 + (i % 4)))) * h;
      const r = (0.08 + 0.06 * ((i % 5) / 4)) * Math.max(w, h);
      const lantern = i % 6 === 0;
      const grad = g.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, lantern ? 'rgba(240, 190, 90, 0.18)' : 'rgba(160, 175, 190, 0.12)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
      g.fillStyle = grad;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
  };

  const onFrame = (now: number): void => {
    frameId = null;
    if (destroyed || reduced) return;
    if (frameDue(last, now)) {
      last = now;
      draw(now);
    }
    schedule();
  };

  const schedule = (): void => {
    if (frameId !== null || destroyed || reduced) return;
    if (doc.visibilityState === 'hidden') return;
    frameId = requestAnimationFrame(onFrame);
  };

  const stop = (): void => {
    if (frameId !== null) {
      cancelAnimationFrame(frameId);
      frameId = null;
    }
  };

  const applyReduced = (on: boolean): void => {
    reduced = on;
    canvas.classList.toggle('is-static', on);
    stop();
    if (on) {
      draw(0);
    } else {
      schedule();
    }
  };

  const onVisibility = (): void => {
    if (doc.visibilityState === 'hidden') stop();
    else schedule();
  };

  doc.addEventListener('visibilitychange', onVisibility);

  const view = doc.defaultView;
  let media: MediaQueryList | null = null;
  const onMediaChange = (event: MediaQueryListEvent): void => {
    applyReduced(event.matches);
  };
  if (view !== null && typeof view.matchMedia === 'function') {
    media = view.matchMedia(REDUCED_QUERY);
    media.addEventListener('change', onMediaChange);
  }

  applyReduced(media !== null && media.matches);

  return {
    setReducedMotion(on: boolean): void {
      if (destroyed) return;
      applyReduced(on);
    },
    destroy(): void {
      if (destroyed) return;
      destroyed = true;
      stop();
      doc.removeEventListener('visibilitychange', onVisibility);
      if (media !== null) media.removeEventListener('change', onMediaChange);
      canvas.remove();
    },
  };
}
