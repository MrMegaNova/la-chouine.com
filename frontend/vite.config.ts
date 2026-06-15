import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  server: {
    host: true,     // écoute sur 0.0.0.0 — requis dans Docker
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL ?? 'http://localhost:3000',
        changeOrigin: true,
      },
      // WebSocket PvP : proxifié vers le backend en développement.
      '/ws': {
        target: process.env.VITE_API_URL ?? 'http://localhost:3000',
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: {
    // Env par défaut = node (logique pure : moteur, stores). Les tests de
    // composants React (#129) optent pour jsdom via `// @vitest-environment
    // jsdom` en tête de fichier.
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
  },
});
