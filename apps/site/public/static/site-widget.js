// Rapiz's own website chat bubble (apps/site/README.md "Website chat"). The site key is filled in
// per deployment: by the edge server (Caddy `templates`, env RAPIZ_SITE_WIDGET_KEY) or at build
// time (PUBLIC_RAPIZ_WIDGET_KEY). Unfilled, the placeholders stay as they are and nothing loads.
(() => {
  // An unfilled placeholder starts with a brace (no literal double brace here: Caddy would parse it).
  const filled = value => (value.startsWith('{') ? '' : value.trim());
  const key = filled('{{env "RAPIZ_SITE_WIDGET_KEY"}}');
  if (!/^wk_[A-Za-z0-9]{22}$/.test(key) || window.__rapizWidget) return;
  const src = filled('{{env "RAPIZ_SITE_WIDGET_SRC"}}') || '/widget.js';
  const api = filled('{{env "RAPIZ_SITE_WIDGET_API"}}');
  const script = document.createElement('script');
  script.async = true;
  script.src = `${src}${src.includes('?') ? '&' : '?'}key=${encodeURIComponent(key)}`;
  if (api) script.dataset.api = api;
  // Questions offered under the greeting (apps/widget README "Look").
  script.dataset.starters = 'Xem bảng giá|Tìm hiểu tính năng|Đặt lịch demo';
  document.head.append(script);
})();
