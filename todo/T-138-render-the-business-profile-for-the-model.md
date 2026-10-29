---
id: T-138
title: Render the business profile and reply style for the model; prompt sales-agent@9
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

Second task of the bot-training redesign (docs/superpowers/specs/2026-10-29-bot-training-redesign-design.md, section 5): the model must read the structured profile and the reply style.

## Goal

Prompt `sales-agent@9` and the `<business_profile>` block, behind a `promptVersion` option that defaults to 8.

## Scope

- In scope: `renderBusinessProfile`, `replyStyle`, `sales-agent@9.md`, wiring in `PlaygroundService`, tests, ai MODULE.md.

## Out of scope

- Switching the default to @9 (Task 7), UI, backfill.

## Acceptance criteria

- [x] `<business_profile>` rendered in catalog order, `(not provided)` for empty values, `<` escaped
- [x] `reply-style` maps length, tone, emoji and creativity to fixed sentences
- [x] @9 prompt added; @8 request is byte-identical (snapshot test)
- [x] Shop name precedence displayName > store.name > workspace name under @9
- [x] Tests added; focused tests, typecheck and lint green
- [x] Docs updated

## Plan

1. Unit tests, then the two domain modules. 2. Prompt @9. 3. `promptVersion` option and blocks. 4. Snapshot of the @8 request taken before the change.

## Log

- 2026-10-29 — created; implemented. Prompt evals (Rule 05) not run here; @9 is not the default yet.
- 2026-10-29 — Final fix wave: the FAQ table badge for an FAQ with unfilled placeholders now reads "Bot không dùng câu này — hãy sửa câu trả lời"; the profile history view renders one line per changed key; personality card uses functional setState.

## Links

- Docs: docs/superpowers/specs/2026-10-29-bot-training-redesign-design.md
- Related tasks: T-137
