---
id: T-005
title: Scaffold apps/web Next.js dashboard shell with auth pages
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

The dashboard is a Next.js App Router app (`docs/03-screens-and-routes.md`, `docs/11-code-structure-and-conventions.md`). This task creates the app shell (layout, sidebar, header, i18n, design system base) and static auth pages, without backend wiring.

## Goal

`pnpm --filter web dev` serves `/login`, `/signup` and an authenticated `/app` shell with sidebar navigation matching `docs/03-screens-and-routes.md` §2, in vi and en.

## Scope

- `apps/web` Next.js 15+ App Router, TypeScript, Tailwind, shadcn/ui base, next-intl (`vi`, `en`), TanStack Query provider, React Hook Form + Zod.
- Route groups: `(auth)` for `/login`, `/signup`, `(app)` for `/app/**` with the sidebar from the route map (links only; pages can be placeholders).
- `packages/ui` with the shared design tokens and a few primitives (Button, Input, Card, Table shell).
- `packages/i18n` with message files; no hard-coded UI strings.
- Playwright smoke test: login page renders in both locales; sidebar links exist.
- `apps/web/README.md`.

## Out of scope

- Real authentication (depends on T-003/T-004 + an auth task); any data pages.

## Acceptance criteria

- [ ] All sidebar items from `docs/03-screens-and-routes.md` §2 exist as routes (placeholder content allowed).
- [ ] Locale switch vi/en works; no hard-coded strings in components (lint rule or review).
- [ ] Lighthouse accessibility ≥ 90 on `/login`.
- [ ] `pnpm check` green; Playwright smoke test included.

## Plan

(to be written by the implementer)

## Log

- 2026-10-23 — created.

## Links

- Docs: `docs/03-screens-and-routes.md`, `docs/11-code-structure-and-conventions.md`
