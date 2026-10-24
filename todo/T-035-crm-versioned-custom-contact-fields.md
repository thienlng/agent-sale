---
id: T-035
title: CRM versioned custom contact fields
status: backlog            # backlog | next | in-progress | blocked | review | done | cancelled
type: feature              # feature | bug | chore | spike | docs
priority: P2
owner:                     # @github-handle or @agent:<tool>
feature_ids: [CRM-16]
created: 2026-10-24
updated: 2026-10-24
branch:
pr:
parent: T-029
---

## Context

Child of the CRM and statistics epic (GitHub #25), from the BA analysis in GitHub #31. Deferred from milestone M3a (CRM core, T-029..T-032).

## Goal

Workspace custom contact fields with a versioned schema editor, typed values, filters on them.

## Scope

- See GitHub #31 for the full specification (proposed contracts, edge cases, BA acceptance ids).

## Out of scope

- Anything already shipped in M3a (profiles, notes, history, sources/statuses, manual assignment, tags, filters, saved views).

## Acceptance criteria

- [ ] Schema changes are additive; old values stay readable; filters support the new fields.
- [ ] Tests added/updated and `pnpm check` green
- [ ] Docs updated

## Plan

Dependencies: none beyond M3a

## Log

- 2026-10-24 — created from GitHub #31.
