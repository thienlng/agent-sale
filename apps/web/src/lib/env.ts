/** Dev server of `apps/widget`; production default is the public widget host (docs/07 §5). */
const DEV_WIDGET_URL = 'http://localhost:5174/widget.js';
const PROD_WIDGET_URL = 'https://widget.rapiz.vn/v1/widget.js';

/** URL of the chat widget bundle used in the embed snippet shown to staff. */
export function widgetUrl(): string {
  const configured = import.meta.env.VITE_WIDGET_URL?.trim();
  if (configured) return configured;
  return import.meta.env.DEV ? DEV_WIDGET_URL : PROD_WIDGET_URL;
}
