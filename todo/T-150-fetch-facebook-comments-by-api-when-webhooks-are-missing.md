---
id: T-150
title: Fetch Facebook comments by API when webhooks are missing
status: backlog
type: feature
priority: P2
owner: @unassigned
feature_ids: []
created: 2026-10-29
updated: 2026-10-29
branch: 
pr:
parent:
---

## Context

On 2026-10-29 Facebook comment webhooks did not arrive while the Meta app was in Development mode, although the `feed` field was subscribed on the Page and the permissions were granted. The comment workspace (T-106) then stayed empty even though comments existed.

## Goal

When the comment workspace opens, backfill recent comments through the Graph API so missing webhooks do not leave it empty.

## Scope

- Fallback that lists recent comments of recent Page posts (Graph API) when the comment workspace opens.
- Rate limited per Page and per workspace (for example at most one backfill per Page every few minutes, bounded number of posts and comments per run).
- Idempotent with webhook ingestion: the same comment id arriving by both paths produces one thread entry.
- Respects the granted scopes: needs `pages_read_user_content`; without it, show nothing new and say why instead of failing.
- Docs for the channel module and Meta setup updated.

## Out of scope

- Replacing webhooks; polling in the background without the workspace being open; replying to comments (covered by T-106).

## Acceptance criteria

- [ ] Opening the comment workspace on a Page whose webhooks were missed lists the recent comments
- [ ] Re-opening it, or a webhook arriving for the same comment, creates no duplicate
- [ ] Backfill is rate limited and bounded; a Graph rate-limit error degrades gracefully
- [ ] Missing `pages_read_user_content` shows a clear state, not an error
- [ ] Tests added/updated and `pnpm check` green
- [ ] Docs updated

## Plan

To be written by the implementer before coding.

## Log

- 2026-10-29 — created as a backlog follow-up of T-106; no code yet.

## Links

- Docs: docs/04-system-architecture.md, docs/11-code-structure-and-conventions.md
- Related tasks: T-106, T-144
