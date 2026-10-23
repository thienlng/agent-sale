# @agent-sales/web

Dashboard SPA (ADR-009): Vite 8, React 19, TanStack Router (file routes in `src/routes`, generated `src/routeTree.gen.ts`), TanStack Query, Tailwind v4 + `@agent-sales/ui` tokens, i18next with `@agent-sales/i18n`.

```bash
pnpm --filter @agent-sales/web dev      # http://localhost:5173, /api proxied to :3000
pnpm --filter @agent-sales/web test     # Vitest + Testing Library (jsdom)
pnpm --filter @agent-sales/web build    # typecheck + vite build (size report)
```

Layout and rules: `docs/ARCHITECTURE.md` §4 — `features/<module>` mirrors backend modules; `lib/api-client.ts` is the only `fetch`; no barrels; strings from `@agent-sales/i18n`; `routes/-components/` for colocated non-route files. Budgets: `docs/16` §1.
