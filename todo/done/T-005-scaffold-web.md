---
id: T-005
title: Web dashboard — auth, bots, FAQ, settings, test chat, admin LLM settings
status: done
type: feature
priority: P0
owner: @agent:claude
feature_ids: [ACC-01, ACC-02, BOT-01, BOT-02, BOT-04, BOT-07, BOT-12, BOT-13, BOT-14, ADM-06]
created: 2026-10-23
updated: 2026-10-24
branch: feat/T-015-m2-bot-playground (milestone M2)
pr:
parent:
---

## Context

The dashboard is a Vite + React SPA (ADR-009) built for perceived speed: instant client-side navigation, cached data, optimistic UI, modern design system. This task creates the app shell (layout, sidebar, header, routing, i18n, design tokens) and static auth pages, without backend wiring. Budgets in `docs/16-performance-and-scale.md` apply from day one.

## Goal

An owner signs up, creates a bot, fills store details and FAQs, and tests it in a chat panel; a platform admin configures LLM servers and tier routing — fast, modern, vi/en, within the performance budgets.

## Scope

- `apps/web`: Vite, React 19, TypeScript strict, TanStack Router (file-based routes, preload on intent), TanStack Query provider with sensible defaults (`staleTime`, retry), Tailwind CSS v4, shadcn/ui base, `motion`, `cmdk` palette shell, `react-hook-form` + Zod, `i18next` (`vi`, `en`), dark mode, `lucide-react`.
- Route groups: `/login`, `/signup`, `/app/*` with the full sidebar from the route map (placeholder pages allowed), 404 and error boundaries, skeleton loaders.
- `packages/ui`: design tokens (CSS variables), primitives (Button, Input, Card, Table shell, Skeleton, Toast), Storybook or a `/app/_kit` showcase route.
- `packages/i18n`: message files; lint rule or test forbidding hard-coded UI strings.
- Bundle-size check in CI (`vite build` report; shell ≤ 250 KB gzip) and Lighthouse CI on `/login` (perf ≥ 90, a11y ≥ 90).
- Playwright smoke test: login renders in both locales; sidebar links exist; navigation between two routes does not reload the page.
- `apps/web/README.md`.

## Out of scope

- Inbox, channels, CRM, orders, analytics pages (placeholders say "coming soon"), `apps/admin` as a separate build, workspace switcher, command palette, documents/URL knowledge.

## Acceptance criteria

- [x] Real auth: signup/login wired to `/auth/*`, access token in memory, cookie refresh with one retry on 401, `/app` and `/admin` guarded, logout.
- [x] Bots list/create (industry pack), bot space with overview checklist, FAQ CRUD (search, readable placeholders, optimistic delete), settings (store details + behaviour, sticky save), test chat (sources, fallback/handoff/guardrail receipts, tokens, latency).
- [x] Admin `/admin/llm`: providers (Anthropic / OpenAI-compatible, write-only key, connection test), tier routing (primary + fallback, effort); hidden (404) for non-admins.
- [x] All P0 sidebar items exist as client-side routes; vi/en from `@agent-sales/i18n`; dark mode follows the OS; reduced motion respected.
- [x] Initial bundle 183 KB gzip (budget 250, enforced in `build`); Lighthouse `/login` performance 90, accessibility 100, best practices 100 (mobile, production build); LHCI + Playwright smoke in CI (`web` job).
- [x] `pnpm check` green; Vitest 8 tests; Playwright 4 smoke tests.

## Plan

shadcn/ui (Radix base) via CLI in apps/web, Razpi tokens in packages/ui → session/api client → features (identity, bot, knowledge, ai, admin) → routes → tests (Vitest, Playwright) → budget + Lighthouse → docs.

## Log

- 2026-10-23 — created.
- 2026-10-23 — rewritten for ADR-009 (Vite SPA instead of Next.js).

- 2026-10-24 — owner asked for a modern ready-made component kit: shadcn/ui (Radix base) + shadcn chat blocks (message-scroller/message/bubble) instead of hand-written primitives; packages/ui reduced to tokens.
- 2026-10-24 — accessibility: white on #f26b1d is 3.05:1, so text on orange is ink (#1f1612). Fixed a document-scroll bug (shell now exactly one screen tall, only <main> scrolls) found by screenshot review.
- 2026-10-24 — done. Verified: `pnpm check`, Vitest, Playwright, LHCI locally; manual tour against the local backend (signup → bot → FAQ → settings → chat; admin provider + test).

## Links

- Docs: `docs/03-screens-and-routes.md`, `docs/11-code-structure-and-conventions.md`, `docs/16-performance-and-scale.md`, `docs/adr/ADR-009-tech-stack-for-speed-and-scale.md`
