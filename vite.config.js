import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // 低语法目标：iOS 12 及以上的 WebKit 都能解析
  build: { target: 'es2019' },
  server: {
    host: '127.0.0.1',
    proxy: { '/api': 'http://127.0.0.1:3001', '/uploads': 'http://127.0.0.1:3001' },
  },
});
