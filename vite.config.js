import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// AI Reader · Vite 配置
// 说明：pdfjs-dist 的 worker 通过 `?url` 后缀在源码中导入，
// 由 Vite 打包成独立资源，避免线上部署时 worker 404。
export default defineConfig({
  // 使用相对路径，支持部署在任意子路径下（避免 /assets/... 绝对根路径 404）
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    open: false,
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2020',
    chunkSizeWarningLimit: 2500,
  },
  optimizeDeps: {
    exclude: [],
  },
});
