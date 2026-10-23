---
id: T-004
title: Wire the database: local infra, migration runner, RLS integration tests, Drizzle repositories
status: done
type: chore
priority: P0
owner: @agent:claude
feature_ids: []
created: 2026-10-23
updated: 2026-10-23
branch: feat/T-004-m1-foundation (milestone M1-foundation)
pr:
parent:
---

## Context

T-010 created `packages/db` (schema, `withTenant`, migration 0000) but nothing runs against a real Postgres yet. Tenant isolation is the highest-risk area (ADR-004, independent review B1/B2), so it must be proven with a real database before any domain module is written.

## Goal

`docker compose up` + `pnpm db:migrate` give a working local database; integration tests against a real Postgres prove tenant isolation; the golden `workspace` module persists through Drizzle with a unit of work (business rows + outbox in one transaction).

## Scope

- `infra/docker/docker-compose.local.yml`: Postgres 16 + pgvector, Redis 7, MinIO, Mailpit.
- Migration runner in `packages/db` (ordered SQL files, `schema_migrations` with checksums, one transaction per file, refuses edited migrations) + CLI `pnpm db:migrate`; dev/test login roles (`razpi_tenant` in `app_tenant`, `razpi_system` in `app_system`).
- Fix migration 0000: separate policies `TO app_tenant` (tenant predicate) and `TO app_system` (cross-tenant); never a GUC that a tenant connection can set to escalate. Not yet applied anywhere, so edited in place.
- Integration tests (Testcontainers, `pnpm test:integration`): isolation between two tenants on one reused connection; no rows outside `withTenant`; tenant role cannot escalate with `app.role`; system role reads across tenants; FORCE RLS applies to the owner.
- Unit of work: `WorkspaceUnitOfWork` port; Drizzle implementation (repositories + outbox bound to one `withTenant` transaction); in-memory implementation for unit tests; owner membership created with the workspace.
- `DbModule` in the backend; modules fall back to in-memory adapters when `DATABASE_URL` is unset (unit tests, quick dev).
- CI job for integration tests.

## Out of scope

- PgBouncer in local compose (production concern, T-008); outbox relay worker; seeds.

## Acceptance criteria

- [x] `docker compose -f infra/docker/docker-compose.local.yml up -d && pnpm db:migrate` works from scratch and is idempotent.
- [x] Integration tests cover the five isolation cases above and pass locally and in CI.
- [x] Creating a workspace writes `workspaces` + `members(owner)` + `outbox_events` atomically (rollback test).
- [x] `pnpm check` green.

## Plan

1. Fix migration 0000 policies + Drizzle schema policies.
2. Migration runner + CLI + dev roles helper; compose file; `.env.example`.
3. Testcontainers harness in `packages/testing` (Postgres container, migrate, login roles, clients) + `packages/db` integration tests.
4. Unit of work + Drizzle/in-memory adapters in `workspace`; outbox helper in `packages/db`; DbModule wiring.
5. Backend integration test for the workspace facade on a real DB; CI job.

## Log

- 2026-10-23 — started on the M1-foundation milestone branch (one PR for T-004, T-003, T-013 per rule 02).
- 2026-10-23 — found that 0000's `or current_setting('app.role') = 'system'` let any tenant connection escalate; replaced with role-scoped policies.

- 2026-10-23 — done. db integration 7/7 (isolation on one reused connection, no context leak, cross-tenant write rejected, GUC escalation blocked, system role, RLS forced on every tenant table, edited migration refused); backend integration 3/3 (UoW atomic, rollback, NOT_FOUND). Local: compose on port 5433 (host Postgres occupies 5432), `db:migrate:dev` idempotent. MinIO image unavailable → T-013. Superusers bypass forced RLS → apps never connect as superuser (README).

## Links

- Docs: `docs/adr/ADR-004-multi-tenant-rls.md`, `docs/05-data-model.md` §9, `docs/reference/2026-10-23-stack-review.md` (B1, B2, H2)
