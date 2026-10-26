---
id: T-092
title: Add account-level plans and aggregated usage settings
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

Users need a settings area for account packages and usage, separate from settings of the active business industry. Existing billing UI can be reused where applicable.

Source: cofounder walkthrough supplied in chat on 2026-10-26, including three screenshots. Estimates use the running `integration/local-all` checkout; the primary checkout is behind that integration in CRM, analytics, billing and inbox features.

## Goal

Add account-level plans and aggregated usage settings.

## Scope

- Add account-level plan and usage navigation outside selected-business settings, with clear billing owner and permission checks.
- Display package, allowance, used/remaining messages, reset date and breakdown by business/shop/bot from the approved usage API.
- Expose supported plan selection/change flows and honest pending/unavailable states; distinguish billable usage from inbox traffic.

## Out of scope

- Building new payment processing, wallet or invoice flows beyond currently supported capabilities.

## Acceptance criteria

- [ ] Switching businesses does not change the account allowance; breakdown totals reconcile with the quota service.
- [ ] Only authorized billing members can change the plan; ordinary business members cannot inspect unrelated business usage.
- [ ] Empty, expired, quota-exhausted and API error states are covered and both vi/en labels are present.
- [ ] Add/update meaningful regression coverage, permission and scope checks where applicable; `pnpm check` passes before implementation is complete.
- [ ] Update impacted docs and vi/en product strings; include migration and operational notes where applicable.

## Estimate and proposed assignment

- Proposed lane: B. A = user; B = cofounder. These are planning labels, not committed GitHub assignments.
- Base estimate: 3 person-days including implementation, self-review and task verification. One person-day is approximately six focused engineering hours.
- Uncertainty: approximately -30% / +40%; reassess after T-077. No claim that runtime failures have been reproduced during planning.
- Dependencies: T-079, T-091
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
