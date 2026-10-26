---
id: T-082
title: Unify channel assignment and bulk bot filters
status: backlog
type: bug
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

Workspace and bot integration screens already share IntegrationsView and assignment code. The review reports inconsistent behavior and confusing activation wording.

Source: cofounder walkthrough supplied in chat on 2026-10-26, including three screenshots. Estimates use the running `integration/local-all` checkout; the primary checkout is behind that integration in CRM, analytics, billing and inbox features.

## Goal

Unify channel assignment and bulk bot filters.

## Scope

- Show all connections with assigned bot/shop on the outer integrations page; inside a bot, select eligible connected channels from the same source of truth.
- Support selecting multiple pages and assigning or removing one bot, with filters by bot and unassigned state.
- Replace activation wording with assignment wording; distinguish disconnected/expired provider credentials from a connected page lacking a bot.
- Invalidate both views after updates; handle reassignment confirmation, partial failures and safe retry.

## Out of scope

- Adding Zalo/TikTok/Lazada providers; existing placeholder providers remain explicitly unavailable.

## Acceptance criteria

- [ ] Assign two pages to a bot from the outer page and verify both appear inside that bot immediately and after reload; unassign from either direction.
- [ ] Bot and unassigned filters compose with platform/search/shop scope and produce consistent results.
- [ ] Failed or unauthorized rows retain their prior assignment and a retry cannot silently move other pages.
- [ ] Add/update meaningful regression coverage, permission and scope checks where applicable; `pnpm check` passes before implementation is complete.
- [ ] Update impacted docs and vi/en product strings; include migration and operational notes where applicable.

## Estimate and proposed assignment

- Proposed lane: B. A = user; B = cofounder. These are planning labels, not committed GitHub assignments.
- Base estimate: 3 person-days including implementation, self-review and task verification. One person-day is approximately six focused engineering hours.
- Uncertainty: approximately -30% / +40%; reassess after T-077. No claim that runtime failures have been reproduced during planning.
- Dependencies: T-077, T-078, T-080
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
