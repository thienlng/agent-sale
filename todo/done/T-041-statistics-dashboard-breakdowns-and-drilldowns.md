---
id: T-041
title: Statistics dashboard, breakdowns and drilldowns
status: review
type: feature              # feature | bug | chore | spike | docs
priority: P2
owner: @agent:claude
feature_ids: [ANA-*]
created: 2026-10-24
updated: 2026-10-24
branch: feat/T-039-m4b-statistics
pr:
parent: T-029
---

## Context

Child of the CRM and statistics epic (GitHub #25), from the BA analysis in GitHub #37. Deferred from milestone M3a (CRM core, T-029..T-032).

## Goal

Statistics dashboard with breakdowns and permission-scoped drilldowns to customer lists.

## Scope

- `POST /analytics/query` and `/analytics/drilldown`, scope and attribution in SQL, watermark freezing, locked/unavailable/failed states, and the `/app/analytics` dashboard (filters in the URL, cards with definitions, daily chart, breakdowns, drilldown).

## Out of scope

- See T-042 for the BA acceptance suite, entitlements and exports.

## Acceptance criteria

- [x] Drilldown counts equal the dashboard figures.
- [x] Tests added/updated and `pnpm check` green
- [x] Docs updated

## Plan

Dependencies: After T-039/T-040.

## Log

- 2026-10-24 — created from GitHub #37.
- 2026-10-24 — implemented in milestone M4b; verified with unit, Postgres integration, mocked responsive and live-backend e2e tests.
