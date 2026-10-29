---
id: T-140
title: Split reply guidance into personality, situations and system rules
status: review
type: feature
priority: P1
owner: @agent:claude
feature_ids: []
created: 2026-10-29
updated: 2026-10-29
branch: feat/T-137-bot-profile
pr:
parent: T-137
---

## Context

Fourth task of the bot-training redesign (docs/superpowers/specs/2026-10-29-bot-training-redesign-design.md, section 4): the reply-guidance screen separates how the bot talks (personality) from what to do in each situation.

## Goal

"Hướng dẫn trả lời" shows a personality card, a "Tình huống" list ("Khi khách … → Bot sẽ …") with industry starters, and collapsed system rules; bot settings no longer duplicates mission, greeting, pronouns or store-info fields.

## Scope

- In scope: `PersonalityCard`, `useSaveBotSettings`, `rules-list.tsx`, `bot-settings-advanced.tsx`, `starterRulesFor(industry)` and seeding by industry, i18n (vi, en), tests, e2e, docs.

## Out of scope

- Backfill of legacy style rules (Task 5), prompt default switch.

## Acceptance criteria

- [x] Personality card saves only changed keys in one PATCH; unsaved-changes guard; read-only without `bots.manage`
- [x] Situations list rows read "Khi khách … → Bot sẽ …"; system rules collapsed by default
- [x] Settings page keeps technical items and links to the two owning screens
- [x] Style starters are no longer seeded; hotel bots get hotel situations
- [x] Component, backend and production-build e2e tests green
- [x] Docs updated

## Plan

1. Failing tests. 2. Backend starters by industry. 3. Personality card and rules list. 4. Settings cleanup. 5. i18n, e2e, docs.

## Log

- 2026-10-29 — created; implemented. `instruction-cards.tsx` removed.

## Links

- Docs: docs/training-workspace.md
- Related tasks: T-137, T-139
