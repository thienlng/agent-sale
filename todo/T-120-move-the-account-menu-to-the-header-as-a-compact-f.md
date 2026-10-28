---
id: T-120
title: Move the account menu to the header as a compact Facebook-style panel
status: review
type: feature
priority: P1
owner: '@agent:claude'
feature_ids: []
created: 2026-10-28
updated: 2026-10-28
branch: feat/T-120-header-account-menu
pr:
parent:
---

## Context

Owner review of the dashboard shell (2026-10-28): personal controls were split across two
corners. The sidebar footer held the account menu (language, log out) while the header's top
right held two unlabeled icons (light/dark toggle, layout customisation popover with colour
presets, sidebar variants, content width and navbar style). The account trigger also reused the
`⇕` switcher icon of the business selector, so two different controls looked identical. The
owner asked for the Facebook pattern: one avatar at the top right that opens a compact panel,
without exposing every appearance setting up front.

## Goal

All personal controls live behind one avatar button in the header; the panel shows identity and
a short list, with display settings one level deeper.

## Scope

- In scope: header avatar trigger; account panel (identity card, account security link,
  "Display and language" sub-view, log out); light/dark/system and language inside the
  sub-view; advanced layout customisation moved into a dialog reached from the sub-view;
  sidebar footer removed; "Rapiz home page" row linking to the marketing site (`VITE_SITE_URL`, lands with T-121); tests and docs.

## Out of scope

- A personal profile page (none exists yet; workspace profile stays under Settings).
- Moving the business selector (stays at the top of the sidebar).

## Acceptance criteria

- [x] Header shows a single avatar button (no theme/layout icons); the sidebar has no account footer.
- [x] The panel shows name and full email, "Account security", "Display and language ›" and "Log out".
- [x] "Display and language" swaps the panel content in place with a back button; theme mode and language apply without closing the panel.
- [x] Advanced layout customisation is still reachable (one level deeper) and keeps its reset.
- [x] Keyboard: open with Enter/Space, arrow navigation, Escape closes, Back returns to the main view.
- [x] Works at 375 px wide (avatar always visible on mobile).
- [x] Tests added/updated and `pnpm check` green
- [x] Docs updated (or "no docs impact" stated)

## Plan

1. `components/layout/account-menu.tsx`: DropdownMenu with an internal `view` state
   (`main` | `display`); items in the `display` view prevent default selection so the menu stays open.
2. `layout-controls.tsx`: turn the popover into `LayoutCustomizeDialog` (same controls);
   drop `ThemeToggle` and the header popover.
3. `app-shell.tsx`: header right = `AccountMenu`; `app-sidebar.tsx`: remove `SidebarFooter`/`NavUser`.
4. i18n (vi/en) keys under `account.*`.
5. Unit test for the menu; update e2e specs that opened the old sidebar account button.

## Log

- 2026-10-28 — created after owner review; owner chose option A (avatar top right, Facebook-style compact panel).
- 2026-10-28 — owner added: plan and billing as one menu row that opens a popup (not inline usage); option (b): ship the menu now, add the AI-message usage meter to the popup when T-089 lands. Layout customisation kept, one level deeper in a dialog.
- 2026-10-28 — verified: web typecheck, lint, 508 unit tests green; affected e2e specs (statistics-home, inbox-compose-continuity, responsive) pass except `every layout preference combination`, which also fails on `main` before this change (pre-existing, follow-up task). Browser check at 1440 and 375 px.
- 2026-10-28 — fresh-context QA agent review: accept with fixes. Fixed: focus returns to the avatar after the plan/layout popups close (was <body>); avatar hit area 44 px; layout reset no longer resets light/dark; Escape in the display view goes back one level; blank-name initials fallback. Tests added for each.

## Links

- Docs: docs/ARCHITECTURE.md (web shell)
- Related tasks: T-106 (inbox), apps/site landing merge (to be created)
