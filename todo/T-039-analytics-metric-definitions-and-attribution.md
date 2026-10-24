---
id: T-039
title: Analytics metric definitions and attribution
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

Child of the CRM and statistics epic (GitHub #25), from the BA analysis in GitHub #35. Deferred from milestone M3a (CRM core, T-029..T-032).

## Goal

Approved, versioned metric definitions (new customer, phone capture, conversion grain, attribution, owner-at-event).

## Scope

- See GitHub #35 for the full specification (proposed contracts, edge cases, BA acceptance ids).

## Out of scope

- Anything already shipped in M3a (profiles, notes, history, sources/statuses, manual assignment, tags, filters, saved views).

## Acceptance criteria

- [ ] Each metric has an approved written definition and a version used by reports.
- [ ] Tests added/updated and `pnpm check` green
- [ ] Docs updated

## Plan

Dependencies: Owner decisions listed in epic #25.

## Log

- 2026-10-24 — created from GitHub #35.
