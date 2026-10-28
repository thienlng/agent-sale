---
id: T-125
title: Count bot home statistics by the answering bot instead of its current pages
status: backlog            # backlog | next | in-progress | blocked | review | done | cancelled
type: feature              # feature | bug | chore | spike | docs
priority: P1               # P0 | P1 | P2 | P3
owner:                     # @github-handle or @agent:<tool>
feature_ids: []            # e.g. [BOT-07, CRM-11] from docs/02-functional-requirements.md
created: 2026-10-29
updated: 2026-10-29
branch:
pr:
parent:                    # T-xxx if this is a sub-task
---

## Context

The bot home statistics (T-113) count a bot as the pages currently bound to it, so they reuse the statistics page's page filter and show the same numbers there. Since ADR-012 landed (PR #82), analytics facts carry the bot at event time and `POST /analytics/query` accepts `botIds` on conversation metrics. With the page filter, a page moved to another bot takes its history with it; with `botIds` the history stays with the bot that answered. Raised as a follow-up in PR #79.

## Goal

The bot home statistics count the conversations that bot answered, and the link to the statistics page opens the same scope.

## Scope

- In scope: switch `BotStatistics` to `botIds`; a bot filter (or a bot-scoped view) on the statistics page so the "open in statistics" link keeps showing the same numbers; the empty state for a bot without pages but with history.

## Out of scope

- Customer metrics by bot (the API rejects `botIds` for them: `scope_not_supported`).

## Acceptance criteria

- [ ] After a page moves from bot A to bot B, bot A's home still counts the conversations it answered and bot B's does not
- [ ] The "open in statistics" link shows the same figures as the bot home
- [ ] Tests added/updated and `pnpm check` green
- [ ] Docs updated (or "no docs impact" stated)

## Plan

Written by the implementer before coding (see `start-task` skill). Steps, files, tests, migration/docs/i18n impact, risks.

1. …

## Log

Dated entries, newest last. Decisions, blockers, questions, what was verified and how.

- 2026-10-29 — created.

## Links

- Docs: `docs/analytics.md` (bot attribution, "Bot home statistics"), ADR-012 §4
- Related tasks: T-113, T-078
