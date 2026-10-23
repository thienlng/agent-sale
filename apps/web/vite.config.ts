import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    // Must run before react(): generates src/routeTree.gen.ts from src/routes.
    tanstackRouter({ target: 'react', autoCodeSplitting: true, routesDirectory: './src/routes' }),
    react(),
    tailwindcss(),
  ],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
  build: {
    sourcemap: true,
    // Budget: shell ≤ 250 KB gzip (docs/16 §1); Vite warns above this uncompressed size.
    chunkSizeWarningLimit: 600,
  },
});
