// Global error handlers: a fixed message only. Nothing from the event is echoed,
// and nothing but the status region is touched.
import type { StatusRegion } from './status';

export const GLOBAL_ERROR_MESSAGE =
  'Something went wrong on this page. Your current results are unchanged. You can drop another file to try again.';

/** The slice of Window that the handlers need; injectable for tests. */
export interface ErrorEventTarget {
  addEventListener(type: 'error' | 'unhandledrejection', listener: () => void): void;
}

export function installGlobalErrorHandlers(
  status: StatusRegion,
  target: ErrorEventTarget = window,
): void {
  const show = (): void => {
    status.set(GLOBAL_ERROR_MESSAGE);
  };
  target.addEventListener('error', show);
  target.addEventListener('unhandledrejection', show);
}
