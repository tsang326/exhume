import { describe, expect, it } from 'vitest';
import { GLOBAL_ERROR_MESSAGE, installGlobalErrorHandlers, type ErrorEventTarget } from './errors';
import type { StatusRegion } from './status';

describe('installGlobalErrorHandlers', () => {
  it('registers error and unhandledrejection and writes only the fixed message', () => {
    const handlers = new Map<string, (ev?: unknown) => void>();
    const target: ErrorEventTarget = {
      addEventListener: (type, listener) => void handlers.set(type, listener),
    };
    const writes: string[] = [];
    const status: StatusRegion = { set: (t) => void writes.push(t), clear: () => void writes.push('') };

    installGlobalErrorHandlers(status, target);
    expect([...handlers.keys()].sort()).toEqual(['error', 'unhandledrejection']);

    handlers.get('error')?.({ message: 'secret page text' });
    handlers.get('unhandledrejection')?.({ reason: 'disk text' });
    expect(writes).toEqual([GLOBAL_ERROR_MESSAGE, GLOBAL_ERROR_MESSAGE]);
    expect(GLOBAL_ERROR_MESSAGE.length).toBeGreaterThanOrEqual(1);
    expect(GLOBAL_ERROR_MESSAGE.length).toBeLessThanOrEqual(300);
  });
});
