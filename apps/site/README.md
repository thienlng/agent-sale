# apps/site — Rapiz marketing site

Static Astro site served at the root domain (`rapiz.vn`); the dashboard (`apps/web`) lives at
`app.rapiz.vn` (docs/04, ADR-009). Moved here from the standalone `ai-sale-landingpage`
repository in T-121; its design records are in `docs/designs/T-121/`.

```bash
pnpm --filter @agent-sales/site dev        # http://localhost:4321
pnpm --filter @agent-sales/site build      # static output in dist/
pnpm --filter @agent-sales/site test:e2e   # Playwright against `astro preview` on :4322
```

## Links into the dashboard

"Dùng thử miễn phí" goes to `<app>/signup` and "Đăng nhập" to `<app>/login`
(`src/lib/app-links.ts`). `<app>` is `PUBLIC_APP_URL`; defaults are `http://localhost:5173` in
`astro dev` and `https://app.rapiz.vn` in builds. The dashboard links back with `VITE_SITE_URL`
(account menu "Trang chủ Rapiz", logo on the sign-in pages).

On phones the header keeps one call to action (free trial); "Đăng nhập" moves into the menu.

## Content and assets

- The demo conversations are illustrative scenarios in `src/pages/index.astro`, not an AI call.
- Rabbit illustrations are in `public/images/` (selection rationale: `docs/designs/T-121/ASSET-SELECTION.md`);
  every animation has a still frame for `prefers-reduced-motion`.
- Fonts (Fraunces for the site, Plus Jakarta Sans) are self-hosted WOFF2 copies with their OFL
  licenses and checksums in `public/fonts/`.
- Light/dark: the header toggle stores the choice as `rapiz-theme` in localStorage; first visit
  follows the system. Colours are in `src/styles/theme.css`.
