---
id: T-006
title: Add Testcontainers integration test harness and cross-tenant test helper
status: backlog
type: chore
priority: P1
owner:
feature_ids: []
created: 2026-10-23
updated: 2026-10-23
branch:
pr:
parent:
---

## Context

Rule 04 requires integration tests (API + DB + queue) and a cross-tenant test for every new endpoint. A shared harness keeps those tests cheap to write.

## Goal

`packages/testing` provides: Postgres + Redis Testcontainers lifecycle for Vitest, factories (user, workspace, member), an authenticated request helper, and `expectCrossTenant404(request, resourceOfOtherWorkspace)`.

## Scope

- Vitest global setup starting containers once per run; per-test transaction rollback or truncation.
- Factories with synthetic data (no PII).
- Helper to boot the Nest app for tests.
- CI job running integration tests with Docker available.

## Out of scope

- E2E (Playwright) infrastructure.

## Acceptance criteria

- [ ] One example integration test in `apps/api` uses the harness and runs in CI.
- [ ] Cross-tenant helper documented in `packages/testing/README.md`.

## Plan

## Log

- 2026-10-23 — created.
- 2026-10-23 — T-004 delivered the Postgres Testcontainers harness (`startTestPostgres`) and `test:integration` CI job; remaining: authenticated request helper + Redis container.

## Links

- Docs: `docs/13-testing-and-quality.md`
