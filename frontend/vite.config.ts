import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const apiOrigin = process.env.VITE_DEV_API_ORIGIN ?? 'http://localhost:8000';
const apiWebSocketOrigin = apiOrigin.replace(/^http/, 'ws');

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': apiOrigin,
      '/health': apiOrigin,
      '/ready': apiOrigin,
      '/ws': {
        target: apiWebSocketOrigin,
        ws: true,
      },
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
