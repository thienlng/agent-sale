---
id: T-003
title: Scaffold apps/api NestJS skeleton with health endpoint
status: next
type: chore
priority: P0
owner:
feature_ids: []
created: 2026-10-23
updated: 2026-10-23
branch:
pr:
parent:
---

## Context

The backend is a NestJS modular monolith (`docs/adr/ADR-001-typescript-nestjs-modular-monolith.md`). Nothing exists yet. This task creates the runnable skeleton that later feature tasks build on.

## Goal

`pnpm --filter api dev` starts an HTTP server exposing `GET /api/v1/health`, with the module layout, config validation, logging and test setup described in the docs.

## Scope

- `apps/api` with NestJS (Fastify adapter), `src/main.ts`, `src/app.module.ts`, `src/modules/health/`.
- Env schema validated with Zod at boot (`src/config/`), `.env.example`.
- Structured JSON logging (pino) with request id.
- Global validation pipe, exception filter producing the error shape in `docs/11-code-structure-and-conventions.md` §2.
- OpenAPI (Swagger) at `/api/docs` in non-production.
- Unit test for health controller; e2e-style test booting the app (supertest).
- `apps/api/README.md`.
- Wire into Turborepo (`dev`, `build`, `test`, `lint`, `typecheck`).

## Out of scope

- Database, auth, any domain module (T-004 and later).

## Acceptance criteria

- [ ] `GET /api/v1/health` returns `{ status: 'ok', version, uptime }`.
- [ ] Boot fails with a clear message when a required env var is missing.
- [ ] Error responses follow the shared error shape with a `traceId`.
- [ ] `pnpm check` green; tests included.
- [ ] README documents run/test/env.

## Plan

(to be written by the implementer)

## Log

- 2026-10-23 — created.

## Links

- Docs: `docs/04-system-architecture.md` §5, `docs/11-code-structure-and-conventions.md`
