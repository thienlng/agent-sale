---
id: T-039
title: Analytics metric definitions and attribution
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

Child of the CRM and statistics epic (GitHub #25), from the BA analysis in GitHub #35. Deferred from milestone M3a (CRM core, T-029..T-032).

## Goal

Approved, versioned metric definitions (new customer, phone capture, conversion grain, attribution, owner-at-event).

## Scope

- 12 versioned metric definitions (kind, grain, timestamp, distinct key, origins, attribution, filters, additivity, availability), `GET /analytics/definitions`, `validateAnalyticsQuery`, `ratio()`, docs/analytics.md with the decisions the owner must confirm.

## Out of scope

- See T-042 for the BA acceptance suite, entitlements and exports.

## Acceptance criteria

- [x] Each metric has an approved written definition and a version used by reports.
- [x] Tests added/updated and `pnpm check` green
- [x] Docs updated

## Plan

Done in milestone M4b; see docs/analytics.md.

## Log

- 2026-10-24 — created from GitHub #35.
- 2026-10-24 — implemented in milestone M4b; verified with unit, Postgres integration, mocked responsive and live-backend e2e tests.
