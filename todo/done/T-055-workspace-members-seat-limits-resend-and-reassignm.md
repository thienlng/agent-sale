---
id: T-055
title: Workspace members: seat limits, resend and reassignment on removal (ADM-01)
status: done
type: feature
priority: P1
owner: @agent:claude
feature_ids: [ADM-01]
created: 2026-10-24
updated: 2026-10-24
branch: feat/T-053-m4a-admin-foundation
pr: 53
parent:
---

## Context

GitHub #44. Members need seat limits, resend and a safe removal flow.

## Goal

Owners manage seats and removal without losing customers or exceeding the plan.

## Scope

- Invite-time soft check and accept-time atomic hard check (advisory lock) against the member-seat entitlement; 402 QUOTA_EXCEEDED.
- Resend an invitation (new link, old one dies).
- Removal preview and a required transfer/unassign choice for customers the member owns; work history stays.
- Audit events for every membership change.
- Web: seat meter, quota dialog, link dialog, removal dialog.

## Out of scope

- Per-seat billing, SSO.

## Acceptance criteria

- [x] Free plan: inviting a second member shows the quota gate; upgrading opens it.
- [x] Two simultaneous accepts cannot exceed the limit.
- [x] Removing a member who owns customers requires choosing where they go.
- [x] Tests added/updated and `pnpm check` green
- [x] Docs updated (team MODULE.md, docs/02 ADM-01)

## Log

- 2026-10-24 — created, implemented in milestone M4a; verified with unit, integration and live e2e tests.
