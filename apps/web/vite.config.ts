import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

import { bootScript } from './src/lib/preferences/registry';

/** Applies stored UI preferences in <head>, before the first paint (no theme/layout flash). */
function preferencesBoot(): Plugin {
  return {
    name: 'razpi-preferences-boot',
    transformIndexHtml: () => [{ tag: 'script', children: bootScript(), injectTo: 'head' }],
  };
}

export default defineConfig({
  plugins: [
    // Must run before react(): generates src/routeTree.gen.ts from src/routes.
    tanstackRouter({ target: 'react', autoCodeSplitting: true, routesDirectory: './src/routes' }),
    react(),
    tailwindcss(),
    preferencesBoot(),
  ],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  server: { port: 5173, proxy: { '/api': 'http://localhost:3000' } },
  build: {
    sourcemap: true,
    // Budget: shell ≤ 250 KB gzip (docs/16 §1); Vite warns above this uncompressed size.
    chunkSizeWarningLimit: 600,
  },
});
