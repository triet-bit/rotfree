import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src',
  base: './',
  build: { outDir: '../dist', emptyOutDir: true, target: 'chrome130', chunkSizeWarningLimit: 1500 },
  server: { port: 5199, strictPort: false },
});
