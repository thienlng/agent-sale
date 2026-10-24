---
id: T-041
title: Statistics dashboard, breakdowns and drilldowns
status: backlog            # backlog | next | in-progress | blocked | review | done | cancelled
type: feature              # feature | bug | chore | spike | docs
priority: P2
owner:                     # @github-handle or @agent:<tool>
feature_ids: [ANA-*]
created: 2026-10-24
updated: 2026-10-24
branch:
pr:
parent: T-029
---

## Context

Child of the CRM and statistics epic (GitHub #25), from the BA analysis in GitHub #37. Deferred from milestone M3a (CRM core, T-029..T-032).

## Goal

Statistics dashboard with breakdowns and permission-scoped drilldowns to customer lists.

## Scope

- See GitHub #37 for the full specification (proposed contracts, edge cases, BA acceptance ids).

## Out of scope

- Anything already shipped in M3a (profiles, notes, history, sources/statuses, manual assignment, tags, filters, saved views).

## Acceptance criteria

- [ ] Drilldown counts equal the dashboard figures.
- [ ] Tests added/updated and `pnpm check` green
- [ ] Docs updated

## Plan

Dependencies: After T-039/T-040.

## Log

- 2026-10-24 — created from GitHub #37.
