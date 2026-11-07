import { FX_MAX_FPS, FX_MAX_BACKING } from './limits';

const HUGE = 1e9;

function clean(n: number): number {
  if (Number.isNaN(n) || n <= 0) return 0;
  return n > HUGE ? HUGE : n;
}

/** Canvas backing-store size: integers, 1..1920 by 1..1080, aspect kept when scaled down. */
export function canvasBacking(
  cssWidth: number,
  cssHeight: number,
  dpr: number,
): { width: number; height: number } {
  const ratio = Number.isNaN(dpr) || dpr <= 0 ? 1 : Math.min(dpr, 64);
  const w = clean(cssWidth) * ratio;
  const h = clean(cssHeight) * ratio;
  const scale = Math.min(1, w > 0 ? FX_MAX_BACKING.width / w : 1, h > 0 ? FX_MAX_BACKING.height / h : 1);
  const width = Math.min(FX_MAX_BACKING.width, Math.max(1, Math.round(w * scale)));
  const height = Math.min(FX_MAX_BACKING.height, Math.max(1, Math.round(h * scale)));
  return { width, height };
}

/** True when enough time has passed for the next frame (at most FX_MAX_FPS per second). */
export function frameDue(lastMs: number, nowMs: number): boolean {
  return nowMs - lastMs >= 1000 / FX_MAX_FPS;
}
