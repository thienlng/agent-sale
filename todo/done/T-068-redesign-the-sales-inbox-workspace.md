---
id: T-068
title: Redesign the sales inbox workspace
status: done
type: feature
priority: P1
owner: "@agent:codex"
feature_ids: [CHAT-01]
created: 2026-10-25
updated: 2026-10-25
branch: feat/T-068-sales-inbox
pr: 59
---

## Context

The owner approved a sales-first inbox redesign based on Preny and Diro references and requested independent QA. Other agents are active; implementation uses an isolated worktree based on origin/main.

## Goal

Deliver a convenient sales workspace with actionable queues, reliable conversation drafting, customer context and order creation alongside chat.

## Scope

- Conversation list, header, composer, customer/order panel and supporting existing API integrations.
- English and Vietnamese translations, meaningful behavior tests, documentation and independent QA.

## Out of scope

- New channel providers, shipping integrations and automated reminders without an existing backend.
- Other agents' uncommitted work and shared tooling configuration.

## Acceptance criteria

- [x] Sales queues and channel filters accurately describe available data.
- [x] Composer drafts survive switching conversations; quick replies preserve existing text.
- [x] AI takeover state and customer context are clear.
- [x] Orders can be created alongside chat using existing commerce contracts.
- [x] Loading, error, restricted sending and narrow layouts remain usable.
- [x] Independent QA reviewed and material findings resolved.
- [x] Meaningful tests and pnpm check pass; documentation updated.

## Plan

1. Inspect current conversation, CRM and commerce contracts; reuse existing feature boundaries.
2. Implement list/queue improvements and compose/customer/order workflows in separate owned files.
3. Add translations and regression tests for drafts, queues and order behavior.
4. Exercise responsive layouts, run pnpm check and independent QA, then prepare PR.

## Log

- 2026-10-25 — Final local verification for T-068/T-069 passed: full pnpm check (705 tests, all gates/builds), 12 production browser regressions, 11 team PostgreSQL integration tests and independent QA approval. PR #59 contains review screenshots. CI is tracked on the PR.

- 2026-10-25 — Production browser run passed all 12 tests: six sales inbox flows plus the existing responsive suite at 375/768/1280/1920 pixels and every layout preference combination. Synthetic review screenshots are in docs/reference/inbox-redesign/.
- 2026-10-25 — PR #59 opened as draft. CI secret scan flagged a synthetic UUID under an idempotencyKey fixture; replaced it with a generated UUID and cleaned the isolated, unreviewed draft commit rather than weakening the scanner.

- 2026-10-25 — Full gate passed with `TURBO_ENV_MODE=loose VITEST_MAX_WORKERS=1 pnpm check`: lint, architecture, typecheck, 705 tests across 84 files, and every build. Single-worker test execution avoids local contention; no assertion or timeout was changed. Initial bundle: 244.4 KB gzip (250 KB limit).

- 2026-10-25 — Independent QA found and verified fixes for in-flight order completion, stale note revisions, hidden F2 submission, CRM snapshots and fixed-size message windows. Additional internal-note remount regression passes.
- 2026-10-25 — Composer/thread tests pass (17 tests including internal-note async completion), embedded order tests pass (3), conversation service tests pass (14), queue tests pass (6). Browser checks include filled panels and no document vertical overflow at 375/1280/1440 pixels. Full gate and production layout regression are in progress.
- 2026-10-25 — Owner approved brainstorming. Isolated worktree created from origin/main; no edits to other agents' workspace.

## Links

- [Screen design](../../docs/03-screens-and-routes.md)
- [Meta inbox](../../docs/meta-inbox.md)
- [Architecture](../../docs/ARCHITECTURE.md)
- [Implemented behavior and limits](../../docs/18-sales-inbox-workspace.md)
- Follow-up reminders: T-034; identity/history sync: T-038; carrier/printing work: T-020.
