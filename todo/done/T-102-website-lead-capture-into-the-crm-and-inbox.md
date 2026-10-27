---
id: T-102
title: Website lead capture into the CRM and inbox
status: done
type: feature
priority: P1
owner: @agent:claude
feature_ids: [CHN-05]
created: 2026-10-27
updated: 2026-10-27
branch: feat/T-097-website-chat-channel
pr: direct merge to main (owner-approved, 2026-10-27)
parent: T-097
---

## Context

A visitor who leaves a phone number should become a CRM customer and be visible to staff. Spec: `docs/superpowers/specs/2026-10-27-website-chat-channel-design.md`. Plan (Task 6): `docs/superpowers/plans/2026-10-27-website-chat-channel.md`.

## Goal

Capture phones from chip, chat text or required mode, upsert the CRM contact and link it to the conversation.

## Scope

- In scope: Shared phone normalization and findVnPhone
- In scope: crm.upsertLeadByPhone, conversation linkContact and ConversationDto.lead
- In scope: Required-phone mode (409 PHONE_REQUIRED)
- In scope: Inbox Số mới badge, sound and browser notification, visitor side panel

## Out of scope

- Web Push
- Attribution and CAPI

## Acceptance criteria

- [x] Concurrent captures create one contact
- [x] Widget and server share the same phone rules
- [x] Lead badge and notification shown in the inbox
- [x] pnpm check green
- [x] Docs updated (or "no docs impact" stated)

## Plan

See the plan section (Task 6) linked above.

## Log

- 2026-10-27 — created.
- 2026-10-27 — implemented: shared `findVnPhone`/`normalizeLeadPhone`, `crm.upsertLeadByPhone` (advisory lock), `conversation.linkLead` + `lead` DTO + `phoneKnown` prompt line, webchat `/phone`, phone-in-text, required-phone 409, migration 0027 (`message_count`), inbox badge/notification/visitor panel. Verified with unit, integration and web tests.
- 2026-10-27: T-104 verification pass, set to review: lead capture into CRM and inbox covered by integration tests; "Số mới" badge and visitor panel shown in the T-104 e2e. `pnpm check` exit 0.
- 2026-10-27: merged into `main` (squash, owner-approved direct merge); status done.

## Links

- Spec: `docs/superpowers/specs/2026-10-27-website-chat-channel-design.md`
- Plan: `docs/superpowers/plans/2026-10-27-website-chat-channel.md`
- Docs: `docs/adr/ADR-011-website-widget-shadow-dom-and-polling.md`, `docs/07-channel-integrations.md` section 5
- Related tasks: T-097..T-104
