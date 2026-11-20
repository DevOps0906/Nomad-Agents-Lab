import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';

const tokensDir = resolve(import.meta.dirname, '../design/tokens');

/**
 * design/tokens/tokens.css는 Tailwind v4 `@theme` 형식이다(디자인 정본, 읽기만).
 * Tailwind 없이 쓰므로 빌드 때 `@theme {`만 `:root {`로 바꿔 일반 CSS 변수로 만든다.
 */
function tokensCss(): Plugin {
  return {
    name: 'ssr-tokens-css',
    enforce: 'pre',
    transform(code, id) {
      if (!id.replace(/\\/g, '/').endsWith('/design/tokens/tokens.css')) return null;
      return { code: code.replace(/@theme\s*\{/, ':root {'), map: null };
    },
  };
}

export default defineConfig({
  main: {
    build: { externalizeDeps: false },
  },
  preload: {
    // sandbox preload는 require를 쓸 수 없으므로 단일 CJS 번들로 만든다.
    build: { externalizeDeps: false, isolatedEntries: true },
  },
  renderer: {
    plugins: [tokensCss(), react()],
    server: { fs: { allow: [resolve(import.meta.dirname, 'src/renderer'), tokensDir] } },
  },
});
