---
id: T-137
title: Store a structured business profile and reply style per bot
status: done
type: feature
priority: P1
owner: @agent:claude
feature_ids: []
created: 2026-10-29
updated: 2026-10-29
branch: feat/T-137-bot-profile
pr: main c0507f4
parent:
---

## Context

First task of the bot-training redesign (docs/superpowers/specs/2026-10-29-bot-training-redesign-design.md, sections 2 and 5): facts about the business move from `{{placeholders}}` and seeded FAQs into a structured profile, and reply style becomes explicit settings.

## Goal

Each bot stores a structured, industry-aware business profile plus reply length, tone and emoji settings, readable by other modules through `BotView`.

## Scope

- In scope: contracts (`profile.ts`, `BotSettings`, `UpdateBotRequest`), backend domain/defaults/`BotView`, tests, MODULE.md and docs.

## Out of scope

- Prompt changes, UI, backfill of existing data (later tasks).

## Acceptance criteria

- [x] `PROFILE_FIELDS`, `profileFieldsFor`, `BotProfile`, `PROFILE_NOTES_MAX` exported from contracts
- [x] `BotSettings` and `BotView` carry `profile`, `replyLength`, `tone`, `allowEmoji`; old rows read back with defaults
- [x] A partial update never resets other fields; `profile` is replaced as sent
- [x] Tests added; focused tests, typecheck and lint green
- [x] Docs updated

## Plan

1. Contracts + tests. 2. Backend mirror, defaults, `BotView`. 3. Specs. 4. Docs.

## Log

- 2026-10-29 — created and implemented.
- 2026-10-29 — Final fix wave: Industry enum moved to its own module (breaks the contracts import cycle); new bots seed placeholder-free greetings and FAQs; the readiness FAQ check counts only answerable FAQs; restoring a profile history entry restores only the keys (and notes) that entry changed.

- 2026-10-29 — Landed on main c0507f4 after independent review and the branch gate (pnpm check green; load-induced timeouts in untouched suites passed when rerun alone). Closed.

## Links

- Docs: docs/training-workspace.md, apps/backend/src/modules/bot/MODULE.md
