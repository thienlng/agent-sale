# apps/site — Rapiz marketing site

Static pages served at the root of the public host; the dashboard (`apps/web`) shares the host and
owns every other path (`/login`, `/signup`, `/app/…`). The pages are plain HTML, CSS and JS in
`public/`; Astro only copies them to `dist/` so the build, preview and Docker steps stay the same.

```bash
pnpm --filter @agent-sales/site build      # copies public/ to dist/
pnpm --filter @agent-sales/site preview    # http://localhost:4321
pnpm --filter @agent-sales/site test:e2e   # Playwright against `astro preview` on :4322
```

## Pages

| Path | Source |
|---|---|
| `/` | `public/index.html` (hand-written; header, footer and plan cards are generated blocks) |
| `/nganh/*/` | Industry pages: retail, villa and homestay, spa and salon, education, software |
| `/tinh-nang/*/` | Feature pages: sales bot, Facebook comments, inbox, AI training, assistant, customers and analytics |
| `/tich-hop/`, `/bao-mat/`, `/bang-gia/`, `/dat-lich-demo/` | Integrations, security, pricing, demo request |
| `/ve-rapiz/` | About Rapiz |
| `/privacy/`, `/terms/` | Privacy policy and terms of use (`LEGAL_PAGES` in `tools/site_content.py`). Google links them from its sign-in screen, so they stay public behind the beta gate (`infra/deploy/beta-gate.sh`). Write only what the product does; update `LEGAL_UPDATED` on every change. |

Static files live in `public/static/` (CSS and JS), `public/images/` and `public/fonts/`. The
production routes for these paths are in `infra/deploy/Caddyfile` and, for the dev tunnel, in
`scripts/dev-tunnel-proxy.mjs`; a new top-level folder needs a route in both.

## Editing content

Sub-pages are generated. Edit the copy and data in `tools/site_content.py` (layout in
`tools/build_site.py`, larger HTML blocks such as the feature demos in `tools/templates/`), then run:

```bash
python3 apps/site/tools/build_site.py
```

It rewrites every `public/<slug>/index.html` and the marked blocks of `public/index.html`
(`<!--#site-head-->`, `<!--#site-foot-->`, `<!--#plans-->`, `<!--#plan-cards-->`, `<!--#agent-loop-->`). Do not edit
generated pages by hand; the next build overwrites them. `public/` is excluded from Prettier for
the same reason.

- Plan prices and limits come from plan version 1 in `packages/db/migrations/0015_billing.sql`.
  Update `PLANS` and `COMPARE` when a new plan version is published.
- `FEATURES.vi.md` lists which features the pages may promise and the honesty rules (labels for
  Beta and upcoming channels, illustrated conversations marked as such, no competitor names).
- Copy is Vietnamese marketing text written without AI tells: no em dashes, no repeated heading
  formulas, no invented customers or numbers.
- The demo request form (`/dat-lich-demo/`) posts JSON to the form's `data-endpoint` when it is
  set; without it the page only shows a local preview of the request.
- The generator needs Python 3.12 or later (f-strings with backslashes), for example
  `uv run --python 3.12 --no-project python apps/site/tools/build_site.py`.

## Website chat

The pages carry Rapiz's own chat bubble (the `apps/widget` script), loaded by
`public/static/site-widget.js` only when a site key is set. Without one the loader does nothing and
the pages make no extra request.

- **Production (Docker image).** The image stays key-free. The edge server fills the loader from its
  environment (Caddy `templates`, `infra/deploy/Caddyfile`): set `RAPIZ_SITE_WIDGET_KEY` in the
  server `.env` and restart `edge`. The bubble then loads the same-origin `/widget.js`.
- **Build time (local or self-built sites).** `PUBLIC_RAPIZ_WIDGET_KEY` fills the loader in `dist/`
  during `astro build`. `PUBLIC_RAPIZ_WIDGET_SRC` (default `/widget.js`) and
  `PUBLIC_RAPIZ_WIDGET_API` (the widget's `data-api`, default: the script's origin) point at another
  widget host, for example `http://localhost:5174/widget.js` and `http://localhost:3000`.
- **The key.** `pnpm --filter @agent-sales/backend rapiz-site-bot seed --owner <email> --domains
  rapiz.io,www.rapiz.io` creates or updates the Rapiz business, its bot, its knowledge and the
  website connection, and prints the key (`wk_…`). The bot's content is
  `apps/backend/src/cli/rapiz-site-bot/content.ts`; it may only state what these pages and
  `FEATURES.vi.md` say, so update it with the copy (prices included).
- **The plans.** The seed also puts the four plans (`SITE_PLANS`) in the bot's catalog as service
  products, one variant per prepaid term, so the bot answers price questions with plan cards. Their
  pictures are `public/images/plans/*.png`, rendered by `node apps/site/tools/plan_images.mjs`
  (re-run it after changing the plans). The seed copies each picture into the catalog from `--site`
  (default `https://<first domain>`) when the product has none, so deploy the site first.

The bot reads the page the visitor writes from. Every page names its parts with
`data-rapiz-section` (lowercase, `hero`, `pricing`, `plan-sales_smart`, …) and, where a short
summary helps, `data-rapiz-context` (at most 300 characters, faithful to the visible text, such as a
plan's prices per term). The generator writes both on generated pages; keep them on hand-written
sections of `index.html`. `e2e/landing.spec.ts` checks that every page has named sections.

## Assets

- Fonts: Inter and Inter Tight, self-hosted in `public/fonts/` (OFL-1.1, notices in
  `THIRD_PARTY_NOTICES.md`). The pages make no third-party requests; `e2e/landing.spec.ts` checks it.
- Logos are the faceted brand release files, unchanged (`public/images/rapiz-*-faceted*.svg`). Product screenshots
  show demo data; the retail photo is CC0 (see the notices).
