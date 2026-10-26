---
id: T-066
title: Fix flaky MetaInboxProcessor test: reply arriving while the previous one is generated
status: backlog            # backlog | next | in-progress | blocked | review | done | cancelled
type: bug                  # feature | bug | chore | spike | docs
priority: P1               # P0 | P1 | P2 | P3
owner:                     # @github-handle or @agent:<tool>
feature_ids: []            # e.g. [BOT-07, CRM-11] from docs/02-functional-requirements.md
created: 2026-10-24
updated: 2026-10-24
branch:
pr:
parent:                    # T-xxx if this is a sub-task
---

## Context

`meta-inbox.processor.spec.ts` "answers a message that arrived while the previous reply was being generated" fails about one run in three on `main` (`channels.deliver` called once instead of twice), also without any change on top of main. Found while running `pnpm check` for T-065.

## Goal

The test passes deterministically (no timing dependence).

## Scope

- In scope: …

## Out of scope

- …

## Acceptance criteria

- [ ] Verifiable statement 1
- [ ] Verifiable statement 2
- [ ] Tests added/updated and `pnpm check` green
- [ ] Docs updated (or "no docs impact" stated)

## Plan

Written by the implementer before coding (see `start-task` skill). Steps, files, tests, migration/docs/i18n impact, risks.

1. …

## Log

Dated entries, newest last. Decisions, blockers, questions, what was verified and how.

- 2026-10-24 — created.

## Links

- Docs: …
- Related tasks: …
