---
id: T-113
title: Show per-bot statistics on the bot training home
status: backlog            # backlog | next | in-progress | blocked | review | done | cancelled
type: feature              # feature | bug | chore | spike | docs
priority: P1               # P0 | P1 | P2 | P3
owner: "@agent:claude"     # @github-handle or @agent:<tool>
feature_ids: []            # e.g. [BOT-07, CRM-11] from docs/02-functional-requirements.md
created: 2026-10-27
updated: 2026-10-27
branch:
pr:
parent:                    # T-xxx if this is a sub-task
---

## Context

The bot home (`/app/bots/$botId`) shows only the setup guide. The review asks for statistics on each bot's training page. The analytics contracts (`packages/contracts/src/analytics`) have no bot dimension today, so this needs a backend filter, not only UI.

Source: cofounder walkthrough in chat on 2026-10-26 (lane B, see [handoff](../docs/handoffs/2026-10-26-cofounder-review-plan.md)). Lane B owner: @agent:claude (assigned by the user on 2026-10-27); lane A belongs to the cofounder.

## Goal

Each bot's home shows its own key metrics, computed by the existing analytics definitions filtered to that bot.

## Scope

- Add an optional bot filter to the existing analytics queries/projections where the source events carry the bot (reuse T-039–T-041 definitions; no new KPI without approval).
- Show a compact KPI block (e.g. conversations handled, AI replies, handoffs, orders attributed) with period selector and link to the full statistics page pre-filtered by the bot.
- Keep the setup guide for bots that are not set up yet; empty/loading/error states.

## Out of scope

- Portfolio/business statistics redesign (T-081); billable usage (T-091/T-092).

## Acceptance criteria

- [ ] Bot figures reconcile with the workspace statistics filtered to the same bot and period.
- [ ] The bot filter is workspace-scoped: a bot ID from another workspace returns 404; permission checks match the statistics page.
- [ ] Backend tests (happy path, validation, permission, cross-tenant) and UI tests; `pnpm check` green.
- [ ] vi/en strings; analytics docs list the new filter.

## Plan

Written by the implementer before coding (see `start-task` skill).

1. …

## Log

- 2026-10-27 — created from the review ("vào trang đào tạo bot của mỗi bot thì phải có thống kê").

## Links

- [Review milestone handoff](../docs/handoffs/2026-10-26-cofounder-review-plan.md)
- [Architecture](../docs/ARCHITECTURE.md)
- Related tasks: T-039, T-040, T-041, T-081
