---
id: T-034
title: CRM tasks, reminders and recurring follow-ups
status: backlog            # backlog | next | in-progress | blocked | review | done | cancelled
type: feature              # feature | bug | chore | spike | docs
priority: P2
owner:                     # @github-handle or @agent:<tool>
feature_ids: [CRM-04]
created: 2026-10-24
updated: 2026-10-24
branch:
pr:
parent: T-029
---

## Context

Child of the CRM and statistics epic (GitHub #25), from the BA analysis in GitHub #30. Deferred from milestone M3a (CRM core, T-029..T-032).

## Goal

Work tags as tasks: due date, assignee, reminders at offsets, recurrence, done state; notifications.

## Scope

- See GitHub #30 for the full specification (proposed contracts, edge cases, BA acceptance ids).

## Out of scope

- Anything already shipped in M3a (profiles, notes, history, sources/statuses, manual assignment, tags, filters, saved views).

## Acceptance criteria

- [ ] Reminders fire exactly at 0/2h/24h offsets; recurring follow-ups create the next instance once.
- [ ] Tests added/updated and `pnpm check` green
- [ ] Docs updated

## Plan

Dependencies: Needs the worker/scheduler (BullMQ) and notifications.

## Log

- 2026-10-24 — created from GitHub #30.
