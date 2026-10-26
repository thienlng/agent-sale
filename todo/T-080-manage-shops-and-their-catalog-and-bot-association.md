---
id: T-080
title: Manage shops and their catalog and bot associations
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

A business can have several shops. The diagram suggests business-owned products available to its shops; this sharing rule remains a proposal pending T-077.

Source: cofounder walkthrough supplied in chat on 2026-10-26, including three screenshots. Estimates use the running `integration/local-all` checkout; the primary checkout is behind that integration in CRM, analytics, billing and inbox features.

## Goal

Manage shops and their catalog and bot associations.

## Scope

- Add shop listing, creation, editing and archive workflow with permissions and visible business context.
- Associate bots and channels using the agreed cardinality; expose reusable shop lookup contracts for inbox, integrations and CRM.
- Apply the approved business catalog versus shop availability/price/inventory policy without duplicating products silently.

## Out of scope

- A new inventory engine, product variants backlog T-028, full hotel reservation workflows.

## Acceptance criteria

- [ ] Create two shops in one business and configure their bot/channel associations without affecting another business.
- [ ] Archived shops retain historical records; reassignment follows explicit validation and confirmation.
- [ ] Document and test catalog ownership with one product available in multiple shops according to the approved policy.
- [ ] Add/update meaningful regression coverage, permission and scope checks where applicable; `pnpm check` passes before implementation is complete.
- [ ] Update impacted docs and vi/en product strings; include migration and operational notes where applicable.

## Estimate and proposed assignment

- Proposed lane: A. A = user; B = cofounder. These are planning labels, not committed GitHub assignments.
- Base estimate: 3 person-days including implementation, self-review and task verification. One person-day is approximately six focused engineering hours.
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
