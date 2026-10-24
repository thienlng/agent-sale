---
id: T-040
title: Analytics events, temporal state and rebuildable projections
status: backlog            # backlog | next | in-progress | blocked | review | done | cancelled
type: feature              # feature | bug | chore | spike | docs
priority: P1
owner:                     # @github-handle or @agent:<tool>
feature_ids: [ANA-*]
created: 2026-10-24
updated: 2026-10-24
branch:
pr:
parent: T-029
---

## Context

Child of the CRM and statistics epic (GitHub #25), from the BA analysis in GitHub #36. Deferred from milestone M3a (CRM core, T-029..T-032).

## Goal

Consume crm.* outbox events into idempotent facts and temporal state (status/owner/tag over time); rebuildable projections.

## Scope

- See GitHub #36 for the full specification (proposed contracts, edge cases, BA acceptance ids).

## Out of scope

- Anything already shipped in M3a (profiles, notes, history, sources/statuses, manual assignment, tags, filters, saved views).

## Acceptance criteria

- [ ] Duplicate and late events do not change totals; projections rebuild from facts.
- [ ] Tests added/updated and `pnpm check` green
- [ ] Docs updated

## Plan

Dependencies: Needs the outbox relay and worker. M3a already publishes the events.

## Log

- 2026-10-24 — created from GitHub #36.
