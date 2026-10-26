---
id: T-040
title: Analytics events, temporal state and rebuildable projections
status: done
type: feature              # feature | bug | chore | spike | docs
priority: P1
owner: @agent:claude
feature_ids: [ANA-*]
created: 2026-10-24
updated: 2026-10-24
branch: feat/T-039-m4b-statistics
pr: 54
parent: T-029
---

## Context

Child of the CRM and statistics epic (GitHub #25), from the BA analysis in GitHub #36. Deferred from milestone M3a (CRM core, T-029..T-032).

## Goal

Consume crm.* outbox events into idempotent facts and temporal state (status/owner/tag over time); rebuildable projections.

## Scope

- `analytics_facts` (one fact per outbox event and kind), projector with lease and settled-id reads, dead letters, rebuild CLI, additive event fields, health (watermark and lag).

## Out of scope

- See T-042 for the BA acceptance suite, entitlements and exports.

## Acceptance criteria

- [x] Duplicate and late events do not change totals; projections rebuild from facts.
- [x] Tests added/updated and `pnpm check` green
- [x] Docs updated

## Plan

Dependencies: Needs the outbox relay and worker. M3a already publishes the events.

## Log

- 2026-10-24 — created from GitHub #36.
- 2026-10-24 — implemented in milestone M4b; verified with unit, Postgres integration, mocked responsive and live-backend e2e tests.
- 2026-10-24 — review of PR #54, fixed before merge:
  - the projection window used 32-bit `xmin` capped at 2^31 transactions back, so on a long-running busy instance a rebuild silently skipped old events and the lag stuck. It also forced a full outbox scan on every query's catch-up. Now `outbox_events.tx_id xid8` (indexed, migration 0022) is the window key.
  - customers created before M4b had no starting-owner or starting-status events, so own-scope viewers saw colleagues' customers in drilldowns and old customers showed no status. Migration 0023 writes those events into the outbox (`crm.contact.assigned.v1` from nobody, new `crm.contact.initial_status.v1`).
  - also: ADR-004 amendment for the projector's `app_system` use in `api`; docs/05 lists the operator tables; Drizzle schema matches 0021.
  - migrations renumbered 0021–0023 after #55 took 0020.
  - verified: `pnpm check`, `pnpm test:integration` (db 15, backend 72, webhook 3).
  - not done: dashboard opens one `withTenant` transaction per metric (~30 per load); rebuild holds a workspace's facts in memory.
