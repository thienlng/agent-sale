---
id: T-099
title: Website connections: settings, site key and management API
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

A website is a channel_connections row with provider website. It needs a settings column, a generated site key and signing secret, and a management API. Spec: `docs/superpowers/specs/2026-10-27-website-chat-channel-design.md`. Plan (Task 3): `docs/superpowers/plans/2026-10-27-website-chat-channel.md`.

## Goal

Let a workspace create, update and disable website connections through the channel facade and API.

## Scope

- In scope: Nullable settings jsonb column (additive migration)
- In scope: WebsiteSettings contract (Zod)
- In scope: Site key wk_ + 22 base62 and sealed per-site HMAC secret
- In scope: Channel facade and controller CRUD

## Out of scope

- Public widget traffic (T-100)
- Dashboard UI (T-103)

## Acceptance criteria

- [x] Create/update/disable website works through the API with validation
- [x] Site key and secret generation covered by unit tests
- [x] Migration is additive and docs/05 updated
- [x] pnpm check green
- [x] Docs updated (or "no docs impact" stated)

## Plan

See the plan section (Task 3) linked above.

## Log

- 2026-10-27 — created.
- 2026-10-27 — implemented contracts (WebsiteSettings, routes, `disabled` status), `settings` column (migration 0025), site key and visitor signing helpers, facade/store/controller methods; verified with unit, contract and integration specs.
- 2026-10-27: T-104 verification pass, set to review: website connections API covered by unit and integration tests. `pnpm check` exit 0.
- 2026-10-27: merged into `main` (squash, owner-approved direct merge); status done.

## Links

- Spec: `docs/superpowers/specs/2026-10-27-website-chat-channel-design.md`
- Plan: `docs/superpowers/plans/2026-10-27-website-chat-channel.md`
- Docs: `docs/adr/ADR-011-website-widget-shadow-dom-and-polling.md`, `docs/07-channel-integrations.md` section 5
- Related tasks: T-097..T-104
- 2026-10-27: post-QA fix: UpdateWebsiteRequest is strict (unknown keys answer 400 VALIDATION_FAILED); contract and integration tests added; dashboard diffSettings only emits known keys.
