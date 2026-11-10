interface ImportMetaEnv {
  /** Public URL of the dashboard (apps/web), without a trailing slash. */
  readonly PUBLIC_APP_URL?: string;
  /** Build-time site key of Rapiz's own website chat bubble (`static/site-widget.js`). */
  readonly PUBLIC_RAPIZ_WIDGET_KEY?: string;
  /** Widget script URL for that bubble (default `/widget.js`, same origin). */
  readonly PUBLIC_RAPIZ_WIDGET_SRC?: string;
  /** API origin for the bubble when it is not the script's origin. */
  readonly PUBLIC_RAPIZ_WIDGET_API?: string;
}
