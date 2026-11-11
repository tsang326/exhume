import './style.css';
import { initMotion } from './web/dom/motion';
import { startApp } from './web/app';

try {
  let reduced = false;
  try {
    reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    reduced = false;
  }
  initMotion({
    doc: document,
    reduced,
    observerCtor: typeof IntersectionObserver === 'function' ? IntersectionObserver : undefined,
  });
} catch {
  // decoration only: the page works without it
}

startApp();
