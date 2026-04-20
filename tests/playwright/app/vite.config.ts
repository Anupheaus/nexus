import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

const appDir = path.resolve(__dirname);

export default defineConfig({
  root: appDir,
  plugins: [react()],
  define: {
    global: 'globalThis',
  },
  resolve: {
    alias: {
      buffer: 'buffer',
    },
  },
  server: {
    port: 5173,
    fs: {
      allow: [
        appDir,
        path.resolve(__dirname, '../../..'),
      ],
    },
    proxy: {
      '/test': {
        target: 'http://localhost:3010',
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
