---
id: T-067
title: Stop auto-collapsing the app sidebar inside the bot space
status: in-progress            # backlog | next | in-progress | blocked | review | done | cancelled
type: bug              # feature | bug | chore | spike | docs
priority: P1               # P0 | P1 | P2 | P3
owner: @agent:claude
feature_ids: []            # e.g. [BOT-07, CRM-11] from docs/02-functional-requirements.md
created: 2026-10-24
updated: 2026-10-24
branch: feat/T-065-admin-llm-discover-models
pr:
parent:                    # T-xxx if this is a sub-task
---

## Context

Opening a bot (for example right after creating one) shrank the app sidebar to its icon rail on its own (`useCollapsedAppSidebar`, added in T-045). The maintainer finds it annoying: "tự thu gọn sidebar ... khá khó chịu".

## Goal

The sidebar keeps the state the user chose when they open a bot.

## Scope

- In scope: …

## Out of scope

- …

## Acceptance criteria

- [x] Opening a bot never changes the sidebar open/closed state.
- [x] The user's saved sidebar choice (cookie) is untouched.
- [x] `pnpm check` green (no behavior left to test: the effect is removed)
- [x] No docs impact.

## Plan

Written by the implementer before coding (see `start-task` skill). Steps, files, tests, migration/docs/i18n impact, risks.

1. Delete `use-collapsed-app-sidebar.ts` and its call in the bot space route; fix the route comment.

## Log

Dated entries, newest last. Decisions, blockers, questions, what was verified and how.

- 2026-10-24 — created.

## Links

- Docs: …
- Related tasks: …
