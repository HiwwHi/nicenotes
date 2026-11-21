import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 版本号从根 package.json 来，别在界面上手写一个会忘更新的字符串
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  version?: string;
};

export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version ?? 'dev'),
  },
  server: {
    port: 5183,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 700,
  },
});
