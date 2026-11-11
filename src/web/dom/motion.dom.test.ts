// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { initMotion } from './motion';

type Callback = (entries: IntersectionObserverEntry[], obs: IntersectionObserver) => void;

interface FakeObserver {
  observed: Element[];
  unobserved: Element[];
  options: IntersectionObserverInit | undefined;
  fire(target: Element, isIntersecting: boolean): void;
}

function makeFakeCtor(): { ctor: typeof IntersectionObserver; instances: FakeObserver[] } {
  const instances: FakeObserver[] = [];
  class Fake {
    private readonly cb: Callback;
    readonly state: FakeObserver;
    constructor(cb: Callback, options?: IntersectionObserverInit) {
      this.cb = cb;
      this.state = {
        observed: [],
        unobserved: [],
        options,
        fire: (target, isIntersecting) => {
          this.cb(
            [{ target, isIntersecting } as unknown as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
          );
        },
      };
      instances.push(this.state);
    }
    observe(el: Element): void {
      this.state.observed.push(el);
    }
    unobserve(el: Element): void {
      this.state.unobserved.push(el);
    }
  }
  return { ctor: Fake as unknown as typeof IntersectionObserver, instances };
}

beforeEach(() => {
  document.documentElement.className = '';
  document.body.innerHTML =
    '<section class="rise" id="a"></section><div class="bar-track" id="b"></div><p id="c"></p>';
});

describe('initMotion', () => {
  it('under reduced motion adds js and in at once, without observing', () => {
    const { ctor, instances } = makeFakeCtor();
    initMotion({ doc: document, reduced: true, observerCtor: ctor });
    expect(document.documentElement.classList.contains('js')).toBe(true);
    expect(document.getElementById('a')?.classList.contains('in')).toBe(true);
    expect(document.getElementById('b')?.classList.contains('in')).toBe(true);
    expect(document.getElementById('c')?.classList.contains('in')).toBe(false);
    expect(instances).toHaveLength(0);
  });

  it('without an observer adds js and in at once', () => {
    initMotion({ doc: document, reduced: false, observerCtor: undefined });
    expect(document.documentElement.classList.contains('js')).toBe(true);
    expect(document.getElementById('a')?.classList.contains('in')).toBe(true);
    expect(document.getElementById('b')?.classList.contains('in')).toBe(true);
  });

  it('with an observer waits for the first intersection, then unobserves', () => {
    const { ctor, instances } = makeFakeCtor();
    initMotion({ doc: document, reduced: false, observerCtor: ctor });
    const a = document.getElementById('a');
    const b = document.getElementById('b');
    expect(document.documentElement.classList.contains('js')).toBe(true);
    expect(a?.classList.contains('in')).toBe(false);
    expect(instances).toHaveLength(1);
    const obs = instances[0];
    expect(obs?.options?.threshold).toBe(0.2);
    expect(obs?.observed).toEqual([a, b]);

    if (!a || !b || !obs) throw new Error('setup');
    obs.fire(a, false);
    expect(a.classList.contains('in')).toBe(false);
    obs.fire(a, true);
    expect(a.classList.contains('in')).toBe(true);
    expect(b.classList.contains('in')).toBe(false);
    expect(obs.unobserved).toEqual([a]);
  });

  it('never touches inline styles', () => {
    initMotion({ doc: document, reduced: true, observerCtor: undefined });
    expect(document.getElementById('a')?.getAttribute('style')).toBeNull();
  });
});
