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

## Assets

- Fonts: Inter and Inter Tight, self-hosted in `public/fonts/` (OFL-1.1, notices in
  `THIRD_PARTY_NOTICES.md`). The pages make no third-party requests; `e2e/landing.spec.ts` checks it.
- Logos are the faceted brand release files, unchanged (`public/images/rapiz-*-faceted*.svg`). Product screenshots
  show demo data; the retail photo is CC0 (see the notices).
