---
id: T-033
title: CRM auto-assignment distribution policies for Sales and CSKH
status: backlog            # backlog | next | in-progress | blocked | review | done | cancelled
type: feature              # feature | bug | chore | spike | docs
priority: P1
owner:                     # @github-handle or @agent:<tool>
feature_ids: [CRM-01]
created: 2026-10-24
updated: 2026-10-24
branch:
pr:
parent: T-029
---

## Context

Child of the CRM and statistics epic (GitHub #25), from the BA analysis in GitHub #28 (remainder). Deferred from milestone M3a (CRM core, T-029..T-032).

## Goal

Source/page-scoped distribution policies (candidates, weights, schedule/capacity) with atomic selection, deterministic tie-break, audited manual override and policy versions.

## Scope

- See GitHub #28 (remainder) for the full specification (proposed contracts, edge cases, BA acceptance ids).

## Out of scope

- Anything already shipped in M3a (profiles, notes, history, sources/statuses, manual assignment, tags, filters, saved views).

## Acceptance criteria

- [ ] Two simultaneous auto-assignment requests respect distribution and scope; removed members never receive work.
- [ ] Tests added/updated and `pnpm check` green
- [ ] Docs updated

## Plan

Dependencies: Needs channels/conversations (pages) for page scope; M3a ships manual Sales/CSKH assignment.

## Log

- 2026-10-24 — created from GitHub #28 (remainder).
