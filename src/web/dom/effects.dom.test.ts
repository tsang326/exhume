// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createEffects } from './effects';
import { playRise } from './rising';
import { FX_MAX_SHAPES, RISE_MS } from '../logic/limits';

interface FakeCtx {
  clears: number;
  fills: number;
  clearRect(): void;
  createRadialGradient(): { addColorStop(): void };
  beginPath(): void;
  arc(): void;
  fill(): void;
  fillStyle: unknown;
}

function makeCtx(): FakeCtx {
  const ctx: FakeCtx = {
    clears: 0,
    fills: 0,
    fillStyle: '',
    clearRect() {
      ctx.clears++;
    },
    createRadialGradient() {
      return { addColorStop() {} };
    },
    beginPath() {},
    arc() {},
    fill() {
      ctx.fills++;
    },
  };
  return ctx;
}

let ctx: FakeCtx;
let rafQueue: Map<number, FrameRequestCallback>;
let nextId: number;
let hiddenState: DocumentVisibilityState;
let mediaMatches: boolean;
let mediaListeners: Set<(e: { matches: boolean }) => void>;
let host: HTMLElement;

/** Runs every queued rAF callback once at the given timestamp. */
function tick(now: number): void {
  const pending = [...rafQueue.entries()];
  rafQueue.clear();
  for (const [, cb] of pending) cb(now);
}

function setVisibility(state: DocumentVisibilityState): void {
  hiddenState = state;
  document.dispatchEvent(new Event('visibilitychange'));
}

function setMedia(matches: boolean): void {
  mediaMatches = matches;
  for (const l of [...mediaListeners]) l({ matches });
}

function noStyleAttributes(): void {
  for (const el of Array.from(document.querySelectorAll('*'))) {
    expect(el.hasAttribute('style')).toBe(false);
  }
}

beforeEach(() => {
  ctx = makeCtx();
  rafQueue = new Map();
  nextId = 1;
  hiddenState = 'visible';
  mediaMatches = false;
  mediaListeners = new Set();
  document.body.replaceChildren();
  host = document.createElement('div');
  document.body.appendChild(host);

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((() => ctx) as never);
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => {
    const id = nextId++;
    rafQueue.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number): void => {
    rafQueue.delete(id);
  });
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => hiddenState,
  });
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: () => ({
      get matches() {
        return mediaMatches;
      },
      addEventListener: (_t: string, l: (e: { matches: boolean }) => void) => mediaListeners.add(l),
      removeEventListener: (_t: string, l: (e: { matches: boolean }) => void) => mediaListeners.delete(l),
    }),
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (document as unknown as Record<string, unknown>).visibilityState;
});

describe('createEffects', () => {
  it('creates an aria-hidden fx-canvas inside the host within backing limits', () => {
    const fx = createEffects(host);
    const canvas = host.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas?.className).toContain('fx-canvas');
    expect(canvas?.getAttribute('aria-hidden')).toBe('true');
    tick(100);
    expect(canvas!.width).toBeGreaterThanOrEqual(1);
    expect(canvas!.width).toBeLessThanOrEqual(1920);
    expect(canvas!.height).toBeGreaterThanOrEqual(1);
    expect(canvas!.height).toBeLessThanOrEqual(1080);
    noStyleAttributes();
    fx.destroy();
  });

  it('draws at most FX_MAX_SHAPES shapes per frame', () => {
    const fx = createEffects(host);
    tick(100);
    expect(ctx.clears).toBe(1);
    expect(ctx.fills).toBeGreaterThan(0);
    expect(ctx.fills).toBeLessThanOrEqual(FX_MAX_SHAPES);
    expect(FX_MAX_SHAPES).toBeLessThanOrEqual(200);
    fx.destroy();
  });

  it('throttles frames to 30 fps or fewer', () => {
    const fx = createEffects(host);
    // One second of 60 Hz display callbacks.
    for (let i = 0; i <= 60; i++) tick(1000 + (i * 1000) / 60);
    expect(ctx.clears).toBeGreaterThan(0);
    expect(ctx.clears).toBeLessThanOrEqual(31);
    fx.destroy();
  });

  it('stops scheduling when hidden and resumes when visible', () => {
    const fx = createEffects(host);
    expect(rafQueue.size).toBe(1);
    setVisibility('hidden');
    expect(rafQueue.size).toBe(0);
    tick(500);
    expect(rafQueue.size).toBe(0);
    setVisibility('visible');
    expect(rafQueue.size).toBe(1);
    const before = ctx.clears;
    tick(1000);
    expect(ctx.clears).toBe(before + 1);
    fx.destroy();
  });

  it('draws a static frame and cancels the loop under reduced motion, resuming when turned off', () => {
    const fx = createEffects(host);
    const canvas = host.querySelector('canvas')!;
    expect(rafQueue.size).toBe(1);
    const before = ctx.clears;
    setMedia(true);
    expect(canvas.classList.contains('is-static')).toBe(true);
    expect(rafQueue.size).toBe(0);
    expect(ctx.clears).toBe(before + 1);
    tick(2000);
    expect(ctx.clears).toBe(before + 1);
    setMedia(false);
    expect(canvas.classList.contains('is-static')).toBe(false);
    expect(rafQueue.size).toBe(1);
    fx.destroy();
  });

  it('starts static when reduced motion is already preferred', () => {
    mediaMatches = true;
    const fx = createEffects(host);
    const canvas = host.querySelector('canvas')!;
    expect(canvas.classList.contains('is-static')).toBe(true);
    expect(rafQueue.size).toBe(0);
    expect(ctx.clears).toBe(1);
    fx.destroy();
  });

  it('leaves no canvas and throws nothing when getContext returns null', () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation((() => null) as never);
    let fx: ReturnType<typeof createEffects> | undefined;
    expect(() => {
      fx = createEffects(host);
    }).not.toThrow();
    expect(host.querySelector('canvas')).toBeNull();
    expect(rafQueue.size).toBe(0);
    expect(() => fx!.setReducedMotion(true)).not.toThrow();
    expect(() => fx!.destroy()).not.toThrow();
  });

  it('destroy removes the canvas, listeners and pending frames', () => {
    const fx = createEffects(host);
    expect(mediaListeners.size).toBe(1);
    fx.destroy();
    expect(host.querySelector('canvas')).toBeNull();
    expect(mediaListeners.size).toBe(0);
    expect(rafQueue.size).toBe(0);
    setVisibility('hidden');
    setVisibility('visible');
    expect(rafQueue.size).toBe(0);
    expect(() => fx.destroy()).not.toThrow();
  });
});

describe('playRise', () => {
  let item: HTMLElement;
  beforeEach(() => {
    vi.useFakeTimers();
    item = document.createElement('li');
    host.appendChild(item);
  });

  it('adds is-rising and an aria-hidden ghost, then cleans up after RISE_MS', async () => {
    const handle = playRise(item, false);
    expect(item.classList.contains('is-rising')).toBe(true);
    const ghost = item.querySelector('.rise-ghost');
    expect(ghost).not.toBeNull();
    expect(ghost?.getAttribute('aria-hidden')).toBe('true');
    noStyleAttributes();
    expect(RISE_MS).toBeLessThanOrEqual(1200);
    vi.advanceTimersByTime(RISE_MS - 1);
    expect(item.classList.contains('is-rising')).toBe(true);
    vi.advanceTimersByTime(1);
    await handle.finished;
    expect(item.classList.contains('is-rising')).toBe(false);
    expect(item.querySelector('.rise-ghost')).toBeNull();
    expect(document.querySelector('.rise-ghost')).toBeNull();
  });

  it('cancel cleans up immediately and resolves', async () => {
    const handle = playRise(item, false);
    handle.cancel();
    expect(item.classList.contains('is-rising')).toBe(false);
    expect(item.querySelector('.rise-ghost')).toBeNull();
    await handle.finished;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('adds nothing and resolves at once when reduced', async () => {
    const handle = playRise(item, true);
    expect(item.classList.contains('is-rising')).toBe(false);
    expect(item.querySelector('.rise-ghost')).toBeNull();
    expect(item.attributes.length).toBe(0);
    await handle.finished;
    expect(vi.getTimerCount()).toBe(0);
  });
});
