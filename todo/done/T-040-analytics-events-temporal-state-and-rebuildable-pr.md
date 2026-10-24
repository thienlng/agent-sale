---
id: T-040
title: Analytics events, temporal state and rebuildable projections
status: review
type: feature              # feature | bug | chore | spike | docs
priority: P1
owner: @agent:claude
feature_ids: [ANA-*]
created: 2026-10-24
updated: 2026-10-24
branch: feat/T-039-m4b-statistics
pr:
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
