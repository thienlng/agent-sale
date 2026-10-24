---
id: T-036
title: CRM customer import preview, deduplication and merges
status: backlog            # backlog | next | in-progress | blocked | review | done | cancelled
type: feature              # feature | bug | chore | spike | docs
priority: P2
owner:                     # @github-handle or @agent:<tool>
feature_ids: [CRM-05, CRM-06, CRM-11]
created: 2026-10-24
updated: 2026-10-24
branch:
pr:
parent: T-029
---

## Context

Child of the CRM and statistics epic (GitHub #25), from the BA analysis in GitHub #32. Deferred from milestone M3a (CRM core, T-029..T-032).

## Goal

xlsx/csv import with preview, column mapping, per-row errors; duplicate detection by normalized phone/email; controlled merge and unmerge.

## Scope

- See GitHub #32 for the full specification (proposed contracts, edge cases, BA acceptance ids).

## Out of scope

- Anything already shipped in M3a (profiles, notes, history, sources/statuses, manual assignment, tags, filters, saved views).

## Acceptance criteria

- [ ] Retry-safe commit; wrong merges can be split back without losing history.
- [ ] Tests added/updated and `pnpm check` green
- [ ] Docs updated

## Plan

Dependencies: Needs object storage (T-013) for uploads.

## Log

- 2026-10-24 — created from GitHub #32.
