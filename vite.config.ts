import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    modulePreload: { polyfill: false },
    assetsInlineLimit: 0,
  },
  worker: { format: 'es' },
});
