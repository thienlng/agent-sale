---
id: T-078
title: Add account business and shop persistence with safe backfills
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

The current runtime has workspaces with industry and business profile fields, but no first-class shop hierarchy. Adding hierarchy affects every scoped module.

Source: cofounder walkthrough supplied in chat on 2026-10-26, including three screenshots. Estimates use the running `integration/local-all` checkout; the primary checkout is behind that integration in CRM, analytics, billing and inbox features.

## Goal

Add account business and shop persistence with safe backfills.

## Scope

- Implement the approved account-to-business and business-to-shop model, membership authorization and scoped contracts.
- Preserve business/workspace isolation and add shop consistency checks for bots, channels, contacts, commerce, analytics and background jobs through module APIs.
- Backfill existing workspace data into explicit business/shop associations with a dry-run reconciliation report and backward-compatible rollout.

## Out of scope

- Account billing quota logic, UI redesign, new industry engines.

## Acceptance criteria

- [ ] Existing bots, connections, conversations, contacts, orders and subscriptions remain reachable after backfill; unresolved ownership is reported rather than silently guessed.
- [ ] Cross-account and cross-business IDs are rejected; invalid shop/bot/channel combinations cannot be saved.
- [ ] Jobs and webhook routing retain the correct workspace and shop; migration/backfill is repeatable and has documented rollback boundaries.
- [ ] Add/update meaningful regression coverage, permission and scope checks where applicable; `pnpm check` passes before implementation is complete.
- [ ] Update impacted docs and vi/en product strings; include migration and operational notes where applicable.

## Estimate and proposed assignment

- Proposed lane: A. A = user; B = cofounder. These are planning labels, not committed GitHub assignments.
- Base estimate: 6 person-days including implementation, self-review and task verification. One person-day is approximately six focused engineering hours.
- Uncertainty: approximately -30% / +40%; reassess after T-077. No claim that runtime failures have been reproduced during planning.
- Dependencies: T-077
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
