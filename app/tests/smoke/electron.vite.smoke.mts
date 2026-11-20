// DB 스모크 진입점만 Main 설정(externalizeDeps: false)과 같게 번들한다 → out/smoke/index.js
import { resolve } from 'node:path';
import { defineConfig } from 'electron-vite';

export default defineConfig({
  main: {
    build: {
      externalizeDeps: false,
      outDir: resolve(import.meta.dirname, '../../out/smoke'),
      lib: { entry: resolve(import.meta.dirname, 'db-smoke.ts') },
    },
  },
});
