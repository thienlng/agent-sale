---
id: T-054
title: Audit trail for workspace and security changes
status: review
type: feature
priority: P1
owner: @agent:claude
feature_ids: [ADM-01, ADM-02]
created: 2026-10-24
updated: 2026-10-24
branch: feat/T-053-m4a-admin-foundation
pr:
parent:
---

## Context

Security-relevant changes (members, profile, logo) need a tamper-evident trail. Source: epic #43.

## Goal

Append-only, per-workspace audit events that owners and admins can read.

## Scope

- `audit_events` (migration 0016): tenant RLS, UPDATE/DELETE revoked from app_tenant.
- `writeAudit()` helper written in the same transaction as the change.
- `GET /audit-events` with keyset pagination, action prefix and date filters; capability `audit.view`.
- Web: Settings → Nhật ký.

## Out of scope

- Account-level (non-workspace) events such as two-factor changes.

## Acceptance criteria

- [x] Events cannot be updated or deleted by the app role.
- [x] Each tenant sees only its own events.
- [x] Pagination is stable under equal timestamps.
- [x] Tests added/updated and `pnpm check` green
- [x] Docs updated (audit MODULE.md)

## Log

- 2026-10-24 — created, implemented in milestone M4a; verified with unit, integration and live e2e tests.
