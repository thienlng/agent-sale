---
id: T-132
title: Filter the inbox by bot and activity time and drop saved filters
status: in-progress
type: feature
priority: P1
owner: '@agent:claude'
feature_ids: []
created: 2026-10-29
updated: 2026-10-29
branch: feat/inbox-bot-time-filters
pr:
parent:
---

## Context

Owner feedback (2026-10-29, chat with screenshots): the inbox filter popover is close to Facebook's and fine, but the "saved filters" bookmark button (local saved views) is pointless. Preny's filter panel shows that sales teams mostly filter by **bot** and by **time**; neither exists in Rapiz's inbox. The owner asked for a QA review of the change.

`conversations.bot_id` (the bot answering the conversation now, ADR-012 §4) landed with T-078, and `updated_at` (last activity, the list sort key) is an indexed column, so both filters can run on the server without a migration.

T-087 (shop/bot/channel scope across shops) stays blocked on the shop model; this task only adds the current-bot filter inside one business.

## Goal

Sales staff can narrow the inbox to one bot and to a last-activity window, and the saved-filters control is gone.

## Scope

- `GET /conversations` accepts `botId` (`none` or a bot id) and `updatedFrom` / `updatedTo` (ISO instants, `from` inclusive, `to` exclusive); the SQL store and the in-memory reference filter agree; counts use the same conditions.
- Web filter popover gains "Bot" and "Thời gian" groups (first in the list): all bots / one bot / no bot; any time / today / yesterday / last 7 days / last 30 days / custom date range. Chips and the active-filter count include them.
- Remove the saved inbox views button, hook and tests.
- vi/en strings, API docs.

## Out of scope

- Preny's other groups (source, sale ratio, last tag, notes), shop-level scope (T-087), filter persistence in the URL.
- Historical bot attribution per message: the filter uses the conversation's current bot.

## Acceptance criteria

- [ ] Choosing a bot lists only conversations whose current bot is that bot; "no bot" lists those without one; counts match the list.
- [ ] Time presets and a custom range list only conversations whose last activity falls in the window (local day boundaries); an inverted range is rejected by the API and cannot be applied in the UI.
- [ ] The saved-filters control and its storage code are gone; nothing else references them.
- [ ] Unit tests (domain filter, contract, web list state and popover) and the store integration test cover the new filters; `pnpm check` green.
- [ ] Independent QA review done and its findings resolved.
- [ ] Docs updated (inbox API filters).

## Plan

1. Contracts: extend `ConversationListQuery` with `botId`, `updatedFrom`, `updatedTo` and an order refinement; schema tests.
2. Backend: `ConversationFilter` + `toListFilter` + `matchesFilter`; SQL `baseConditions` (`bot_id`, `updated_at` range); domain spec and store integration spec cases.
3. Web: `ListState` gets `botId` and `time` (`{ preset }` or custom `{ from, to }` dates); `toListQuery` turns presets into day-aligned instants so the query key is stable; chips, count, `guardList`; popover groups using a new `useInboxBots` hook; remove saved views.
4. i18n vi/en; docs; QA review by a fresh agent; `pnpm check`.

## Log

- 2026-10-29 — created from owner feedback; branch from `origin/main` a354c32 in a temporary worktree.
- 2026-10-29 — Contract red→green (inverted/empty window, local timestamps, unknown bot values rejected). Backend: domain filter + SQL (`bot_id`, `updated_at` range); `inbox-v2.spec` 58/58; store integration (Testcontainers Postgres) 11/11, including SQL-vs-reference for `botId` none/unknown/real bot and time windows. Web: list state red→green (19/19), popover/chips/page tests; conversation feature 224/224. Saved views removed (component, hook, tests, i18n keys, e2e, screenshot); docs 18 / meta-inbox / BA doc record the owner's decision. Production-build e2e `inbox-sales.spec.ts` 11/11 with a new bot+yesterday case asserting the server query.

## Links

- Docs: docs/meta-inbox.md, ADR-012 §4
- Related tasks: T-087 (shop scope, blocked), T-078 (bot attribution)
