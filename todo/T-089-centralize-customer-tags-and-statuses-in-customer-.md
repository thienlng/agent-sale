---
id: T-089
title: Centralize customer tags and statuses in customer settings
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

Tags and customer statuses must have one configuration home and shared identities across CRM and inbox. Customer status must remain distinct from conversation open/resolved state.

Source: cofounder walkthrough supplied in chat on 2026-10-26, including three screenshots. Estimates use the running `integration/local-all` checkout; the primary checkout is behind that integration in CRM, analytics, billing and inbox features.

## Goal

Centralize customer tags and statuses in customer settings.

## Scope

- Use Customer settings as the canonical place to manage tag/status definitions; reuse existing CRM sources/statuses/tags capabilities.
- Have inbox and CRM consume identical definitions and mutation contracts; define business versus shop configuration scope in T-077.
- Migrate duplicate definitions using an explicit mapping, preserve assignments and redirect old settings links.

## Out of scope

- Fixing the separate live tag mutation defect T-090, creating a second tag storage system.

## Acceptance criteria

- [ ] Create or rename a tag/status in Customer settings and see the same ID/name reflected in CRM and inbox after refresh.
- [ ] Customer status is independent of conversation resolution and bot enabled state.
- [ ] Archiving a definition preserves historical assignments; permissions and conflict behavior are covered.
- [ ] Add/update meaningful regression coverage, permission and scope checks where applicable; `pnpm check` passes before implementation is complete.
- [ ] Update impacted docs and vi/en product strings; include migration and operational notes where applicable.

## Estimate and proposed assignment

- Proposed lane: A. A = user; B = cofounder. These are planning labels, not committed GitHub assignments.
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
