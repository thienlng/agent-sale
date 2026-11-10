import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { URL } from 'node:url';

import { defineConfig } from 'astro/config';

/**
 * Fills the website chat loader (`static/site-widget.js`) at build time when
 * PUBLIC_RAPIZ_WIDGET_KEY is set (local and self-built sites). Production images stay key-free:
 * there the edge server fills the same placeholders from its environment (README "Website chat").
 */
function siteWidget() {
  return {
    name: 'rapiz-site-widget',
    hooks: {
      'astro:build:done': async ({ dir }) => {
        const values = {
          RAPIZ_SITE_WIDGET_KEY: process.env['PUBLIC_RAPIZ_WIDGET_KEY'],
          RAPIZ_SITE_WIDGET_SRC: process.env['PUBLIC_RAPIZ_WIDGET_SRC'],
          RAPIZ_SITE_WIDGET_API: process.env['PUBLIC_RAPIZ_WIDGET_API'],
        };
        if (!values.RAPIZ_SITE_WIDGET_KEY) return;
        const file = new URL('static/site-widget.js', dir);
        let text = await readFile(file, 'utf8');
        for (const [name, value] of Object.entries(values))
          text = text.replaceAll(`{{env "${name}"}}`, (value ?? '').replace(/['\\\n\r]/g, ''));
        await writeFile(file, text);
      },
    },
  };
}

// Static marketing site (ADR-009). The dashboard lives at PUBLIC_APP_URL (see README).
export default defineConfig({
  site: 'https://rapiz.vn',
  devToolbar: { enabled: false },
  server: { port: 4321 },
  integrations: [siteWidget()],
  // `serve:tunnel` builds a same-origin copy (links to /login, /signup) for the dev tunnel proxy.
  outDir: process.env['SITE_OUT_DIR'] ?? './dist',
});
