---
id: T-072
title: Complete inbox follow-ups saved views and sales shortcuts
status: review
type: feature
priority: P1
owner: "@agent:codex, @agent:claude"
feature_ids: [CHAT-01]
created: 2026-10-25
updated: 2026-10-25
branch: feat/T-068-sales-inbox
pr: 59
parent: T-068
---

## Context

The approved brainstorming includes follow-up scheduling, saved inbox filters, product sharing and keyboard shortcuts. Finish these conveniences in the same inbox PR rather than leaving inactive controls or chat-only promises.

## Goal

Let sales staff schedule a conversation follow-up, reuse filters and compose product information without leaving chat.

## Scope

- Persist a follow-up timestamp and private note in the existing conversation JSON data; expose a due queue.
- Device-local saved filters scoped by user and workspace, with clear storage labels and no saved search text.
- Route-composed product picker that inserts catalog text into the draft for review before sending.
- Direct CRM stage/tag controls reuse existing version and role checks.
- Focus-safe keyboard shortcuts and behavior tests, translations, docs and independent QA.

## Out of scope

- Background notifications, recurring CRM tasks (T-034), carrier integrations and provider-specific message templates.

## Acceptance criteria

- [x] Follow-ups persist through the existing tenant-scoped, revision-checked conversation API; due membership uses timestamp and open status.
- [x] Saved views restore filter settings, remain isolated by user/workspace, and can be removed.
- [x] Selected CRM profile status and tags can be edited directly using existing permission/version controls.
- [x] Product sharing inserts exact catalog name/variant/price into the draft and never sends automatically.
- [x] Shortcuts do not fire in editors, dialogs or modified key combinations.
- [x] Tests, pnpm check, production browser coverage and QA pass; docs explain limitations.

## Plan

1. Add optional backward-compatible follow-up fields to conversation contracts and persistence with validation and tenant/revision tests.
2. Implement follow-up editor, due queue and isolated saved filters; add focus-safe shortcuts.
3. Compose commerce product sharing via the inbox route and a composer render slot, preserving feature boundaries.
4. Add English/Vietnamese resources, meaningful tests and browser scenarios; rerun gate and fresh QA.

## Log

- 2026-10-25 — Started to finish the remaining conveniences in the owner's approved design. Existing JSON persistence allows follow-up metadata without a schema migration; recurring/background reminders remain a separate capability.

- 2026-10-25 — Stopped at the owner's explicit request for handoff to Claude. See docs/runbooks/inbox-agent-handoff-2026-10-25.md for exact state, pending verification and task ID collisions. No further implementation/publishing after this request.

- 2026-10-25 — Claude continued. Task IDs renumbered to avoid collisions with other worktrees (this task was T-070, the CI blocker fix is now T-071). Fixed the caret bug (composer remembers selection on change/blur/select) and a test fixture that picked an archived CRM status. Production Playwright inbox + responsive: 16/16. Fresh-context QA review found no blockers; fixed: one corrupt saved view no longer discards the others, randomUUID failure on insecure contexts is handled, clearing followUpAt on the server also clears the private note. Documented, not changed: an inbound customer message bumps the revision so an open follow-up draft shows the conflict banner (no data loss); ProductShare has no permission gate (shows an error/retry state if the catalog is unreadable); `/` shortcut ignores Shift (AZERTY).
- 2026-10-25 — T-073 replaced the separate "Đến hẹn" queue with the Tất cả / Chưa đọc / Chờ rep tabs; follow-ups keep working from the right panel ("Hẹn chăm sóc lại").

## Links

- [Inbox design and behavior](../docs/18-sales-inbox-workspace.md)
- [Parent](done/T-068-redesign-the-sales-inbox-workspace.md)
