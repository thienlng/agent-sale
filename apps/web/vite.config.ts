import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { defineConfig, type Plugin } from 'vite';

import { bootScript } from './src/lib/preferences/registry';

/**
 * Applies stored UI preferences in <head>, before the first paint (no theme/layout flash). A
 * classic external script, not an inline one, so the Content-Security-Policy needs neither
 * 'unsafe-inline' nor a hash (infra/deploy/Caddyfile); it still blocks parsing like inline code.
 */
function preferencesBoot(): Plugin {
  const file = 'boot.js';
  return {
    name: 'rapiz-preferences-boot',
    transformIndexHtml: () => [{ tag: 'script', attrs: { src: `/${file}` }, injectTo: 'head' }],
    configureServer(server) {
      server.middlewares.use(`/${file}`, (_req, res) => {
        res.setHeader('Content-Type', 'text/javascript');
        res.end(bootScript());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: file, source: bootScript() });
    },
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
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3000',
      // Product pictures are host-relative `/media/<key>` paths (docs/lodging.md "Pictures"):
      // in dev they come from the local bucket, like scripts/dev-tunnel-proxy.mjs serves them.
      '/media': {
        target: `http://127.0.0.1:${process.env.S3_PORT ?? 9000}`,
        rewrite: (url) => `/${process.env.S3_BUCKET || 'rapiz-local'}${url.slice('/media'.length)}`,
      },
    },
  },
  // Pre-bundle libraries that lazy routes pull in, so the dev server never re-optimizes
  // mid-session (which briefly loads two copies of React and forces a reload).
  optimizeDeps: { include: ['recharts', 'react-day-picker', 'cmdk', 'radix-ui'] },
  build: {
    sourcemap: true,
    // Budget: shell ≤ 250 KB gzip (docs/16 §1); Vite warns above this uncompressed size.
    chunkSizeWarningLimit: 600,
  },
});
