/** Dev server of `apps/widget`; production default is the public widget host (docs/07 §5). */
const DEV_WIDGET_URL = 'http://localhost:5174/widget.js';
const PROD_WIDGET_URL = 'https://widget.rapiz.vn/v1/widget.js';

/** URL of the chat widget bundle used in the embed snippet shown to staff. */
export function widgetUrl(): string {
  const configured = import.meta.env.VITE_WIDGET_URL?.trim();
  if (configured) return configured;
  return import.meta.env.DEV ? DEV_WIDGET_URL : PROD_WIDGET_URL;
}

/** Dev server of `apps/site`; production default is the public marketing site (docs/04). */
const DEV_SITE_URL = 'http://localhost:4321/';
const PROD_SITE_URL = 'https://rapiz.vn/';

/** URL of the marketing site (`apps/site`), opened from the account menu and the auth pages. */
export function siteUrl(): string {
  const configured = import.meta.env.VITE_SITE_URL?.trim();
  if (configured) return configured;
  return import.meta.env.DEV ? DEV_SITE_URL : PROD_SITE_URL;
}
