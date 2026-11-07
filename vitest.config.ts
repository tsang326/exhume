import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/exhumed/**', '**/*.dom.test.ts'],
    setupFiles: ['src/test-support/setup.ts'],
    testTimeout: 60_000,
  },
});
