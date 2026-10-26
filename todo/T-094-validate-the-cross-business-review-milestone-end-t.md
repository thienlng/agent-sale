---
id: T-094
title: Validate the cross-business review milestone end to end
status: backlog
type: chore
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

The review changes scope, navigation, assignment and billing across modules. Final integration checks need an explicit owner and acceptance dataset.

Source: cofounder walkthrough supplied in chat on 2026-10-26, including three screenshots. Estimates use the running `integration/local-all` checkout; the primary checkout is behind that integration in CRM, analytics, billing and inbox features.

## Goal

Validate the cross-business review milestone end to end.

## Scope

- Each lane spends two person-days on joint integration: seed two accounts, multiple businesses/industries, shops, bots, assigned/unassigned pages and returning customers.
- Validate account/business/shop isolation, switching, history, live tag mutations, assignment, bot toggle, CRM navigation, statistics and quota reconciliation.
- Run pnpm check and targeted cross-tenant/live-backend E2E; record screenshots, migration reconciliation and rollback/release order.

## Out of scope

- Rebuilding Testcontainers T-006, fixing unrelated bundle issue T-076, treating existing failing gates as waived.

## Acceptance criteria

- [ ] Both owners review the complete scenario matrix and each critical failure has a tracked task rather than a waived assertion.
- [ ] Full checks and targeted browser/API regressions pass against the same integration revision; record preexisting blockers explicitly.
- [ ] A staged migration/release plan covers old sessions, in-flight jobs, existing subscriptions and recovery.
- [ ] Add/update meaningful regression coverage, permission and scope checks where applicable; `pnpm check` passes before implementation is complete.
- [ ] Update impacted docs and vi/en product strings; include migration and operational notes where applicable.

## Estimate and proposed assignment

- Proposed lane: Shared. A = user; B = cofounder. These are planning labels, not committed GitHub assignments.
- Base estimate: 4 person-days including implementation, self-review and task verification. One person-day is approximately six focused engineering hours.
- Uncertainty: approximately -30% / +40%; reassess after T-077. No claim that runtime failures have been reproduced during planning.
- Dependencies: T-078, T-079, T-080, T-081, T-082, T-083, T-084, T-085, T-086, T-087, T-088, T-089, T-090, T-091, T-092, T-093
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
