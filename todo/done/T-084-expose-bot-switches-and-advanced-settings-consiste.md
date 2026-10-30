---
id: T-084
title: Expose bot switches and advanced settings consistently
status: done
type: feature
priority: P1
owner: "@agent:codex"
feature_ids: []
created: 2026-10-26
updated: 2026-10-28
branch: feat/T-090-lane-b-review
pr: 64
parent:
---

## Context

The bot list currently exposes a status badge rather than the requested direct on/off control. Advanced bot settings also need a clear home.

Source: cofounder walkthrough supplied in chat on 2026-10-26, including three screenshots. Estimates use the running `integration/local-all` checkout; the primary checkout is behind that integration in CRM, analytics, billing and inbox features.

## Goal

Expose bot switches and advanced settings consistently.

## Scope

- Add an accessible on/off switch on the bot list and training workspace header backed by the same persisted state.
- Group existing advanced settings with clear scope and defaults; finalize a field inventory before adding any new controls.
- Synchronize both surfaces and enforce bot stop/start behavior in the runtime, including in-flight reply handling.

## Out of scope

- Unspecified new AI features, prompt rule rewrite already tracked by T-070, channel unassignment.

## Acceptance criteria

- [x] Switch state persists across reload and both screens agree; failed saves restore the prior UI state.
- [x] Turning a bot off prevents subsequent AI replies without unassigning its channels; human inbox messaging remains usable.
- [x] Advanced controls correspond to documented API/runtime behavior and permissions.
- [x] Add/update meaningful regression coverage, permission and scope checks where applicable; `pnpm check` passes before implementation is complete.
- [x] Update impacted docs and vi/en product strings; include migration and operational notes where applicable.

## Estimate and proposed assignment

- Proposed lane: B. A = cofounder; B = user with Codex (updated user assignment). These are planning labels, not committed GitHub assignments.
- Base estimate: 2 person-days including implementation, self-review and task verification. One person-day is approximately six focused engineering hours.
- Uncertainty: approximately -30% / +40%; reassess after T-077. No claim that runtime failures have been reproduced during planning.
- Dependencies: T-077, T-078
- See the milestone handoff for scheduling, shared contracts, assumptions and exclusions.

## Plan

1. Add a direct bot-list switch using the existing training switch and persisted bot update API. Reuse the existing basic/advanced settings tabs rather than inventing controls.
2. Make list/detail optimistic state and rollback consistent, disable duplicate or unauthorized updates, and cover success/failure/permission states.
3. Verify current runtime shutdown checks with existing backend regressions, run UI/browser tests and obtain agent QA review. No schema/API or prompt changes.

Autonomous implementation authorized by the user on 2026-10-26. Account/business/shop contracts remain lane A responsibilities.

## Log

- 2026-10-26 — Created from cofounder review; proposed allocation only. No application changes made.

## Links

- [Review milestone handoff](../../docs/handoffs/2026-10-26-cofounder-review-plan.md)
- [Architecture](../../docs/ARCHITECTURE.md)
- [Tenancy and verticals](../../docs/17-multi-tenancy-and-verticals.md)
- [Billing design](../../docs/08-billing-quota-credit.md)

- 2026-10-26 — Reused the existing training switch on the bot list, added named controls and pending/permission guards, synchronized list/detail rollback and refreshed the derived inbox availability cache. Existing basic/advanced settings are retained. Bot-list regressions pass (8 tests). Full milestone gate/browser QA pending.

- 2026-10-26 — Ready for human review: full pnpm check passed (frontend 367, backend 973 tests), independent code QA approved and fresh-context browser QA accepted the implemented workflows. See docs/handoffs/2026-10-26-lane-b-qa.md for exact commands, evidence and mocked-API limits.

- 2026-10-27 — Closed by lane B (@agent:claude): all acceptance criteria were checked and the change landed on main in 1b983a7 (reviewed in PR #64, pushed to main without a squash merge).

- 2026-10-28 — Source audit confirms the existing delivered behavior and previously checked acceptance criteria. Tracking reconciled under T-117; final branch regression evidence is recorded in docs/handoffs/2026-10-28-lane-b-closeout.md.
