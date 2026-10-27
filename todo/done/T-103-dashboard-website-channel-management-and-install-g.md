---
id: T-103
title: Dashboard: website channel management and install guide
status: done
type: feature
priority: P1
owner: @agent:claude
feature_ids: [CHN-05]
created: 2026-10-27
updated: 2026-10-27
branch: feat/T-097-website-chat-channel
pr: direct merge to main (owner-approved, 2026-10-27)
parent: T-097
---

## Context

Staff must create and manage websites and copy the embed code from the integrations page. Spec: `docs/superpowers/specs/2026-10-27-website-chat-channel-design.md`. Plan (Task 7): `docs/superpowers/plans/2026-10-27-website-chat-channel.md`.

## Goal

Enable the Website card with creation, settings, live preview, embed code and an install guide.

## Scope

- In scope: Add website dialog, settings panel, embed code, preview
- In scope: Install guide for common site builders
- In scope: vi and en strings

## Out of scope

- Loading the real widget in the preview

## Acceptance criteria

- [x] Website card enabled and domain input validated
- [x] Embed code renders the site key
- [x] Settings save sends only changed fields
- [x] pnpm check green
- [x] Docs updated (or "no docs impact" stated)

## Plan

See the plan section (Task 7) linked above.

## Log

- 2026-10-27 — created.
- 2026-10-27 — implemented in worktree branch `feat/T-103-website-dashboard`: Website platform enabled, add-website dialog (Hostname-validated domains), website card (copy embed code, install guide, settings, on/off, disconnect), settings panel with static live preview and minimal PATCH, install guide for 8 platforms, `VITE_WIDGET_URL` env (documented in apps/web/README.md), vi/en strings. Verified: web tests, typecheck, lint, pnpm check.
- 2026-10-27: T-104 verification pass, set to review: dashboard unit tests plus the T-104 e2e (create website, embed code, settings PATCH). `pnpm check` exit 0.
- 2026-10-27: merged into `main` (squash, owner-approved direct merge); status done.

## Links

- Spec: `docs/superpowers/specs/2026-10-27-website-chat-channel-design.md`
- Plan: `docs/superpowers/plans/2026-10-27-website-chat-channel.md`
- Docs: `docs/adr/ADR-011-website-widget-shadow-dom-and-polling.md`, `docs/07-channel-integrations.md` section 5
- Related tasks: T-097..T-104
