---
id: T-084
title: Expose bot switches and advanced settings consistently
status: backlog
type: feature
priority: P1
owner:
feature_ids: []
created: 2026-10-26
updated: 2026-10-26
branch:
pr:
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

- [ ] Switch state persists across reload and both screens agree; failed saves restore the prior UI state.
- [ ] Turning a bot off prevents subsequent AI replies without unassigning its channels; human inbox messaging remains usable.
- [ ] Advanced controls correspond to documented API/runtime behavior and permissions.
- [ ] Add/update meaningful regression coverage, permission and scope checks where applicable; `pnpm check` passes before implementation is complete.
- [ ] Update impacted docs and vi/en product strings; include migration and operational notes where applicable.

## Estimate and proposed assignment

- Proposed lane: B. A = user; B = cofounder. These are planning labels, not committed GitHub assignments.
- Base estimate: 2 person-days including implementation, self-review and task verification. One person-day is approximately six focused engineering hours.
- Uncertainty: approximately -30% / +40%; reassess after T-077. No claim that runtime failures have been reproduced during planning.
- Dependencies: T-077, T-078
- See the milestone handoff for scheduling, shared contracts, assumptions and exclusions.

## Plan

To be filled by the implementer before coding. Scope and acceptance above are the planning contract.

## Log

- 2026-10-26 — Created from cofounder review; proposed allocation only. No application changes made.

## Links

- [Review milestone handoff](../docs/handoffs/2026-10-26-cofounder-review-plan.md)
- [Architecture](../docs/ARCHITECTURE.md)
- [Tenancy and verticals](../docs/17-multi-tenancy-and-verticals.md)
- [Billing design](../docs/08-billing-quota-credit.md)
