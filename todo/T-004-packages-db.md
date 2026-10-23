---
id: T-004
title: Add packages/db with Drizzle, Postgres docker-compose and first migration
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

ADR-002 chooses PostgreSQL 16 + pgvector; ADR-004 chooses shared schema + RLS. The data model is in `docs/05-data-model.md`. This task lays the database foundation used by every later module.

## Goal

A `packages/db` package with Drizzle schema, migration tooling, RLS helpers and a local Postgres via docker compose, with the first migration creating `users`, `workspaces`, `members`, `roles` and the RLS policy pattern.

## Scope

- `infra/docker/docker-compose.local.yml`: postgres (pgvector image), redis, minio, mailpit.
- `packages/db`: Drizzle config, `schema/` split by module, `migrations/`, `client.ts` (connection + `withWorkspace(workspaceId, fn)` that sets `app.workspace_id`), seed script skeleton.
- First migration: extensions (`vector`, `pg_trgm`, `unaccent`, `citext`), tables above, RLS enabled + policies, UUIDv7 helper.
- Scripts: `pnpm db:migrate`, `pnpm db:generate`, `pnpm db:seed`, `pnpm db:studio`.
- Integration test (Testcontainers or compose) proving RLS blocks cross-workspace reads.
- `packages/db/README.md`.

## Out of scope

- Business tables beyond identity/workspace (added per feature task).

## Acceptance criteria

- [ ] `docker compose -f infra/docker/docker-compose.local.yml up -d && pnpm db:migrate` works from scratch.
- [ ] RLS test: a session with `app.workspace_id = A` cannot read rows of workspace B.
- [ ] Migration is idempotent and documented.
- [ ] `pnpm check` green.

## Plan

(to be written by the implementer)

## Log

- 2026-10-23 — created.

## Links

- Docs: `docs/05-data-model.md`, `docs/adr/ADR-002-postgresql.md`, `docs/adr/ADR-004-multi-tenant-rls.md`
