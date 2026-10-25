---
id: T-074
title: Delete a bot and open its settings from the bot list
status: in-progress            # backlog | next | in-progress | blocked | review | done | cancelled
type: feature              # feature | bug | chore | spike | docs
priority: P1               # P0 | P1 | P2 | P3
owner: '@agent:claude'     # @github-handle or @agent:<tool>
feature_ids: []            # e.g. [BOT-07, CRM-11] from docs/02-functional-requirements.md
created: 2026-10-25
updated: 2026-10-25
branch: feat/T-074-bot-delete-and-settings
pr:
parent:                    # T-xxx if this is a sub-task
---

## Context

Product owner request: on the bot list (where a bot is created) add a way to delete a bot and a direct settings shortcut. Today a bot cannot be removed and settings take two clicks.

## Goal

Let bots.manage users delete a bot (soft) and open `/app/bots/$botId/settings` straight from the bot list.

## Scope

- In scope: `DELETE /bots/{botId}` (204, soft delete via `deleted_at`, `is_active=false`, `bot.deleted` audit event, channel pages unbound); bot list gear link + delete action with an AlertDialog (type-the-name when active or connected); i18n vi/en; tests; docs.

## Out of scope

- Restore/undelete UI, purging data, deleting conversations or training rows.

## Out of scope

- …

## Acceptance criteria

- [ ] Deleted bot is 404 on get/readiness/faqs/training/playground and absent from list
- [ ] Pages bound to the bot are unbound (conversations fall back to staff)
- [ ] Only bots.manage may delete; other workspace gets 404
- [ ] Bot list shows a settings link and a delete action only for bots.manage
- [ ] Tests added and `pnpm check` green
- [ ] Docs updated

## Plan

1. Backend: repository `softDelete` (+ audit in same tx), `BotService.remove`, controller route, `BotLifecycle` hook (channel is above bot in the module graph, so channel registers an unbind handler instead of bot importing it), `ChannelFacade.unbindBot`.
2. Contracts route + rebuild.
3. Web: `useDeleteBot`, `DeleteBotDialog`, gear link in `bot-list.tsx`, i18n.
4. Tests (service, HTTP, channel, web), docs (bot/channel MODULE.md, docs).

## Log

Dated entries, newest last. Decisions, blockers, questions, what was verified and how.

- 2026-10-25 — created (script allocated T-068; renamed to T-074).
- 2026-10-25 — decisions: `channel` sits above `bot` in the module graph, so bot cannot call ChannelFacade; added `BOT_LIFECYCLE` hook (channel registers `unbindBot`, run before the soft delete). Audit via `writeAudit` (`bot.deleted`) in the delete transaction. The delete UI lives on the bot list only, so no "navigate away" is needed.
- 2026-10-25 — verified: `pnpm check` green (lint, arch, typecheck, tests, build, bundle 242.7/250 KB); backend unit + HTTP tests; Postgres integration test (403 for sales, 404 cross-tenant/after delete, channel unbound, audit row) run with `vitest.integration.config.ts`; web tests in `bot-list.test.tsx`.

## Links

- Docs: …
- Related tasks: …
