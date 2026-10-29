---
id: T-152
title: Show the business logo in the business selector
status: done
type: feature
priority: P2
owner: '@agent:claude'
feature_ids: [ADM-02]
created: 2026-10-29
updated: 2026-10-29
branch: feat/T-152-business-logo-in-selector
pr: main
parent:
---

## Context

Owner request (2026-10-29, screenshot of the sidebar): "Để logo nếu người dùng setup logo nhé" — the business selector ("Đang quản lý …") always shows a generic building icon even when the business has uploaded a logo in Settings → Business (T-056).

## Goal

The selector shows the current business's logo when one is set; the building icon otherwise.

## Scope

- Web: a `BusinessLogo` component in `features/workspace` (profile query + authorised logo blob, same cache as the settings page so an upload or removal shows at once), passed by `routes/app.tsx` through `AppShell` → `AppSidebar` → `BusinessSelector` (shared components may not import features).

## Out of scope

- Logos of the other businesses in the selector list (the logo route is scoped to the current business); the Rapiz brand mark at the top and the browser favicon stay.

## Acceptance criteria

- [x] With a logo, the selector trigger shows it (decorative, the name is next to it); without one, the building icon.
- [x] Unit tests for `BusinessLogo` and for the selector slot; workspace and layout tests, web typecheck, eslint, `pnpm arch` and web build pass.

## Plan

1. `BusinessLogo` + tests. 2. `businessLogo` slot on the selector, sidebar and shell; the route composes it.

## Log

- 2026-10-29 — Done on main.
