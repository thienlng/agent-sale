---
id: T-119
title: Reconcile historical and cross-branch task ID aliases before account integration
status: backlog
type: chore
priority: P2
owner:
feature_ids: []
created: 2026-10-28
updated: 2026-10-28
branch:
pr:
parent: T-117
---

## Context

Final remote inspection found independently allocated task IDs across unmerged cofounder branches. Remote T-108/T-109 refer to account portfolio/business creation, whereas the canonical Inbox branch already publishes those IDs for scanner/timezone fixes. Remote T-112/T-113 refer to product navigation/bot statistics; the unpublished local closeout/responsive tasks were therefore renumbered T-117/T-118 before push. Existing main history also has two different T-045 task records (email verification and training/Meta Inbox).

## Goal

Preserve both work records and establish unambiguous task references before merging the account branches.

## Scope

- Reconcile current task-file IDs, board links and related doc references across the chosen integration branches.
- Preserve historical commit references with explicit alias notes; never rewrite published history or delete task records.
- Coordinate reservations across active branches instead of allocating from a stale local board.

## Out of scope

- Account schema/ADR decisions or business features; protected agent/tooling changes without their own explicit task.

## Acceptance criteria

- [ ] Each current task ID has one canonical meaning and every old alias is traceable.
- [ ] No record is overwritten or silently discarded during branch integration.
- [ ] Links and task-board references resolve after reconciliation.
- [ ] No published Git history is rewritten.

## Plan

To be filled by the integration owner after choosing approved account branches.

## Log

- 2026-10-28 — Created from a final read-only remote audit. Canonical published T-108/T-109 remain unchanged; only unpublished closeout/responsive task IDs were moved to T-117/T-118. The unrelated historical T-045 duplicate remains untouched in this delivery.

## Links

- docs/handoffs/2026-10-28-lane-b-closeout.md.
- origin/feat/T-108-account-portfolio-layer and origin/feat/T-112-lane-b-ux-block.
