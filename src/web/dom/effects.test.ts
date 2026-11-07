import { describe, it, expect, vi, afterEach } from 'vitest';
import { createEffects } from './effects';
import { playRise } from './rising';

type Listener = (e: never) => void;

function makeEnv(withContext: boolean) {
  const docListeners = new Map<string, Listener[]>();
  const mqListeners: Listener[] = [];
  const calls = { arcs: 0, frames: 0 };
  const ctx = {
    clearRect: () => {
      calls.frames++;
    },
    createRadialGradient: () => ({ addColorStop: () => {} }),
    beginPath: () => {},
    arc: () => {
      calls.arcs++;
    },
    fill: () => {},
    fillStyle: '',
  };
  const attrs = new Map<string, string>();
  const classes = new Set<string>();
  const canvas = {
    className: '',
    width: 300,
    height: 150,
    removed: false,
    setAttribute: (k: string, v: string) => attrs.set(k, v),
    getContext: () => (withContext ? ctx : null),
    classList: {
      toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)),
    },
    remove() {
      canvas.removed = true;
    },
  };
  const mq = {
    matches: false,
    addEventListener: (_t: string, l: Listener) => mqListeners.push(l),
    removeEventListener: () => {},
  };
  const doc = {
    visibilityState: 'visible',
    defaultView: { innerWidth: 4000, innerHeight: 3000, devicePixelRatio: 2, matchMedia: () => mq },
    createElement: () => canvas,
    addEventListener: (t: string, l: Listener) => docListeners.set(t, [...(docListeners.get(t) ?? []), l]),
    removeEventListener: () => {},
  };
  const host = { ownerDocument: doc, appendChild: vi.fn() };
  return { doc, host: host as unknown as HTMLElement, canvas, calls, docListeners, mq, mqListeners, attrs, classes };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('createEffects', () => {
  it('limits shapes and backing store, pauses when hidden, follows reduced motion', () => {
    const env = makeEnv(true);
    const pending = new Map<number, (t: number) => void>();
    let nextId = 1;
    vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
      pending.set(nextId, cb);
      return nextId++;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => pending.delete(id));

    const fx = createEffects(env.host);
    expect(env.attrs.get('aria-hidden')).toBe('true');
    expect(env.canvas.className).toBe('fx-canvas');
    expect(pending.size).toBe(1);

    const run = (t: number) => {
      const [id, cb] = [...pending.entries()][0]!;
      pending.delete(id);
      cb(t);
    };
    run(1000);
    expect(env.canvas.width).toBeLessThanOrEqual(1920);
    expect(env.canvas.height).toBeLessThanOrEqual(1080);
    expect(env.calls.arcs).toBeGreaterThan(0);
    expect(env.calls.arcs).toBeLessThanOrEqual(60);
    const framesAfterFirst = env.calls.frames;
    run(1010); // under 33 ms later: no draw
    expect(env.calls.frames).toBe(framesAfterFirst);
    run(1100);
    expect(env.calls.frames).toBe(framesAfterFirst + 1);

    env.doc.visibilityState = 'hidden';
    env.docListeners.get('visibilitychange')!.forEach((l) => l(undefined as never));
    expect(pending.size).toBe(0);
    env.doc.visibilityState = 'visible';
    env.docListeners.get('visibilitychange')!.forEach((l) => l(undefined as never));
    expect(pending.size).toBe(1);

    env.mqListeners.forEach((l) => l({ matches: true } as never));
    expect(pending.size).toBe(0);
    expect(env.classes.has('is-static')).toBe(true);
    fx.setReducedMotion(false);
    expect(pending.size).toBe(1);

    fx.destroy();
    expect(pending.size).toBe(0);
    expect(env.canvas.removed).toBe(true);
  });

  it('does nothing and throws nothing when there is no 2D context', () => {
    const env = makeEnv(false);
    const fx = createEffects(env.host);
    expect(env.host.appendChild).not.toHaveBeenCalled();
    expect(() => {
      fx.setReducedMotion(true);
      fx.destroy();
    }).not.toThrow();
  });
});

describe('playRise', () => {
  function makeItem() {
    const classes = new Set<string>();
    const children: unknown[] = [];
    const ghost = { className: '', attrs: new Map<string, string>(), removed: false } as {
      className: string;
      attrs: Map<string, string>;
      removed: boolean;
      setAttribute?: (k: string, v: string) => void;
      remove?: () => void;
    };
    ghost.setAttribute = (k, v) => ghost.attrs.set(k, v);
    ghost.remove = () => {
      ghost.removed = true;
    };
    const item = {
      ownerDocument: { createElement: () => ghost },
      classList: { add: (c: string) => classes.add(c), remove: (c: string) => classes.delete(c) },
      appendChild: (c: unknown) => children.push(c),
    };
    return { item: item as unknown as HTMLElement, classes, ghost, children };
  }

  it('adds the class and ghost at once and removes them after 900 ms', async () => {
    vi.useFakeTimers();
    const { item, classes, ghost, children } = makeItem();
    const handle = playRise(item, false);
    expect(classes.has('is-rising')).toBe(true);
    expect(ghost.attrs.get('aria-hidden')).toBe('true');
    expect(children).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(899);
    expect(classes.has('is-rising')).toBe(true);
    await vi.advanceTimersByTimeAsync(1);
    await handle.finished;
    expect(classes.size).toBe(0);
    expect(ghost.removed).toBe(true);
  });

  it('cancel cleans up at once and reduced motion adds nothing', async () => {
    vi.useFakeTimers();
    const a = makeItem();
    const handle = playRise(a.item, false);
    handle.cancel();
    await handle.finished;
    expect(a.classes.size).toBe(0);
    expect(a.ghost.removed).toBe(true);

    const b = makeItem();
    await playRise(b.item, true).finished;
    expect(b.classes.size).toBe(0);
    expect(b.children).toHaveLength(0);
  });
});
