---
id: T-107
title: Persist inbox text drafts and personal Enter preference
status: in-progress
type: feature
priority: P1
owner: '@agent:codex'
feature_ids: []
created: 2026-10-27
updated: 2026-10-27
branch: feat/T-107-inbox-compose-continuity
pr:
parent:
---

## Context

On 2026-10-27 the product owner approved the brainstormed parallel split: external Claude implements Facebook comments inside Inbox; Codex writes its spec and implements DM draft continuity and personal Enter settings. This continues the T-095 specification and T-096 core.

## Goal

Restore unsent DM text after reload and let each user choose Enter behavior without losing scope or safe retry semantics.

## Scope

DM text persistence on this browser, scoped by user/workspace/channel/conversation; existing attachments/notes remain session-only. Personal Enter preference in a composer popover. Session cleanup prevents old asynchronous sends recreating private state. Author the parallel T-106 specification and coordinate QA.

## Out of scope

Generic automation, background reminders, direct upload/private storage design, Instagram comments, deletion/block/report, shop/tenant model changes, global sidebar or unrelated screens. No live customer mutations.

## Acceptance criteria

- [ ] Reload restores only the correct DM text and safe retry metadata; attachments/notes are not persisted.
- [ ] Logout, session expiry and user replacement clear private drafts; old requests cannot recreate them.
- [ ] Blocked/corrupt/full/expired storage degrades safely; draft retention is bounded.
- [ ] Enter defaults to current sending behavior; per-user setting supports newline and an explicit Send button; IME/slash shortcuts remain safe.
- [ ] Unit/component and reload browser tests pass, pnpm check passes, and independent QA findings are addressed.
- [ ] Implementation docs and Claude T-106 handoff are updated.

## Plan

1. Write and review the T-106 handoff and file boundaries.
2. Add failing tests for reload persistence, scope, expiry/storage failure, logout cleanup and safe retry metadata.
3. Implement bounded local draft persistence using existing feature helpers and a shared private-browser-state cleanup hook, without backend/schema changes.
4. Add personal Enter preference and accessible composer popover, keeping default behavior, slash selection and IME handling.
5. Add reload/isolation/settings browser coverage; update docs/i18n.
6. Run targeted checks, pnpm check and independent same-model review, then open a PR. Estimated implementation plus verification under one focused day; no new runtime, dependency, tenant contract or provider call.

## Log

- 2026-10-27 — Created from the approved parallel block. Codex authored the T-106 handoff before application implementation. T-106 remains next for external Claude; only T-107 is active locally.

## Links

- [T-106 functional/implementation handoff](../docs/handoffs/T-106-facebook-comments-inbox.md)
- [Meta-style BA specification](../docs/business/rapiz-inbox-meta-ba.vi.md)
- [Current sales workspace](../docs/18-sales-inbox-workspace.md)
- [Current comment behavior](../docs/integrations/facebook-comments.md)
