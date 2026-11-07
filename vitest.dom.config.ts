import { defineConfig } from 'vitest/config';

// DOM tests only. No global environment: each file opts in with
// `// @vitest-environment happy-dom` as its first line.
export default defineConfig({
  test: {
    include: ['**/*.dom.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/exhumed/**'],
    setupFiles: ['src/test-support/setup.ts'],
    testTimeout: 60_000,
  },
});
