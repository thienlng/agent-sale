---
id: T-101
title: Embeddable website chat widget
status: done
type: feature
priority: P1
owner: @agent:claude
feature_ids: [CHN-05]
created: 2026-10-27
updated: 2026-10-27
branch: feat/T-101-widget
pr: direct merge to main (owner-approved, 2026-10-27)
parent: T-097
---

## Context

Shops paste one script tag; the widget must be isolated from host CSS (Shadow DOM) and small enough for any site. Spec: `docs/superpowers/specs/2026-10-27-website-chat-channel-design.md`. Plan (Task 5): `docs/superpowers/plans/2026-10-27-website-chat-channel.md`.

## Goal

Build apps/widget: a plain TypeScript Shadow DOM chat bundle that polls the public API.

## Scope

- In scope: Bubble, panel, polling cadence, images, mobile handling
- In scope: ES2017 output and at most 20 KB gzip enforced in CI
- In scope: Defensive storage and double-inclusion guard

## Out of scope

- Lead capture UI beyond the prepared hooks (T-102)
- Proactive invites, SSE, attribution (later specs)

## Acceptance criteria

- [x] State machine and polling cadence unit tested
- [x] Bundle at most 20 KB gzip and passes es-check es2017
- [x] No zod in the bundle
- [x] pnpm check green
- [x] Docs updated (or "no docs impact" stated)

## Plan

See the plan section (Task 5) linked above.

## Log

- 2026-10-27 — created.
- 2026-10-27 — apps/widget implemented (state machine, poller, api, Shadow DOM view, phone chip, image upload); vitest 31 tests green, bundle 8.7 KB gzip, es-check es2017 passes, no zod.
- 2026-10-27 — review fix round 1: silent history restore, phone error mapping, token-gated phone chip, incremental message list, Escape/focus, await timeout, extra behaviour tests (31 green).
- 2026-10-27: T-104 verification pass, set to review: widget unit tests, es-check es2017 and the 20 KB gzip budget pass in the widget build; widget runs in a real browser in the T-104 e2e. `pnpm check` exit 0.
- 2026-10-27: merged into `main` (squash, owner-approved direct merge); status done.

## Links

- Spec: `docs/superpowers/specs/2026-10-27-website-chat-channel-design.md`
- Plan: `docs/superpowers/plans/2026-10-27-website-chat-channel.md`
- Docs: `docs/adr/ADR-011-website-widget-shadow-dom-and-polling.md`, `docs/07-channel-integrations.md` section 5
- Related tasks: T-097..T-104
