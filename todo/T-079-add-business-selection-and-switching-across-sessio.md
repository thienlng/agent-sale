---
id: T-079
title: Add business selection and switching across sessions
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

Users must select a business after login and switch it from the account menu or business selector. Current dashboard scope comes from a single session workspaceId.

Source: cofounder walkthrough supplied in chat on 2026-10-26, including three screenshots. Estimates use the running `integration/local-all` checkout; the primary checkout is behind that integration in CRM, analytics, billing and inbox features.

## Goal

Add business selection and switching across sessions.

## Scope

- Add business selection after authentication, accessible-business listing, account-menu switching and a persistent visible business selector.
- Bind API authorization to the selected business; cancel in-flight requests and clear or isolate query caches, drafts, selections and realtime subscriptions on switch.
- Define deep-link, reload, no-business, revoked-membership and single-business behavior.

## Out of scope

- Dashboard charts, shop administration, changing authentication providers.

## Acceptance criteria

- [ ] A user with two businesses can select either through both entry points and reload without seeing stale data.
- [ ] A response arriving after a switch cannot populate another business view; unauthorized deep links are rejected.
- [ ] Login selection and global portfolio navigation follow the route contract from T-077.
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
