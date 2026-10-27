---
id: T-087
title: Filter the multichannel inbox by shop bot and channel scope
status: backlog
type: bug
priority: P1
owner: "@agent:claude"
feature_ids: []
created: 2026-10-26
updated: 2026-10-27
branch:
pr:
parent:
---

## Context

Reviewers need to filter a single shop across its channels. Provider-only or current-bot-only filtering cannot express the approved business/shop model.

Source: cofounder walkthrough supplied in chat on 2026-10-26, including three screenshots. Estimates use the running `integration/local-all` checkout; the primary checkout is behind that integration in CRM, analytics, billing and inbox features.

## Goal

Filter the multichannel inbox by shop bot and channel scope.

## Scope

- Implement server-side business/shop/bot/channel filtering with deterministic combinations, counts and pagination.
- Define history semantics when a page changes bot/shop; retain original attribution where required by T-077.
- Reset incompatible filter values on context changes; preserve supported filters in URLs or saved views and scope realtime updates.

## Out of scope

- Inbox visual redesign T-086, adding unsupported channel providers.

## Acceptance criteria

- [ ] With two shops using the same provider, choosing one shop returns only that shop across all its channels and pages.
- [ ] Composed filters, unread counts and pagination agree with server results; invalid cross-business IDs are rejected.
- [ ] Reassigning a page follows the approved historical attribution rule without silently moving old conversations between shops.
- [ ] Add/update meaningful regression coverage, permission and scope checks where applicable; `pnpm check` passes before implementation is complete.
- [ ] Update impacted docs and vi/en product strings; include migration and operational notes where applicable.

## Estimate and proposed assignment

- Proposed lane: B. A = cofounder; B = user with Codex (updated user assignment). These are planning labels, not committed GitHub assignments.
- Base estimate: 3 person-days including implementation, self-review and task verification. One person-day is approximately six focused engineering hours.
- Uncertainty: approximately -30% / +40%; reassess after T-077. No claim that runtime failures have been reproduced during planning.
- Dependencies: T-078, T-080, T-082
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

- 2026-10-26 — Lane B triage: Server-side shop filtering and historical attribution require the shop/contracts work in T-077/T-078/T-080. Existing channel filters are preserved; UI-only filtering is not substituted for authorized server scope.

- 2026-10-27 — Lane B owner set to @agent:claude by the user.
