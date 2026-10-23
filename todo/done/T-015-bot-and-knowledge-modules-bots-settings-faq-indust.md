---
id: T-015
title: Bot and knowledge modules: bots, settings, FAQ, industry seed pack
status: done
type: feature
priority: P0
owner: @agent:claude
feature_ids: [BOT-01, BOT-02, BOT-03, BOT-04, BOT-05, BOT-07, BOT-12, BOT-13, VRT-01]
created: 2026-10-24
updated: 2026-10-24
branch: feat/T-015-m2-bot-playground (milestone M2)
pr:
parent:                    # T-xxx if this is a sub-task
---

## Context

M2 goal: an owner signs up, creates a bot, fills the industry pack's facts and chats with it in the dashboard playground. This task is the data side: bots, settings and FAQ knowledge.

## Goal

Bots and FAQs are manageable over the API, seeded per industry with `{{placeholders}}`, searchable accent-insensitively for the AI (T-016).

## Scope

- Migration 0002 (`bots`, `knowledge_items`, forced RLS, trigram index on folded text).
- `knowledge` module (FAQ CRUD, seed, search; no HTTP) and `bot` module (CRUD, partial settings, readiness, `/bots/{botId}/faqs`).
- Industry packs for retail, fashion, cosmetics, spa, dental, education, hotel, solar, other.
- `foldVietnamese`, placeholder helpers, `isUuid` in shared.

## Out of scope

- Documents/URLs/embeddings, scenarios (bot_instructions), media, quotas per plan, bot deletion.

## Acceptance criteria

- [x] Creating a bot seeds its pack; readiness lists missing placeholders until filled.
- [x] FAQ CRUD; another workspace's bot answers 404; non-UUID ids answer 404.
- [x] Unaccented, abbreviated customer text finds the right FAQ on real Postgres.
- [x] `pnpm check` + integration green.

## Plan

Contracts → migration → knowledge → bot → tests (domain, HTTP, integration).

## Log

Dated entries, newest last. Decisions, blockers, questions, what was verified and how.

- 2026-10-24 — created.

- 2026-10-24 — done. Backend unit/HTTP 146, integration 6 (backend) + 8 (db; forced-RLS scan now covers the new tables automatically).

## Links

- Docs: …
- Related tasks: …
