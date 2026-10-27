---
id: T-081
title: Redesign portfolio and business statistics entry screens
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

Root currently redirects to bots even though statistics already exist on the integration branch (T-039–T-041). The review asks for a portfolio overview and a business detail dashboard.

Source: cofounder walkthrough supplied in chat on 2026-10-26, including three screenshots. Estimates use the running `integration/local-all` checkout; the primary checkout is behind that integration in CRM, analytics, billing and inbox features.

## Goal

Redesign portfolio and business statistics entry screens.

## Scope

- Make authenticated root/logo open an account portfolio dashboard; selecting a business opens its statistics detail, with explicit scope labels.
- Reuse existing metric definitions and projections; design KPI cards, trends, business/shop breakdowns, date comparison and useful empty/loading/error states.
- Preserve permission-scoped drilldowns and distinguish operational conversation metrics from billable message usage.

## Out of scope

- Reimplementing T-039–T-041, inventing unapproved KPIs, payment reporting beyond existing data.

## Acceptance criteria

- [ ] Logo returns to all authorized businesses; opening one business never includes unrelated business data.
- [ ] Figures reconcile with existing metric definitions and filtered drilldowns; totals avoid duplicate contacts or events.
- [ ] Desktop/mobile screenshots are reviewed; keyboard navigation and 375–1920 px responsive checks pass.
- [ ] Add/update meaningful regression coverage, permission and scope checks where applicable; `pnpm check` passes before implementation is complete.
- [ ] Update impacted docs and vi/en product strings; include migration and operational notes where applicable.

## Estimate and proposed assignment

- Proposed lane: B. A = cofounder; B = user with Codex (updated user assignment). These are planning labels, not committed GitHub assignments.
- Base estimate: 4 person-days including implementation, self-review and task verification. One person-day is approximately six focused engineering hours.
- Uncertainty: approximately -30% / +40%; reassess after T-077. No claim that runtime failures have been reproduced during planning.
- Dependencies: T-077, T-078, T-079
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

- 2026-10-26 — Lane B triage: The all-business portfolio requires account/business authorization and aggregation from T-077/T-078/T-079. Existing business analytics is preserved; no cross-business mock dashboard was shipped.
