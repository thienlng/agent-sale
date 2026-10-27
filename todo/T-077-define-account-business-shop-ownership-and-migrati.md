---
id: T-077
title: Define account business shop ownership and migration contracts
status: backlog
type: spike
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

The review introduces an account-level portfolio and billing owner above businesses, each with one industry and multiple shops. Existing workspaces, membership and billing must be mapped explicitly before dependent changes.

Source: cofounder walkthrough supplied in chat on 2026-10-26, including three screenshots. Estimates use the running `integration/local-all` checkout; the primary checkout is behind that integration in CRM, analytics, billing and inbox features.

## Goal

Define account business shop ownership and migration contracts.

## Scope

- Write a proposed ADR mapping business to workspace where viable, preserving workspace_id RLS; define account/billing membership independently of personal login.
- Define shop ownership, bot cardinality, channel assignment, catalog sharing, CRM identity and historical attribution; publish DTO/API examples and a route/navigation map.
- Inventory current integration implementation and resolve the pending decisions in the handoff.

## Out of scope

- Implementing migrations or changing runtime behavior.

## Acceptance criteria

- [ ] Review a fixture with two accounts, two industries, multiple shops and one shared business member; enumerate permitted and forbidden reads.
- [ ] Approve migration/backfill and rollback plans, account billing ownership, catalog scope and bot/shop cardinality before dependent migrations.
- [ ] Document which existing ADR and billing/vertical design sections need updates; architecture implementation requires an accepted decision.
- [ ] Add/update meaningful regression coverage, permission and scope checks where applicable; `pnpm check` passes before implementation is complete.
- [ ] Update impacted docs and vi/en product strings; include migration and operational notes where applicable.

## Estimate and proposed assignment

- Proposed lane: A. A = user; B = cofounder. These are planning labels, not committed GitHub assignments.
- Base estimate: 2 person-days including implementation, self-review and task verification. One person-day is approximately six focused engineering hours.
- Uncertainty: approximately -30% / +40%; reassess after T-077. No claim that runtime failures have been reproduced during planning.
- Dependencies: None; start independently.
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
