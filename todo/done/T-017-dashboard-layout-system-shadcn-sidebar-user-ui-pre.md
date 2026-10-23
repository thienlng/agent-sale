---
id: T-017
title: Dashboard layout system: shadcn sidebar, user UI preferences, responsive guard
status: done
type: feature
priority: P0
owner: @agent:claude
feature_ids: []            # e.g. [BOT-07, CRM-11] from docs/02-functional-requirements.md
created: 2026-10-24
updated: 2026-10-24
branch: feat/T-015-m2-bot-playground (milestone M2)
pr:
parent: T-005
---

## Context

Owner review of the M2 UI (2026-10-24): worried about responsiveness and missing user layout settings; pointed at a repo built on the Studio Admin template (arhamkhnz/next-shadcn-admin-dashboard, MIT) with a layout customizer. Following an established template lowers the risk of small layout bugs (overlaps, padding, breakpoints).

## Goal

The dashboard shell uses shadcn's Sidebar and the Studio Admin preference model (ported to the Vite SPA), users can choose their layout, and responsive regressions are caught by tests.

## Scope

- shadcn `sidebar` (+ `use-mobile`, `breadcrumb`, `toggle-group`) replaces the hand-made shell: collapsible to icons or off-canvas, mobile sheet, keyboard shortcut.
- Preferences (Studio Admin model): theme mode (light/dark/system), theme preset, sidebar variant (sidebar/inset/floating), sidebar collapsible (icon/offcanvas), content layout (centered/full-width), navbar (sticky/scroll). Stored per browser (localStorage), applied as `data-*` on `<html>` by a boot script injected from the same registry before first paint.
- Layout controls popover in the header; presets: Razpi (default), plus a few alternatives.
- Responsive guard: Playwright checks no horizontal overflow on key pages at 375/768/1280/1920 px and across all layout preference combinations.

## Out of scope

- Syncing preferences to the user profile in the database (later); font choice (Be Vietnam Pro stays for Vietnamese diacritics).

## Acceptance criteria

- [x] Sidebar collapses to icons / off-canvas, opens as a sheet on mobile, remembers its state.
- [x] Every preference applies instantly, survives reload without a flash, and has vi/en labels.
- [x] No horizontal overflow on bots list, bot space, FAQ, settings, admin at 4 viewports; layout combinations tested.
- [x] `pnpm check` green; Lighthouse /login 90/100/100; initial bundle 187 KB gzip.

## Plan

Found the template behind the owner's example (Studio Admin, MIT) → shadcn `sidebar` via CLI → port the preference registry/boot script/layout controls to the SPA (localStorage instead of cookies/SSR) → shell + bot-space dock → Playwright responsive guard → docs and notices.

## Log

Dated entries, newest last. Decisions, blockers, questions, what was verified and how.

- 2026-10-24 — created.

- 2026-10-24 — the owner's example (jiwoochris/artex-global, web/) is built on Studio Admin (arhamkhnz/next-shadcn-admin-dashboard, MIT, Next.js). Kept the Vite SPA (ADR-009) and ported the layout model; attribution in apps/web/THIRD_PARTY_NOTICES.md.
- 2026-10-24 — bugs caught while building: Tooltip outside TooltipProvider (shell now provides it), missing nav landmark (restored), boot script before <meta charset> (moved; best practices back to 100).
- 2026-10-24 — done. Verified: `pnpm check`; Vitest 10; Playwright 10 (6 new responsive/preferences tests); Lighthouse /login 90/100/100; manual screenshots of sidebar/inset/floating, dark, ocean, collapsed, mobile sheet.

## Links

- Docs: …
- Related tasks: …
