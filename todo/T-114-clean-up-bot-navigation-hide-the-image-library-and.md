---
id: T-114
title: Clean up bot navigation: hide the image library and rename channel integrations
status: review            # backlog | next | in-progress | blocked | review | done | cancelled
type: chore              # feature | bug | chore | spike | docs
priority: P2               # P0 | P1 | P2 | P3
owner: "@agent:claude"     # @github-handle or @agent:<tool>
feature_ids: []            # e.g. [BOT-07, CRM-11] from docs/02-functional-requirements.md
created: 2026-10-27
updated: 2026-10-28
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

- [x] No navigation path leads to the image library; `/app/bots/$botId/media` redirects to the bot home.
- [x] Bots can still send image attachments that were uploaded before.
- [x] Navigation tests updated; `pnpm check` green.
- [x] vi/en strings updated; docs/03 screen map updated.

## Plan

1. Add `features/bot/components/training-nav.test.tsx` (failing first): no image library link in either nav (desktop list, mobile strip); the integrations entry reads "Tích hợp kênh" and points to `/app/bots/$botId/integrations`.
2. `training-nav.tsx`: drop the media item (and the `Image` icon/target). The setup guide has no media step, so nothing to change there.
3. `routes/app/bots/$botId/media.tsx`: replace the page with a `beforeLoad` redirect to `/app/bots/$botId` (bookmarks land on the bot home). `MediaLibrary` and the media API stay in place, unused by navigation, so the decision can be reversed cheaply.
4. i18n: `space.nav.integrations` and `integrations` → "Tích hợp kênh" / "Channel integrations".
5. e2e `t023-training.spec.ts`: the media-folder flow becomes a redirect check (the page is no longer reachable). Quick replies keep the library picker for existing images and the direct HTTPS link field for new ones.
6. docs/03 §3: drop the image library row, rename Integrations.

Risk: owners can no longer upload new images to the library; quick replies still accept an HTTPS image link. Flag this to the reviewer.

## Log

- 2026-10-27 — created from the review ("xoá thư viện ảnh", "đổi tích hợp -> tích hợp kênh"). Navigation-only removal decided by the user.
- 2026-10-28 — Image library removed from both bot menus; `/app/bots/$botId/media` redirects to the bot home (`beforeLoad`). Bot integrations nav label and page title are now "Tích hợp kênh" / "Channel integrations"; unused `space.nav.media` key dropped. Media API, `MediaLibrary` and existing images untouched: the quick-reply picker still lists library images and accepts an HTTPS link, and bot replies keep their attachments. e2e: the media-folder flow became a redirect check; all 35 e2e and 372 unit tests green; gate green. Follow-up for the reviewer: owners can no longer add images to the library, decide later whether `MediaLibrary` should be deleted or moved elsewhere.

## Links

- [Review milestone handoff](../docs/handoffs/2026-10-26-cofounder-review-plan.md)
- [Architecture](../docs/ARCHITECTURE.md)
- Related tasks: T-083
