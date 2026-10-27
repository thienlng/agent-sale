---
id: T-083
title: Move fanpage management into the bot workspace navigation
status: done
type: feature
priority: P1
owner: "@agent:codex"
feature_ids: []
created: 2026-10-26
updated: 2026-10-27
branch: feat/T-090-lane-b-review
pr: 64
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

- [x] Users can reach bot fanpages from bot management and global integrations from the outer menu without duplicate destinations.
- [x] Existing bookmarks resolve to the correct page; no bot or channel data is deleted by navigation changes.
- [x] Add/update meaningful regression coverage, permission and scope checks where applicable; `pnpm check` passes before implementation is complete.
- [x] Update impacted docs and vi/en product strings; include migration and operational notes where applicable.

## Estimate and proposed assignment

- Proposed lane: B. A = cofounder; B = user with Codex (updated user assignment). These are planning labels, not committed GitHub assignments.
- Base estimate: 2 person-days including implementation, self-review and task verification. One person-day is approximately six focused engineering hours.
- Uncertainty: approximately -30% / +40%; reassess after T-077. No claim that runtime failures have been reproduced during planning.
- Dependencies: T-077, T-082
- See the milestone handoff for scheduling, shared contracts, assumptions and exclusions.

## Plan

1. Reuse the existing bot integrations route as the clearly named fanpage/channel manager, with a link to the global inventory.
2. Move global platform integrations out of the multichannel submenu, keeping a single global destination and preserving both existing URLs. No connection data is removed and no invented legacy route needs a redirect.
3. Verify navigation and page selection in browser, check mobile layout and i18n labels. This navigation slice uses existing workspace/bot scope; shop constraints remain under T-082/lane A.

Autonomous implementation authorized by the user on 2026-10-26. Account/business/shop contracts remain lane A responsibilities.

## Log

- 2026-10-26 — Created from cofounder review; proposed allocation only. No application changes made.

## Links

- [Review milestone handoff](../../docs/handoffs/2026-10-26-cofounder-review-plan.md)
- [Architecture](../../docs/ARCHITECTURE.md)
- [Tenancy and verticals](../../docs/17-multi-tenancy-and-verticals.md)
- [Billing design](../../docs/08-billing-quota-credit.md)

- 2026-10-26 — Reused the existing bot integration URL as Pages and channels, linked to the global inventory and moved that inventory outside the multichannel submenu. Both old URLs remain valid and no data was removed. Independent QA reviewed the navigation; browser traversal passed.

- 2026-10-26 — Ready for human review: full pnpm check passed (frontend 367, backend 973 tests), independent code QA approved and fresh-context browser QA accepted the implemented workflows. See docs/handoffs/2026-10-26-lane-b-qa.md for exact commands, evidence and mocked-API limits.

- 2026-10-27 — Closed by lane B (@agent:claude): all acceptance criteria were checked and the change landed on main in 1b983a7 (reviewed in PR #64, pushed to main without a squash merge).
