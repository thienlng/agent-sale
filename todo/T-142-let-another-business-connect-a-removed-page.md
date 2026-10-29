---
id: T-142
title: Let another business connect a removed page
status: review
type: feature
priority: P1
owner: '@agent:claude'
feature_ids: []
created: 2026-10-29
updated: 2026-10-29
branch: feat/T-142-page-reconnect
pr:
parent: T-133
---

## Context

T-133 soft-removes a page, but `unique(provider, external_id)` still ties it to the old business, so another business gets "connected to another workspace". Spec: docs/superpowers/specs/2026-10-29-bot-training-redesign-design.md section 7.

## Goal

A page removed in business A can be connected in business B as a new row; A keeps its removed row and history.

## Scope

- In scope: migration 0034 (partial unique index on live rows), Drizzle schema, store upsert/revive, live-row-only lookups (webhook ingress, website lookup), tests, docs.

## Out of scope

- Purging stale OAuth flows, hard deletes, UI changes.

## Acceptance criteria

- [x] Connect in A, remove in A, connect in B gives a new connected row in B; A's row stays removed with its id.
- [x] Reconnecting in A while A's row is removed and no live row exists elsewhere reuses A's row.
- [x] A live row in another workspace still blocks; two live rows for one page are impossible in the database.
- [x] Webhook ingress resolves the live row only.
- [x] Tests added; docs updated.

## Plan

1. Failing integration tests. 2. Migration 0034 + schema. 3. Store: revive own removed row (savepoint), upsert targeting the partial index. 4. Docs.

## Log

- 2026-10-29 — created. RED: two new store tests failed with the old constraint. GREEN after implementation (store integration 15/15, ingress integration 5/5).
- Migration is backward compatible: the old constraint guaranteed at most one row per (provider, external_id), so the partial unique index cannot fail to build.
- 2026-10-29 — Final fix wave: migration 0034 uses DROP CONSTRAINT IF EXISTS; deploy order documented (run migration 0034 before starting the new API; old instances fail page connects after the constraint drop) in docs/meta-inbox.md.

## Links

- Docs: docs/meta-inbox.md (Connection lifecycle)
- Related tasks: T-133, T-049
