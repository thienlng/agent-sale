---
id: T-139
title: Business profile form on the bot information page
status: done
type: feature
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

Third task of the bot-training redesign (docs/superpowers/specs/2026-10-29-bot-training-redesign-design.md, section 3): the owner edits the bot's business facts in one form.

## Goal

The "Thông tin doanh nghiệp" page shows the profile form (basic, industry, notes) above the FAQ table.

## Scope

- In scope: `BusinessProfileForm`, `features/knowledge/api/bot-profile.ts`, i18n (vi, en), e2e with a stateful bot mock, docs.

## Out of scope

- Reply guidance screen (Task 4), backfill, prompt default switch.

## Acceptance criteria

- [x] Basic and industry fields, completeness `x/y`, warning marker, notes counter `n / 3000`
- [x] Save sends only changed keys and changed notes; unsaved-changes guard; read-only without `bots.manage`
- [x] FAQ table heading renamed "Câu hỏi thường gặp khác"
- [x] Component tests and production-build e2e green; responsive knowledge cases green
- [x] Docs updated

## Plan

1. Component tests. 2. Hooks and form. 3. i18n. 4. e2e.

## Log

- 2026-10-29 — created; implemented. Layout: profile card (basic, industry, notes, Save) then the FAQ table.

- 2026-10-29 — Landed on main c0507f4 after independent review and the branch gate (pnpm check green; load-induced timeouts in untouched suites passed when rerun alone). Closed.

## Links

- Docs: docs/training-workspace.md
- Related tasks: T-137, T-138
