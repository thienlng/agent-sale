---
id: T-079
title: Add business selection and switching across sessions
status: backlog
type: feature
priority: P1
owner: "@agent:claude"
feature_ids: []
created: 2026-10-26
updated: 2026-10-28
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

- Already delivered by T-081: the sidebar selector, tenant captured per request, query cancel and removal on switch, remembered business on reload.
- Remaining:
  - choosing a business after login when the user has several;
  - switching from the avatar (account) menu, grouped by account;
  - creating a business under an account;
  - a no-business state;
  - reacting to revoked membership mid-session (404 → reload bootstrap);
  - deep links.

## Out of scope

- Dashboard charts, shop administration, changing authentication providers.

## Acceptance criteria

- [ ] A user with two businesses picks one after login, switches from the avatar menu and the sidebar, and reloads without stale data.
- [ ] A response arriving after a switch cannot populate another business view; unauthorized deep links are rejected; revoked membership lands on a safe screen.
- [ ] A user without any business can create one under their account.
- [ ] UI tests and e2e; `pnpm check` passes; vi/en strings; docs/analytics.md T-081 note updated (switching now also in the avatar menu).

## Estimate and proposed assignment

- Lane: A, owned by @agent:claude since 2026-10-28.
- Base estimate: 2 person-days (was 3: T-081 delivered the selector and cache isolation).
- Uncertainty: approximately -30% / +40%; reassess after T-077. No claim that runtime failures have been reproduced during planning.
- Dependencies: T-077, T-078
- See the milestone handoff for scheduling, shared contracts, assumptions and exclusions.

## Plan

To be filled by the implementer before coding. Scope and acceptance above are the planning contract.

## Log

- 2026-10-28 — Replanned for lane A, now owned by @agent:claude (user decision, 2026-10-28). Product model agreed with the user: account → business (workspace) → bot → channels. **No separate shop entity**: the bot is the selling unit. The catalog is business-owned and each bot chooses which products it sells. Billable unit: an AI reply delivered to the customer, counted once across retries. When the allowance is exhausted, the bot stops and hands off to staff. Business switching lives in the avatar (account) menu. Code inventory and re-estimate: see the handoff's "Lane A replan" section.

- 2026-10-26 — Created from cofounder review; proposed allocation only. No application changes made.

## Links

- [Review milestone handoff](../docs/handoffs/2026-10-26-cofounder-review-plan.md)
- [Architecture](../docs/ARCHITECTURE.md)
- [Tenancy and verticals](../docs/17-multi-tenancy-and-verticals.md)
- [Billing design](../docs/08-billing-quota-credit.md)
