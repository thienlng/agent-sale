---
id: T-038
title: CRM conversation-driven rules and historical sync
status: backlog            # backlog | next | in-progress | blocked | review | done | cancelled
type: feature              # feature | bug | chore | spike | docs
priority: P2
owner:                     # @github-handle or @agent:<tool>
feature_ids: [CRM-13, CRM-14]
created: 2026-10-24
updated: 2026-10-24
branch:
pr:
parent: T-029
---

## Context

Child of the CRM and statistics epic (GitHub #25), from the BA analysis in GitHub #34. Deferred from milestone M3a (CRM core, T-029..T-032).

## Goal

The 9 conversation-driven CRM rules with run logs and a resumable backfill from old conversations.

## Scope

- See GitHub #34 for the full specification (proposed contracts, edge cases, BA acceptance ids).

## Out of scope

- Anything already shipped in M3a (profiles, notes, history, sources/statuses, manual assignment, tags, filters, saved views).

## Acceptance criteria

- [ ] Idempotent rule runs with provenance; backfill resumes after failure.
- [ ] Tests added/updated and `pnpm check` green
- [ ] Docs updated

## Plan

Dependencies: Needs the inbox/conversations module.

## Log

- 2026-10-24 — created from GitHub #34.
