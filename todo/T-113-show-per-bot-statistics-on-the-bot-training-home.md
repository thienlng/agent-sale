---
id: T-113
title: Show per-bot statistics on the bot training home
status: in-progress            # backlog | next | in-progress | blocked | review | done | cancelled
type: feature              # feature | bug | chore | spike | docs
priority: P1               # P0 | P1 | P2 | P3
owner: "@agent:claude"     # @github-handle or @agent:<tool>
feature_ids: []            # e.g. [BOT-07, CRM-11] from docs/02-functional-requirements.md
created: 2026-10-27
updated: 2026-10-28
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

- Scope the existing analytics queries to the bot through the pages (channels) assigned to it, using the page filter the statistics page already has (reuse T-039–T-041 definitions; no new KPI without approval). Only page-attributed metrics qualify: new conversations, inbound and outbound messages.
- Show a compact KPI block with a period selector and a link to the full statistics page pre-filtered by the same pages and period.
- Keep the setup guide for bots that are not set up yet; empty/loading/error states.

## Out of scope

- Portfolio/business statistics redesign (T-081); billable usage (T-091/T-092).

## Acceptance criteria

- [x] Bot figures reconcile with the workspace statistics filtered to the same pages and period (same query, same definitions).
- [x] Workspace-scoped: the bot page already 404s for a bot of another workspace, analytics only reads the current workspace's facts; the block follows `analytics.view` like the statistics page.
- [x] A bot without pages shows an explicit "no channel" state, never workspace-wide numbers; loading/error/locked states as on the statistics page.
- [x] UI tests (figures, period, link, no-channel, permission); `pnpm check` green.
- [x] vi/en strings; analytics docs describe the bot view.

## Plan

Design change from the original scope: no backend `botId` filter. docs/ARCHITECTURE.md says analytics "reads event-fed read models, not facade chains", and facts carry the page (`channelId`), not the bot. Resolving bot → pages in analytics would chain the bot/channel facades. The web route already composes features, so it resolves the bot's pages from `/channels` and the analytics feature queries with the existing `pageIds` filter. Same numbers by construction; nothing new to secure server-side.

1. `features/analytics/components/bot-statistics.test.tsx` (failing first): queries the conversation metrics with the bot's `pageIds` and the chosen period; renders the three cards; 30-day switch re-queries; link to `/app/analytics?pages=…&from=…`; no pages → "no channel" state and no query; no `analytics.view` → nothing.
2. `bot-statistics.tsx`: reuses `buildQueries`/`resolveFilters`, `useStatistics`, `useDefinitions` and `MetricCard`; 7/30-day toggle.
3. Route `bots/$botId/index.tsx`: pages = channels whose `botId` is this bot (any status, history stays attributed); render the block below the setup guide (its `h1` stays the first heading).
4. i18n vi/en `analytics.bot.*`; docs/analytics.md section on the bot view and its limit (attribution follows the current page→bot assignment).
5. Verify: targeted tests, `pnpm check`, e2e, responsive matrix.

Risk: moving a page to another bot moves its history with it (facts have no bot). Documented; a bot dimension in facts would be a separate task.

## Log

- 2026-10-27 — created from the review ("vào trang đào tạo bot của mỗi bot thì phải có thống kê").
- 2026-10-28 — implemented without a backend change: `BotStatistics` (analytics feature) queries the conversation metrics with the bot's pages, resolved in the bot home route from `/channels`. 7/30-day toggle, link to `/app/analytics` with the same pages and period, "no channel" state with no query, hidden without `analytics.view`. Placed below the setup guide rather than above so the guide's `h1` stays first. 4 UI tests; gate green (2 pre-existing max-lines warnings); e2e 49/49 (`website-chat` flaked once under load, passes on rerun). docs/analytics.md "Bot home statistics" documents the current-assignment limit.

## Links

- [Review milestone handoff](../docs/handoffs/2026-10-26-cofounder-review-plan.md)
- [Architecture](../docs/ARCHITECTURE.md)
- Related tasks: T-039, T-040, T-041, T-081
