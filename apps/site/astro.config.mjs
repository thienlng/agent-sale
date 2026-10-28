import { defineConfig } from 'astro/config';

// Static marketing site (ADR-009). The dashboard lives at PUBLIC_APP_URL (see README).
export default defineConfig({
  site: 'https://rapiz.vn',
  devToolbar: { enabled: false },
  server: { port: 4321 },
});
