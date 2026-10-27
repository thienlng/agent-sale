---
id: T-116
title: Select bot products from the shared catalog and sync new ones back
status: blocked            # backlog | next | in-progress | blocked | review | done | cancelled
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

Today a bot's Products page lists the whole workspace catalog ("dùng chung cho tất cả Bot"). The review asks that each bot **selects** products from the global catalog, and that a product created from inside a bot is added to the global catalog automatically. This needs a bot–product association (schema + migration) and depends on how lane A scopes products to business/shop in T-077/T-080. Decision 2026-10-27 (user): implement after T-080.

Source: cofounder walkthrough in chat on 2026-10-26 (lane B, see [handoff](../docs/handoffs/2026-10-26-cofounder-review-plan.md)). Lane B owner: @agent:claude (assigned by the user on 2026-10-27); lane A belongs to the cofounder.

## Goal

Each bot sells an explicit subset of the shared catalog, and both product screens stay in sync.

## Scope

- Bot–product association owned by the bot module (via the commerce service interface, not its tables), workspace-scoped with RLS.
- Bot Products page: pick/unpick from the global catalog; "create product" creates it globally and selects it for the bot.
- Bot retrieval and product tools use only the bot's selected products; define the default for existing bots (backfill = all current products, so behaviour does not change).

## Out of scope

- Per-shop pricing/inventory; the shop model itself (T-080).

## Acceptance criteria

- [ ] Selecting/unselecting in the bot is reflected on the global Products screen and vice versa, also after reload.
- [ ] A bot only answers about its selected products; existing bots keep answering about all current products after migration.
- [ ] Backward-compatible migration; cross-tenant 404 tests; AI evals run for the retrieval change; `pnpm check` green.
- [ ] Docs (data model, AI engine) and vi/en strings updated.

## Plan

Written by the implementer before coding (see `start-task` skill).

1. …

## Log

- 2026-10-27 — created from the review. Blocked on lane A T-077/T-080 product scoping.

## Links

- [Review milestone handoff](../docs/handoffs/2026-10-26-cofounder-review-plan.md)
- [Architecture](../docs/ARCHITECTURE.md)
- [Data model](../docs/05-data-model.md)
- Related tasks: T-080, T-112
