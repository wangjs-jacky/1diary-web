import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: { manifest: true },
  server: {
    port: 4173,
    proxy: { '/v1': { target: 'http://121.43.32.242:3000', changeOrigin: true } },
  },
  preview: { port: 4174 },
  test: {
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
  },
});
