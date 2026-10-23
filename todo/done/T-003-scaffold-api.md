---
id: T-003
title: Complete the backend runtime: OpenAPI, request tracing, readiness, metrics
status: done
type: chore
priority: P0
owner: @agent:claude
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
- Graceful shutdown drains in-flight requests; `/metrics` endpoint (Prometheus format) for `docs/10` §4.
- Tests: OpenAPI document validates; readiness reports DB down; trace id present in error responses.

## Out of scope

- Authentication, sessions and the membership guard (moved to T-014).

## Acceptance criteria

- [x] `/api/v1/openapi.json` serves an OpenAPI 3.1 document built from route contracts; a test fails when served and declared routes differ. (Swagger UI page deferred: no CDN assets under the self-host policy.)
- [x] Every error response carries the request's `traceId`; the same id appears in logs.
- [x] `/health/ready` returns 503 when a dependency is unreachable.
- [x] `pnpm check` green; architecture tests still pass.

## Plan

(to be written by the implementer)

## Log

- 2026-10-23 — created.
- 2026-10-23 — rescoped after T-010 delivered the skeleton.

- 2026-10-23 — done on the M1-foundation branch. Request id (accept well-formed `x-request-id`, else UUID) echoed and used as error `traceId`; one access-log line per request; `http_request_duration_seconds` histogram + default metrics at `/metrics`; readiness with pluggable probes (Postgres now; Redis when wired). Smoke-tested on local Postgres: ready 200 → stop Postgres → 503. Found and fixed: class-typed injection is undefined under tsx (no decorator metadata) — added an architecture test requiring `@Inject` on every constructor parameter. `pnpm dev` now loads `../../.env`.

## Links

- Docs: `docs/ARCHITECTURE.md`, `docs/04-system-architecture.md` §5–6, `docs/11-code-structure-and-conventions.md` §2
