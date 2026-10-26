---
id: T-083
title: Move fanpage management into the bot workspace navigation
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

Fanpage management should live under bot management; the duplicate fanpage entry in the outer multichannel menu should be removed while the global integrations inventory remains.

Source: cofounder walkthrough supplied in chat on 2026-10-26, including three screenshots. Estimates use the running `integration/local-all` checkout; the primary checkout is behind that integration in CRM, analytics, billing and inbox features.

## Goal

Move fanpage management into the bot workspace navigation.

## Scope

- Add or rename the bot fanpage/channel management page using the shared assignment implementation from T-082.
- Remove the redundant outer fanpage navigation item and preserve global platform integrations.
- Redirect old fanpage deep links with preserved scope and update vi/en labels, breadcrumbs and navigation tests.

## Out of scope

- Channel assignment implementation owned by T-082, removing provider connections.

## Acceptance criteria

- [ ] Users can reach bot fanpages from bot management and global integrations from the outer menu without duplicate destinations.
- [ ] Existing bookmarks resolve to the correct page; no bot or channel data is deleted by navigation changes.
- [ ] Add/update meaningful regression coverage, permission and scope checks where applicable; `pnpm check` passes before implementation is complete.
- [ ] Update impacted docs and vi/en product strings; include migration and operational notes where applicable.

## Estimate and proposed assignment

- Proposed lane: B. A = user; B = cofounder. These are planning labels, not committed GitHub assignments.
- Base estimate: 2 person-days including implementation, self-review and task verification. One person-day is approximately six focused engineering hours.
- Uncertainty: approximately -30% / +40%; reassess after T-077. No claim that runtime failures have been reproduced during planning.
- Dependencies: T-077, T-082
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
