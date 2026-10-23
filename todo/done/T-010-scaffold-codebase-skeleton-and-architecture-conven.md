---
id: T-010
title: Scaffold codebase skeleton and architecture conventions
status: done
type: chore
priority: P0
owner: @agent:claude
feature_ids: []
created: 2026-10-23
updated: 2026-10-23
branch: chore/T-010-codebase-skeleton
pr:
parent:
---

## Context

Before feature work starts, the repository needs a code organization that coding agents reproduce reliably and that humans can review: one fixed module shape, mechanically enforced boundaries, generators, and a golden example. Researched against 2025–2026 practice (`docs/reference/2026-10-23-architecture-research.md`).

## Goal

A runnable monorepo skeleton (`pnpm check` green) with the architecture documented in `docs/ARCHITECTURE.md`, enforced by dependency-cruiser + ESLint boundaries + architecture tests, and a generator that scaffolds new modules identically.

## Scope

- `docs/ARCHITECTURE.md`; AGENTS.md / rule 05 / docs/11 updated.
- `apps/backend` (NestJS 12 ESM on Fastify): entries `api|worker|agent|realtime`, common (env schema, pino, Zod pipe, error envelope, workspace context), modules `health` and golden `workspace` (all layers + unit/contract/HTTP tests), `test/architecture.spec.ts`.
- `apps/webhook` (thin Fastify ingress with ports + inject tests).
- `apps/web` (Vite 8 + React 19 + TanStack Router/Query + Tailwind v4 + i18next): shell, routes, feature example, api-client, test.
- Packages: `contracts`, `db` (schema per module, `withTenant`/`withSystem`, migration 0000 with roles + forced RLS), `queue` (fairness), `ai-core` (gateway, fake provider, prompt registry), `channels`, `testing`, `ui`, `i18n`; `shared` extended (branded ids, Result, DomainEvent).
- `.dependency-cruiser.cjs`, ESLint boundaries, `pnpm arch`, `pnpm gen module|feature` (turbo gen templates).

## Out of scope

- Real DB wiring/migrations run (T-004), auth (T-003 follow-up), real channel adapters, Playwright, deploy (T-008).

## Acceptance criteria

- [x] `pnpm check` green (lint, arch, typecheck, tests, build) on a clean install.
- [x] `pnpm gen module demo` creates a module that passes `pnpm arch` and the architecture tests (verified then removed).
- [x] Golden module demonstrates every layer with tests; cross-module import outside `api/` fails `pnpm arch`.
- [x] Docs updated: ARCHITECTURE.md, AGENTS.md, rule 05, docs/11.

## Plan

1. Research → choose fixed module shape + enforcement stack.
2. Packages (contracts, db, queue, ai-core, channels, testing, ui, i18n, shared).
3. Backend app with golden module; webhook app; web app.
4. Enforcement (dependency-cruiser, ESLint boundaries, architecture tests), generators.
5. Install, `pnpm check`, fix, PR.

## Log

- 2026-10-23 — created; research done; skeleton written.

## Links

- Docs: `docs/ARCHITECTURE.md`, `docs/adr/ADR-009-tech-stack-for-speed-and-scale.md`, `docs/reference/2026-10-23-architecture-research.md`
- Related: T-003, T-004, T-005 (now implement on top of this skeleton)
