---
id: T-027
title: Live-backend commerce E2E regression suite
status: done
type: test
priority: P2
owner: @agent:claude
feature_ids: [ORD-03, ORD-05]
created: 2026-10-24
updated: 2026-10-24
branch: feat/T-023-orders-parity-fixes
pr:
parent:
---

## Context

GitHub issue #23 (RZ-ORD-008): the Playwright suite mocks the API, so it cannot prove persistence, reservations, cancellation or snapshot pricing.

## Goal

A Playwright suite against the real API and Postgres, run in CI on every PR.

## Scope

- `apps/web/e2e-live` + `playwright.live.config.ts` (`pnpm test:e2e:live`): starts or reuses the backend and `vite preview`; each run signs up a new shop (isolated, nothing to clean up).
- Covered: product with 10 in stock, order of 2 (reserve), confirm, payment edit, catalog price change keeps the order price, edit to 3, cancel restores stock; oversell warning; double F2 creates one order; Hotline/Facebook field policies.
- CI job `web-live` with a pgvector Postgres service. The mocked suite stays as `web` (smoke + responsive).

## Acceptance criteria

- [x] Suite green locally against dev servers and against `vite preview`.
- [x] Tests added/updated and `pnpm check` green
- [x] Docs updated (docs/13 test layers)

## Log

- 2026-10-24 — created from #23; done. The backend's `APP_ORIGINS` must include the preview origin (set by the config when it starts the backend).
