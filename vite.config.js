import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src',
  build: { outDir: '../dist', emptyOutDir: true },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3456',
        changeOrigin: true,
      }
    }
  }
});
