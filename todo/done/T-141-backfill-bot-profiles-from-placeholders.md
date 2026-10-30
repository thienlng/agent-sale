---
id: T-141
title: Backfill bot profiles from placeholders and drop untouched seed content
status: done
type: chore
priority: P1
owner: @agent:claude
feature_ids: []
created: 2026-10-29
updated: 2026-10-29
branch: feat/T-137-bot-profile
pr: main c0507f4
parent: T-137
---

## Context

Fifth task of the bot-training redesign (docs/superpowers/specs/2026-10-29-bot-training-redesign-design.md, section 6): existing bots keep facts in `settings.placeholders`, seeded FAQs and seeded style rules.

## Goal

An idempotent CLI with `--dry-run` moves that data into the structured profile and removes only untouched seed content.

## Scope

- In scope: `backfillBotProfiles` in packages/db, CLI `bot-profile-backfill`, integration test, runbook.

## Out of scope

- Removing `settings.placeholders` (kept read-only for one release); running it on the dev database (controller dry run).

## Acceptance criteria

- [x] Placeholders copied to empty profile fields only; non-empty values never overwritten
- [x] Only FAQs and style rules exactly equal to the legacy seed are deleted; edited and user items kept
- [x] Deleted length rule sets `replyLength: 'short'` when the bot has none
- [x] Dry run changes nothing; second run reports no changes; one transaction per bot; workspace scoped
- [x] Integration test green; docs updated

## Plan

Frozen legacy copies inside packages/db (it must not import apps/backend); follow `account-backfill`.

## Log

- 2026-10-29 — created; implemented with a Testcontainers integration test.
- 2026-10-29 — Final fix wave: backfill skips (and reports as fieldsSkippedTooLong) placeholder values longer than the target field limit; docs state that kept placeholder FAQs stop following profile edits and that the backfill writes no history entries.

- 2026-10-29 — Landed on main c0507f4 after independent review and the branch gate (pnpm check green; load-induced timeouts in untouched suites passed when rerun alone). Closed.

## Links

- Docs: docs/training-workspace.md
- Related tasks: T-137, T-140
