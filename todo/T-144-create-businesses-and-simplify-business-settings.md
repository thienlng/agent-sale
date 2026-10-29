---
id: T-144
title: Create businesses from the selector, simplify business settings, fix the settings tab arrows
status: review
type: feature
priority: P1
owner: "@agent:claude"
feature_ids: [ACC-07]
created: 2026-10-29
updated: 2026-10-29
branch: feat/T-144-business-create-settings
pr:
parent:
---

## Context

Owner request 2026-10-29: there is no button to create a business; the business settings screen repeats the name and shows the business type twice (read-only input plus a free-text field); the settings tabs show two vertical scroll arrows. Model: ADR-012 (account → business → bot → channels); the industry is the business template, chosen at creation. Design proposal from T-130 was followed except where the owner decision narrowed it.

## Goal

An owner creates a business (name + template) from the selector, and the settings page has one name field, a read-only template summary and no vertical tab scroll.

## Scope

- In scope: create-business dialog in the selector; one-card business information page; remove `businessServices`/`productDescription` from the UI (kept in API/contract, documented as deprecated); shared `SettingsTabs`; refresh of session/current-workspace after rename; tests, e2e, docs.
- Out of scope: changing a business template after creation (needs a migration policy); backend or schema changes; moving to account-level multiple accounts.

## Acceptance criteria

- [x] The selector always shows "+ Tạo business" (also with no search results) and opens a dialog with a required name (1-120) and template cards with descriptions.
- [x] Submit calls `POST /workspaces`, reloads memberships, switches business and opens `/app/analytics`; double submit blocked; inputs kept on error with a message.
- [x] Settings has one editable business name, the template as a labelled read-only summary, company name collapsed, no services/description fields, a pointer to the bots list.
- [x] A rename refreshes the selector label, the current-business query and the profile query without reload.
- [x] Settings tab strips have no vertical scroll at 1280 and 375 px; active underline still visible.
- [x] Tests added/updated; web checks green (see Log)
- [x] Docs updated

## Plan

1. i18n vi/en: `business.create.*`, `wsettings.profile.*`.
2. Tests first, then `CreateBusinessDialog` (features/workspace), selector prop `createBusinessDialog` passed from `routes/app.tsx` through `AppShell`/`AppSidebar`.
3. Rewrite `ProfilePage`/`BusinessIndustry`; `useProfileMutations.update` invalidates `workspaceKeys.current` and calls `reloadSession`.
4. Extract `components/settings-tabs.tsx`; use in the three settings layouts.
5. e2e: `business-create.spec.ts`, `settings-tabs.spec.ts`; update affected specs. Docs.

## Log

- 2026-10-29 — verified by grep that `businessServices`/`productDescription` are not read in `apps/backend/src/modules/ai` or `packages/ai-core`.
- 2026-10-29 — decisions: no default template (the choice is permanent, so the user picks consciously; submit stays disabled until chosen); if memberships reload or the switch fails after the business was created, the dialog keeps an error and disables submit to avoid creating a duplicate; the template summary reuses `useCurrentWorkspace`; tab baseline is an inset box-shadow on the nav (`var(--border)`) with `overflow-y-hidden`; removed unused `wsettings.industry.*` strings; vi tab label "Hồ sơ business", page title "Thông tin business".
- 2026-10-29 — implemented on feat/T-144-business-create-settings; verification results are in the final report.

## Links

- Docs: `docs/03-screens-and-routes.md` (Business selector and business information), `docs/adr/ADR-012-accounts-own-businesses-bot-is-selling-unit.md`
- Related tasks: T-130 (design), T-139 (bot business profile)
