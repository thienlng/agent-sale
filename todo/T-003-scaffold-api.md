---
id: T-003
title: Complete the backend runtime: OpenAPI, request tracing, readiness, auth placeholder
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

T-010 scaffolded `apps/backend` (NestJS 12 on Fastify, entries, `health` and golden `workspace` modules, Zod validation, error envelope, pino logger, tests). This task adds the runtime pieces a real deployment needs before domain modules land (`docs/04`, `docs/11` §2).

## Goal

`pnpm --filter @agent-sales/backend dev` serves a documented API: OpenAPI at `/api/docs` (non-production), request/trace ids in every log line and error envelope, liveness vs readiness endpoints, and a session-based workspace guard interface that the auth task implements.

## Scope

- OpenAPI generated from `packages/contracts` Zod schemas (`z.toJSONSchema`) + route metadata; served at `/api/docs` and exported as JSON for `openapi-typescript` (web client).
- Request id / OpenTelemetry trace id propagated from Fastify to pino and to the error envelope `traceId`.
- `GET /api/v1/health` (liveness, no DB) and `GET /api/v1/health/ready` (DB + Redis ping) — readiness wired when T-004 lands.
- `WorkspaceGuard` interface + membership check hook (verifies the session's membership; the `X-Workspace-Id` header alone is never trusted — Rule 07), with the current header-based resolver kept as a dev-only fallback behind an env flag.
- Graceful shutdown drains in-flight requests; `/metrics` endpoint (Prometheus format) for `docs/10` §4.
- Tests: OpenAPI document validates; readiness reports DB down; trace id present in error responses.

## Out of scope

- Real authentication/sessions (separate auth task), database wiring (T-004).

## Acceptance criteria

- [ ] `/api/docs` renders and the JSON document validates against the OpenAPI 3.1 schema.
- [ ] Every error response carries the request's `traceId`; the same id appears in logs.
- [ ] `/health/ready` returns 503 when a dependency is unreachable.
- [ ] `pnpm check` green; architecture tests still pass.

## Plan

(to be written by the implementer)

## Log

- 2026-10-23 — created.
- 2026-10-23 — rescoped after T-010 delivered the skeleton.

## Links

- Docs: `docs/ARCHITECTURE.md`, `docs/04-system-architecture.md` §5–6, `docs/11-code-structure-and-conventions.md` §2
