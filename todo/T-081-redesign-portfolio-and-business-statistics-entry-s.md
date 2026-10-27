---
id: T-081
title: Redesign portfolio and business statistics entry screens
status: in-progress
type: feature
priority: P1
owner: "@agent:codex"
feature_ids: []
created: 2026-10-26
updated: 2026-10-27
branch: feat/T-081-overview-design
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

## Implementation plan (approved 2026-10-27)

The user approved the reviewed design and explicitly requested implementation. This is approval to proceed beyond the design-only plan below; no additional plan-approval pause is needed.

1. Add regressions for immutable tenant headers/retries, selected-business scoping, business switching and actual statistics layout.
2. Use existing workspace memberships as authorized business contexts; add a sidebar-only selector and preserve all other navigation. Navigate to business statistics before changing context, honor existing route blockers, reject unknown memberships, clear old tenant queries/remount content, and disable switching during mutations.
3. Make selected-business statistics the default home, put it first, and route the logo to a separate portfolio statistics page. Keep the account menu anchored and free of business options.
4. Restyle existing statistics with four primary KPIs, a compact date toolbar, progressive filters, an area chart and accessible detail disclosure. Preserve definitions, drilldowns, partial errors, permissions, watermark and data freshness.
5. Read portfolio statistics through explicit per-request tenant headers without changing the active business. Label partial/own-scope results honestly. No shop records, ownership model or account billing contracts exist yet: do not invent them or substitute channels for shops. Keep shop breakdown acceptance open for lane A.
6. Update vi/en strings and implementation docs; run targeted tests, full pnpm check, browser checks and independent same-model QA. Publish the reviewable development UI without touching unrelated dirty work.

Files: apps/web/src/{components/layout,components/app-shell.tsx,lib/api-client.ts,lib/session.ts,features/analytics,routes}; packages/i18n message catalogs; docs and task tracking. No backend schema, module, dependency, protected config or unrelated screen redesign.

## Design plan history

Design-only iteration authorized on 2026-10-27:
1. Audit the serving checkout shell, bot navigation, inbox and analytics contracts.
2. Apply the user-supplied UI/UX Pro Max skill without replacing existing brand tokens or fonts.
3. Create a standalone interactive overview prototype and an English design rationale under docs/designs/T-081/; no application/API/schema changes.
4. Verify scope switching, keyboard interaction and responsive layouts; obtain independent same-model agent QA.
5. Present only this first part for product feedback. Production implementation and remaining acceptance stay open pending lane A contracts and user design review.

## Log

- 2026-10-26 — Created from cofounder review; proposed allocation only. No application changes made.

## Links

- [Review milestone handoff](../docs/handoffs/2026-10-26-cofounder-review-plan.md)
- [Architecture](../docs/ARCHITECTURE.md)
- [Tenancy and verticals](../docs/17-multi-tenancy-and-verticals.md)
- [Billing design](../docs/08-billing-quota-credit.md)

- 2026-10-26 — Lane B triage: The all-business portfolio requires account/business authorization and aggregation from T-077/T-078/T-079. Existing business analytics is preserved; no cross-business mock dashboard was shipped.

- 2026-10-27 — User rejected the generic prior proposal and requested fewer clicks, actual-project evidence, the local UI/UX skill, and independent same-model QA. This branch contains design artifacts only.

- 2026-10-27 — First interactive design draft created under docs/designs/T-081. Nine browser scenarios pass on the final source. Design review remains open; no production acceptance is checked.

- 2026-10-27 — Iteration 2: user approved statistics direction, limited scope to statistics/context controls, required existing multichannel navigation, selected-business home, all-shop logo aggregation, and anchored account dropdown. Updated isolated prototype only; seven author browser scenarios passed and same-model independent QA approved 51 assertions, including corrected short-drawer and resize regressions. Production acceptance remains open.

- 2026-10-27 — User requested real-project implementation and removed business options from the account dropdown. Business selection lives only in the sidebar. Existing membership and analytics APIs permit a real business dashboard/portfolio read; shop aggregation awaits lane A.
