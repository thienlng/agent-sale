---
id: T-079
title: Add business selection and switching across sessions
status: review
type: feature
priority: P1
owner: "@agent:claude"
feature_ids: []
created: 2026-10-26
updated: 2026-10-28
branch: feat/T-079-business-switching
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

- [x] A user with two businesses picks one after login, switches from the avatar menu and the sidebar, and reloads without stale data.
- [x] A response arriving after a switch cannot populate another business view; unauthorized deep links are rejected; revoked membership lands on a safe screen.
- [x] A user without any business can create one under their account.
- [x] UI tests and e2e; `pnpm check` passes; vi/en strings; docs/analytics.md T-081 note updated (switching now also in the avatar menu).

## Estimate and proposed assignment

- Lane: A, owned by @agent:claude since 2026-10-28.
- Base estimate: 2 person-days (was 3: T-081 delivered the selector and cache isolation).
- Uncertainty: approximately -30% / +40%; reassess after T-077. No claim that runtime failures have been reproduced during planning.
- Dependencies: T-077, T-078
- See the milestone handoff for scheduling, shared contracts, assumptions and exclusions.

## Plan

1. Backend:
   - `GET /bootstrap` returns `accounts` (the accounts the user owns or bills for).
   - Each membership carries `accountId`, `accountName` and `industry`. A member sees the name of the account owning a business they work in, for grouping only (ADR-012 fixture).
   - The workspace guard's 404 for a non-member carries `details.reason = 'workspace_access'`.
2. Web session:
   - `accounts` is added to the session.
   - With several businesses and none remembered (or the remembered one gone), there is no current business and `/app` redirects to `/app/select-business`.
   - With no business, `/app` redirects to `/app/welcome`.
3. Web pages:
   - `/app/select-business` lists businesses grouped by account.
   - `/app/welcome` creates a business (`POST /workspaces` with `{name, industry, accountId?}`).
   - Both set the business and open analytics.
4. Avatar menu: businesses grouped by account, the current one checked, plus "Create business". Uses the same `useBusinessSwitch` as the sidebar picker.
5. Lost business: the API client recognizes `workspace_access` on a scoped request, reloads the session, and lands on the business picker with a notice.
6. Tests: an integration test for bootstrap and the guard reason; UI tests for the pages and the menu; e2e for picking, switching and creating.

## Log

- 2026-10-28 — Web done; in review.
  - **Pages:** `/businesses` (choose, grouped by account; `?lost=true` notice) and `/businesses/new` (create; asks for the account only when the user owns several). The `/app` guard sends a user without a chosen business to one of them.
  - **Selection rule changed:** the first business is no longer auto-selected when the user has several. The remembered one is used if still a member, else the only one, else the user chooses.
  - **Avatar menu:** a "Switch business" submenu, grouped by account, with "Create business". It replaces T-081's "no business in the account dropdown" rule (e2e updated).
  - **Lost business:** the API client recognizes `workspace_access`, reloads bootstrap once, and navigates to the picker.
  - **Tests:** unit and UI (session, grouping, picker, create form, avatar menu); e2e `business-switching.spec.ts` and the updated `statistics-home.spec.ts`. The full e2e suite passes 52/52 with 3 workers. With 16 workers the 4 `responsive` tests time out under load; they pass alone.
  - **Not done:** a deep link opened before choosing a business lands on analytics after the choice, not on the original link.
- 2026-10-28 — Started. Backend: bootstrap accounts, membership account and industry, guard reason `workspace_access`.
- 2026-10-28 — Replanned for lane A, now owned by @agent:claude (user decision, 2026-10-28). Product model agreed with the user: account → business (workspace) → bot → channels. **No separate shop entity**: the bot is the selling unit. The catalog is business-owned and each bot chooses which products it sells. Billable unit: an AI reply delivered to the customer, counted once across retries. When the allowance is exhausted, the bot stops and hands off to staff. Business switching lives in the avatar (account) menu. Code inventory and re-estimate: see the handoff's "Lane A replan" section.

- 2026-10-26 — Created from cofounder review; proposed allocation only. No application changes made.

## Links

- [Review milestone handoff](../docs/handoffs/2026-10-26-cofounder-review-plan.md)
- [Architecture](../docs/ARCHITECTURE.md)
- [Tenancy and verticals](../docs/17-multi-tenancy-and-verticals.md)
- [Billing design](../docs/08-billing-quota-credit.md)
