import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// 프로토타입(index.html)과 단일 버퍼 벤치 페이지(bench.html)를 함께 빌드한다.
export default defineConfig({
  build: {
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        bench: resolve(import.meta.dirname, 'bench.html'),
      },
    },
  },
});
