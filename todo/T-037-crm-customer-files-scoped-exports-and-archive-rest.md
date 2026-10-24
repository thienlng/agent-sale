---
id: T-037
title: CRM customer files, scoped exports and archive/restore
status: backlog            # backlog | next | in-progress | blocked | review | done | cancelled
type: feature              # feature | bug | chore | spike | docs
priority: P2
owner:                     # @github-handle or @agent:<tool>
feature_ids: [CRM-03, CRM-12]
created: 2026-10-24
updated: 2026-10-24
branch:
pr:
parent: T-029
---

## Context

Child of the CRM and statistics epic (GitHub #25), from the BA analysis in GitHub #33. Deferred from milestone M3a (CRM core, T-029..T-032).

## Goal

Private customer files, permission-scoped audited exports (same compiler as the list), archive/restore.

## Scope

- See GitHub #33 for the full specification (proposed contracts, edge cases, BA acceptance ids).

## Out of scope

- Anything already shipped in M3a (profiles, notes, history, sources/statuses, manual assignment, tags, filters, saved views).

## Acceptance criteria

- [ ] Exports match list filters exactly; archived customers are restorable; files are tenant-private.
- [ ] Tests added/updated and `pnpm check` green
- [ ] Docs updated

## Plan

Dependencies: Needs object storage (T-013).

## Log

- 2026-10-24 — created from GitHub #33.
