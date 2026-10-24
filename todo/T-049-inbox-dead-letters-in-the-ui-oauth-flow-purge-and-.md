---
id: T-049
title: Inbox dead letters in the UI, OAuth flow purge and page release on disconnect
status: backlog            # backlog | next | in-progress | blocked | review | done | cancelled
type: feature
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

PR #40 review (M3, M4, B2 follow-up, N5). Exhausted inbound events are now dead-lettered (`failed_at`, migration 0013) and logged, but staff cannot see them; expired or consumed OAuth discoveries are never deleted; a disconnected page keeps its sealed token, stays subscribed at Meta, and blocks other workspaces from connecting it (`unique(provider, external_id)`).

## Goal

No customer message or credential is silently kept or lost: dead letters are visible and replayable, stale OAuth rows and tokens are purged, and a disconnected page can be connected again elsewhere.

## Scope

- Inbox UI/API: list and replay dead-lettered events per connection
- Scheduled purge of expired/consumed `channel_oauth_flows`
- Disconnect: clear `token_sealed`, unsubscribe the page at Meta
- Partial unique index `where status <> 'disconnected'` and reassignment of a disconnected row
- Optional: skip replies for events older than the 24 h window (N2)

## Out of scope

- Changing retry counts or backoff

## Acceptance criteria

- [ ] Dead letters listed + replay endpoint with permission and cross-tenant tests
- [ ] Purge job tested
- [ ] Disconnect clears the token; reconnect from another workspace works (integration test)
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
