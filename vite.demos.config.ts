import { builtinModules } from 'node:module';
import { defineConfig } from 'vite';

// Bundles scripts/make-demo-disks.ts for Node. Output goes under node_modules (git-ignored).
export default defineConfig({
  publicDir: false,
  logLevel: 'warn',
  build: {
    ssr: 'scripts/make-demo-disks.ts',
    outDir: 'node_modules/.cache/exhume-demos',
    emptyOutDir: false,
    copyPublicDir: false,
    target: 'node22',
    minify: false,
    sourcemap: false,
    reportCompressedSize: false,
    rollupOptions: {
      external: [/^node:/, ...builtinModules],
      output: { format: 'es', entryFileNames: 'make-demo-disks.mjs', inlineDynamicImports: true },
    },
  },
  ssr: { noExternal: true, target: 'node' },
});
