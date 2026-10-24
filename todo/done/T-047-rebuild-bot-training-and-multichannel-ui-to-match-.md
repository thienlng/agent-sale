---
id: T-047
title: Rebuild bot training and multichannel UI to match Preny screens
status: done                 # backlog | next | in-progress | blocked | review | done | cancelled
type: feature              # feature | bug | chore | spike | docs
priority: P1               # P0 | P1 | P2 | P3
owner: @agent:claude-code     # @github-handle or @agent:<tool>
feature_ids: []            # e.g. [BOT-07, CRM-11] from docs/02-functional-requirements.md
created: 2026-10-24
updated: 2026-10-24
branch: feat/T-023-training-meta-inbox
pr: 40
parent: T-045
---

## Context

The owner reviewed T-045 and supplied the Preny screens to follow (local folder
`preny_images/`, one PNG per screen: bot home, products, instructions, information/FAQ,
integrations, image library, bot setup, quick replies, edit history, Facebook ads tool,
multichannel inbox, platform integrations, sidebar). Pixel parity is not required; layout,
flows and behaviour are. The owner also asked that a new bot starts by connecting a channel.

## Goal

The bot training space and the multichannel area follow Preny's screens and flows, backed by
working APIs (no decorative controls).

## Scope

- In scope: sidebar grouping (Đào tạo Bot; Chat đa kênh → Tin nhắn đa kênh, Tích hợp nền tảng);
  bot space shell (training menu with Cài đặt sub-menu and Development section, test chat with
  suggested questions); home checklist with the channel step first and new bots landing on
  integrations; per-bot and workspace integration lists (assign bot, deactivate, connect);
  table layouts for products, FAQs and quick replies; image library folders; basic/advanced
  bot setup (theme colour, reply hours); edit history with actor, field changes, date filter
  and restore; Facebook ads JSON tool; inbox channel filter and sort.
- Backend: `themeColor` and `replySchedule` settings (reply hours enforced by the Meta
  processor, Vietnam time); `media_folder` training kind + `folder_id`; history `actor`,
  `changes`, `snapshot` and `POST /bots/{botId}/training-history/{historyId}/restore`
  (migration 0012).

## Out of scope

- Zalo, TikTok, Lazada and website channels (shown as unavailable), message sync, image quota
  per plan, avatar upload.

## Acceptance criteria

- [x] Creating a bot opens its integrations; the home checklist lists the channel step first.
- [x] Reply hours outside the window leave messages to staff (processor test).
- [x] Media folders validate ownership and cascade; history restore works for settings and
      training items and is refused for FAQs (tests).
- [x] Every Preny screen in the reference set has a working counterpart.
- [x] Tests added/updated and `pnpm check` green
- [x] Docs updated (`docs/training-workspace.md`, `docs/meta-inbox.md`, module docs)

## Plan

1. Contracts + migration 0012 + knowledge/bot backend (done first, tested).
2. Web in three disjoint slices: bot space shell/home/setup/history/ads tool; data pages
   (products, FAQ, quick replies, library, instructions); channels/inbox/sidebar.
3. Docs, `pnpm check`, commit on the T-045 branch.

## Log

- 2026-10-24 — created from the owner's Preny screenshots; backend slice implemented with
  unit tests (settings diff/restore, folders, reply schedule).
- 2026-10-24 — Facebook popup showed "App not active": Meta app state (development mode /
  restriction), not code — the app has a single administrator role; reported to the owner.

- 2026-10-24 — owner renamed the product to **Rapiz** (rabbit logo, orange on white/black):
  visible strings, favicon/logo and default bot colour `#FF6600`; internal ids/storage keys
  (`razpi.*`) unchanged so saved preferences survive.
- 2026-10-24 — web slices done (bot space shell/home/setup/history/ads tool; data pages;
  integrations/inbox/sidebar; inbox split into small components). e2e specs updated to the new
  screens. Verified: `pnpm check` green (backend 307, web 73 tests), Playwright 13/13, and a
  live API smoke on Postgres (settings diff + restore, folders + cascade, actor names).

## Links

- Docs: docs/training-workspace.md, docs/meta-inbox.md
- Related tasks: T-045
