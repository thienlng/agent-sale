---
id: T-005
title: Scaffold apps/web Vite + React dashboard shell with auth pages
status: next
type: chore
priority: P0
owner:
feature_ids: [ACC-01, ACC-02]
created: 2026-10-23
updated: 2026-10-23
branch:
pr:
parent:
---

## Context

The dashboard is a Vite + React SPA (ADR-009) built for perceived speed: instant client-side navigation, cached data, optimistic UI, modern design system. This task creates the app shell (layout, sidebar, header, routing, i18n, design tokens) and static auth pages, without backend wiring. Budgets in `docs/16-performance-and-scale.md` apply from day one.

## Goal

`pnpm --filter web dev` serves `/login`, `/signup` and an authenticated `/app` shell with the sidebar navigation from `docs/03-screens-and-routes.md` §2, in vi and en, within the frontend performance budgets.

## Scope

- `apps/web`: Vite, React 19, TypeScript strict, TanStack Router (file-based routes, preload on intent), TanStack Query provider with sensible defaults (`staleTime`, retry), Tailwind CSS v4, shadcn/ui base, `motion`, `cmdk` palette shell, `react-hook-form` + Zod, `i18next` (`vi`, `en`), dark mode, `lucide-react`.
- Route groups: `/login`, `/signup`, `/app/*` with the full sidebar from the route map (placeholder pages allowed), 404 and error boundaries, skeleton loaders.
- `packages/ui`: design tokens (CSS variables), primitives (Button, Input, Card, Table shell, Skeleton, Toast), Storybook or a `/app/_kit` showcase route.
- `packages/i18n`: message files; lint rule or test forbidding hard-coded UI strings.
- Bundle-size check in CI (`vite build` report; shell ≤ 250 KB gzip) and Lighthouse CI on `/login` (perf ≥ 90, a11y ≥ 90).
- Playwright smoke test: login renders in both locales; sidebar links exist; navigation between two routes does not reload the page.
- `apps/web/README.md`.

## Out of scope

- Real authentication (needs T-003/T-004 + an auth task); any data pages; `apps/admin`.

## Acceptance criteria

- [ ] All sidebar items from `docs/03-screens-and-routes.md` §2 exist as routes (placeholder content allowed) and navigation is client-side.
- [ ] Locale switch vi/en works; no hard-coded strings in components.
- [ ] `vite build` shell bundle ≤ 250 KB gzip; Lighthouse perf ≥ 90 and a11y ≥ 90 on `/login`.
- [ ] Dark mode and reduced-motion respected.
- [ ] `pnpm check` green; Playwright smoke test included.

## Plan

(to be written by the implementer)

## Log

- 2026-10-23 — created.
- 2026-10-23 — rewritten for ADR-009 (Vite SPA instead of Next.js).

## Links

- Docs: `docs/03-screens-and-routes.md`, `docs/11-code-structure-and-conventions.md`, `docs/16-performance-and-scale.md`, `docs/adr/ADR-009-tech-stack-for-speed-and-scale.md`
