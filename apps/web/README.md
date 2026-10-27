# @agent-sales/web

Dashboard SPA (ADR-009): Vite 8, React 19, TanStack Router (file routes in `src/routes`, generated `src/routeTree.gen.ts`), TanStack Query, Tailwind v4, **shadcn/ui** (Radix base, `components.json`), i18next with `@agent-sales/i18n`. Brand tokens (Rapiz orange, Be Vietnam Pro) come from `@agent-sales/ui/tokens.css`.

```bash
pnpm --filter @agent-sales/web dev        # http://localhost:5173, /api proxied to :3000
pnpm --filter @agent-sales/web test       # Vitest + Testing Library (jsdom)
pnpm --filter @agent-sales/web build      # typecheck + vite build + bundle budget (≤ 250 KB gzip initial)
pnpm --filter @agent-sales/web test:e2e   # Playwright smoke tests on the production build, API mocked
pnpm --filter @agent-sales/web exec shadcn add <component>   # add a shadcn/ui component to src/components/ui
```

Environment: `VITE_WIDGET_URL` (optional) is the public URL of the chat widget bundle shown in the website embed code (`src/lib/env.ts`). Defaults: `http://localhost:5174/widget.js` in dev, `https://widget.rapiz.vn/v1/widget.js` in production builds.

Layout and rules: `docs/ARCHITECTURE.md` §4 — `features/<module>` mirrors backend modules and never imports another feature (compose in `routes/`); `lib/api-client.ts` is the only `fetch`; no barrels; strings from `@agent-sales/i18n`. Budgets: `docs/16` §1.

- `src/components/ui/` — shadcn/ui components, owned code. Restyle through tokens, not by forking variants per page. The chat panel uses shadcn's `message-scroller`, `message`, `bubble`.
- `src/lib/session.ts` — session store: access token in memory, HttpOnly refresh cookie, `rapiz.session` hint in localStorage so logged-out visitors make no refresh call; `ensureSession()` guards `/app` and `/admin`.
- `src/lib/query-keys.ts` — query keys shared across features (e.g. a FAQ edit refreshes the bot's readiness).
- `/admin/*` — platform back-office (LLM providers and tier routing), shown only to `isPlatformAdmin` users; lives here until `apps/admin` exists (ADR-009 note).
- Shell: shadcn `Sidebar` with the Studio Admin layout model (see `THIRD_PARTY_NOTICES.md`). User preferences — mode, colour preset, sidebar variant/collapse, content width, sticky navbar — live in `src/lib/preferences/registry.ts` (single source; `vite.config.ts` injects the boot script that applies them before first paint). Pages do not set their own max width or page padding; full-bleed pages set `data-content-padding="false"`.
- `e2e/responsive.spec.ts` fails the build on horizontal overflow at 375/768/1280/1920 px and in every layout combination, with long Vietnamese content. Run it after any layout change.
