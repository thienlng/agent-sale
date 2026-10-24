---
id: T-048
title: Narrow app_system inbox uses to SECURITY DEFINER functions
status: backlog            # backlog | next | in-progress | blocked | review | done | cancelled
type: chore
priority: P1
owner:                     # @github-handle or @agent:<tool>
feature_ids: []            # e.g. [BOT-07, CRM-11] from docs/02-functional-requirements.md
created: 2026-10-24
updated: 2026-10-24
branch:
pr:
parent: T-045
---

## Context

PR #40 review (B3). The Meta inbox uses `app_system` through plain `withSystem` sessions in three places ADR-004 did not list: webhook ingress (connection lookup + event insert), the public OAuth callback (state consume) and the agent's inbox-queue claim/lease/complete/dead-letter. Accepted temporarily by the ADR-004 amendment of 2026-10-24.

## Goal

Each of those uses runs through a narrow `SECURITY DEFINER` function, and `app_system` gets `EXECUTE` on them instead of table-wide rights for these tables.

## Scope

- `resolve_channel(provider, external_id)` + event insert for `apps/webhook`
- `consume_oauth_state(provider, state_hash, browser_hash)`
- `claim_inbox_events(n)`, renew/complete/release/dead-letter functions fenced by claim token
- Migration that revokes the direct table grants for these paths; stores call the functions

## Out of scope

- Other `app_system` users (outbox, reconciliation)

## Acceptance criteria

- [ ] No `withSystem` query on `channel_*` tables outside the functions
- [ ] Integration tests (`channel.store.integration.spec.ts`, `meta-ingress.store.integration.spec.ts`) still green
- [ ] ADR-004 amendment marked resolved; `packages/db/README.md` updated
- [ ] Tests added/updated and `pnpm check` green
- [ ] Docs updated (or "no docs impact" stated)

## Plan

Written by the implementer before coding (see `start-task` skill). Steps, files, tests, migration/docs/i18n impact, risks.

1. …

## Log

Dated entries, newest last. Decisions, blockers, questions, what was verified and how.

- 2026-10-24 — created from the PR #40 review (maintainer session).

## Links

- Docs: …
- Related tasks: T-045, T-047 (PR #40)
