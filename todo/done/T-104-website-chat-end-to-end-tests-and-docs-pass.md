---
id: T-104
title: Website chat end-to-end tests and docs pass
status: done
type: chore
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

The journey crosses widget, API, queue, inbox and CRM and needs one end-to-end proof plus current docs. Spec: `docs/superpowers/specs/2026-10-27-website-chat-channel-design.md`. Plan (Task 8): `docs/superpowers/plans/2026-10-27-website-chat-channel.md`.

## Goal

Prove the website chat journey end to end and bring the docs and module notes up to date.

## Scope

- In scope: Playwright journey: visitor, bot, staff takeover, phone, CRM and badge
- In scope: Docs pass (02, 03, 07, meta-inbox, MODULE.md files)
- In scope: Task logs and statuses

## Out of scope

- New features

## Acceptance criteria

- [x] E2E spec passes or its mock basis is stated
- [x] Docs and MODULE.md files are current
- [x] pnpm check green and integration specs run
- [x] Docs updated (or "no docs impact" stated)

## Plan

See the plan section (Task 8) linked above.

## Log

- 2026-10-27 — created.
- 2026-10-27: T-104 verification pass, set to review: e2e apps/web/e2e/website-chat.spec.ts (2 tests) pass against the vite preview; webchat integration suite (19 files, 138 tests) passes; pnpm check exit 0. `pnpm check` exit 0.
- 2026-10-27: merged into `main` (squash, owner-approved direct merge); status done.

## Links

- Spec: `docs/superpowers/specs/2026-10-27-website-chat-channel-design.md`
- Plan: `docs/superpowers/plans/2026-10-27-website-chat-channel.md`
- Docs: `docs/adr/ADR-011-website-widget-shadow-dom-and-polling.md`, `docs/07-channel-integrations.md` section 5
- Related tasks: T-097..T-104
