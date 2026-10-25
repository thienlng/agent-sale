---
id: T-073
title: Sales inbox v2 unread tags filters and reply mode
status: in-progress        # backlog | next | in-progress | blocked | review | done | cancelled
type: feature              # feature | bug | chore | spike | docs
priority: P1               # P0 | P1 | P2 | P3
owner: '@agent:claude'     # @github-handle or @agent:<tool>
feature_ids: []            # e.g. [BOT-07, CRM-11] from docs/02-functional-requirements.md
created: 2026-10-25
updated: 2026-10-25
branch: feat/T-068-sales-inbox
pr: '#59'
parent:                    # T-xxx if this is a sub-task
---

## Context

The owner tested the T-068 inbox and rejected it from a sales rep's point of view:
- The list shows PSIDs instead of names.
- There is no unread state and no way to see what is still open when a shift is handed over.
- The bot/human toggle is blind.
- "Nhân viên phụ trách trả lời" is unclear.
- Filters waste space.
- There are no tags.
- The right panel shows meaningless data.

The owner asked for a redesign that uses Pancake as a UX reference. Design: `docs/superpowers/specs/2026-10-25-inbox-v2-design.md`.

## Goal

A compact inbox where a sales rep sees at a glance who is waiting, who the customer is, who is answering, and which tags apply, and can act in one click.

## Scope

- In scope:
  - Customer name and avatar from Meta.
  - Shared unread state with mark unread.
  - Waiting state.
  - Phone detection.
  - Notes timeline.
  - Assigning any member.
  - Conversation tags (CRM library).
  - List query with filters and counts, filtered in SQL through migration 0024.
  - List tabs, filter popover and chips, row redesign.
  - Header with reply-mode and assignee dropdowns.
  - Tag bar.
  - `/` quick replies.
  - Right panel cleanup.
  - Shortcuts `T` and `U`.

## Out of scope

- Round-robin or shift assignment, bulk actions, comment inbox, AI sentiment, contact/conversation tag sync, per-user unread.

## Acceptance criteria

- [ ] List rows show the customer name (or "Khách Facebook ·1234"), channel, unread count, wait time, up to 3 tags + "+N", phone icon, assignee and reply mode.
- [ ] Tabs Tất cả / Chưa đọc / Chờ rep show server counts. Opening a conversation marks it read for the whole shop, and "Đánh dấu chưa đọc" brings it back.
- [ ] The header shows "Đã xem bởi X · time". The reply-mode dropdown lists all three modes with explanations, and the assignee dropdown assigns any member.
- [ ] The filter popover supports tags has-any/has-all/exclude/untagged, waiting kinds, mode, assignee, channel, phone and status. Active filters show as one line of chips.
- [ ] The tag bar attaches and removes conversation tags in one click, and the picker searches all tags.
- [ ] The right panel shows only customer, notes timeline, orders and follow-up.
- [ ] Tests added/updated and `pnpm check` green
- [ ] Docs updated (`docs/` inbox section, `apps/web` README screenshots if present)

## Plan

1. **Backend: conversation core.**
   - Migration `0024_inbox_v2.sql` adds columns, backfills them and adds indexes.
   - The store does SQL filtering and counts.
   - Read and unread routes.
   - `awaitingSince`, `lastMessageSender`, `customerPhone`, notes.
   - `assigneeId` validated through `TeamFacade`.
   - Contracts updated.
2. **Backend: Meta profile fetch.** `ChannelFacade.fetchCustomerProfile`, called best-effort after inbound, with a once-per-day retry.
3. **Backend: CRM conversation tags.**
   - Routes and `CrmFacade.conversationTags` / `conversationIdsByTags`.
   - The list joins tags and applies tag filters.
4. **Web: list.** Tabs with counts, filter popover and chips, row anatomy, row menu, saved views storing filters.
5. **Web: pane.**
   - Header dropdowns, seen-by line, "Tin mới" divider, bot labels.
   - Tag bar and picker.
   - `/` quick replies.
   - Shortcuts.
   - Right panel blocks and the notes timeline.
6. **QA and docs.** Independent review, fixes, `pnpm check`, docs, then merge into `integration/local-all` for the owner's real-stack test.

## Log

Dated entries, newest last. Decisions, blockers, questions, what was verified and how.

- 2026-10-25 — created. Design approved in chat ("okk làm hết đi"). The owner chose shared (per-shop) unread.

## Links

- Docs: `docs/superpowers/specs/2026-10-25-inbox-v2-design.md`
- Related tasks: T-068, T-072
