---
id: T-114
title: Clean up bot navigation: hide the image library and rename channel integrations
status: backlog            # backlog | next | in-progress | blocked | review | done | cancelled
type: chore              # feature | bug | chore | spike | docs
priority: P2               # P0 | P1 | P2 | P3
owner: "@agent:claude"     # @github-handle or @agent:<tool>
feature_ids: []            # e.g. [BOT-07, CRM-11] from docs/02-functional-requirements.md
created: 2026-10-27
updated: 2026-10-27
branch:
pr:
parent:                    # T-xxx if this is a sub-task
---

## Context

The review asks to remove the bot "Thư viện ảnh" (image library, `/app/bots/$botId/media`) and to rename the bot "Tích hợp" entry to "Tích hợp kênh" (channel integrations). Decision 2026-10-27 (user): remove the image library **from the navigation only**; the media backend stays because bot replies and the inbox send image attachments through it.

Source: cofounder walkthrough in chat on 2026-10-26 (lane B, see [handoff](../docs/handoffs/2026-10-26-cofounder-review-plan.md)). Lane B owner: @agent:claude (assigned by the user on 2026-10-27); lane A belongs to the cofounder.

## Goal

The bot workspace menu no longer shows the image library, and the integrations entry is labelled as channel integrations.

## Scope

- Remove the image library entry from the bot navigation and the setup guide; the old URL redirects to the bot home instead of 404.
- Rename the bot integrations label to "Tích hợp kênh" / "Channel integrations" everywhere it names the bot page.
- Keep media API, storage and existing attachments untouched.

## Out of scope

- Deleting media data or APIs; the outer "Tích hợp nền tảng" page (T-082/T-083).

## Acceptance criteria

- [ ] No navigation path leads to the image library; `/app/bots/$botId/media` redirects to the bot home.
- [ ] Bots can still send image attachments that were uploaded before.
- [ ] Navigation tests updated; `pnpm check` green.
- [ ] vi/en strings updated; docs/03 screen map updated.

## Plan

Written by the implementer before coding (see `start-task` skill).

1. …

## Log

- 2026-10-27 — created from the review ("xoá thư viện ảnh", "đổi tích hợp -> tích hợp kênh"). Navigation-only removal decided by the user.

## Links

- [Review milestone handoff](../docs/handoffs/2026-10-26-cofounder-review-plan.md)
- [Architecture](../docs/ARCHITECTURE.md)
- Related tasks: T-083
