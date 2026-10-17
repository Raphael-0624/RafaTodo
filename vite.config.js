import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import legacy from '@vitejs/plugin-legacy';

export default defineConfig({
  plugins: [
    react(),
    // 为老 iPad / 老 Safari 额外生成 SystemJS 兼容包并注入 polyfill
    legacy({
      targets: ['defaults', 'ios >= 9', 'safari >= 9'],
      modernPolyfills: ['es.promise.all-settled'],
    }),
  ],
  build: { target: 'es2019' },
  server: {
    host: '127.0.0.1',
    proxy: { '/api': 'http://127.0.0.1:3001', '/uploads': 'http://127.0.0.1:3001' },
  },
});
