---
id: T-100
title: Webchat public API, visitors and rate limits
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

The only unauthenticated internet surface: the widget talks to a new webchat module on the api entry. Spec: `docs/superpowers/specs/2026-10-27-website-chat-channel-design.md`. Plan (Task 4): `docs/superpowers/plans/2026-10-27-website-chat-channel.md`.

## Goal

Serve the public widget API with visitor tokens, origin checks, rate limits, uploads and message polling.

## Scope

- In scope: pnpm gen module webchat; webchat_visitors table with tenant RLS
- In scope: GET settings, POST/GET messages, POST uploads
- In scope: HMAC visitor tokens, Origin allowlist (subdomains), in-memory RateLimiter behind a port
- In scope: listForVisitor, botTyping, event written to the durable queue

## Out of scope

- Phone capture (T-102)
- Widget bundle (T-101)
- Redis-backed limiter (later)

## Acceptance criteria

- [x] Duplicate clientMessageId is stored once
- [x] Unknown/disabled site or origin mismatch returns 404
- [x] Rate limits return 429 with Retry-After
- [x] No IP, token or message text in logs; RLS verified
- [x] pnpm check green
- [x] Docs updated (or "no docs impact" stated)

## Plan

See the plan section (Task 4) linked above.

## Log

- 2026-10-27 — created.
- 2026-10-27 — implemented the `webchat` module: contracts, migration 0026 `webchat_visitors`, public widget API (config/messages/uploads, phone 501), origin check, in-memory rate limits behind `RATE_LIMITER`, S3 upload adapter, `ConversationFacade.listForVisitor`, website customer naming, authed visitor route, `@fastify/multipart`, preflight hook; channel follow-ups (secret cache warmed by `resolveWebsite`, `enabled` only toggles disabled/connected, unusable settings resolve to null); widget de-duplicates own messages by `clientMessageId`. Unit and integration tests, docs (04, 09, ARCHITECTURE, MODULE.md) updated.
- 2026-10-27: T-104 verification pass, set to review: public API, origin rule, rate limits and uploads covered by apps/backend/test/webchat.integration.spec.ts. `pnpm check` exit 0.
- 2026-10-27: merged into `main` (squash, owner-approved direct merge); status done.

## Links

- Spec: `docs/superpowers/specs/2026-10-27-website-chat-channel-design.md`
- Plan: `docs/superpowers/plans/2026-10-27-website-chat-channel.md`
- Docs: `docs/adr/ADR-011-website-widget-shadow-dom-and-polling.md`, `docs/07-channel-integrations.md` section 5
- Related tasks: T-097..T-104
- 2026-10-27: post-QA fix: the address gate (:c) now charges only site lookups that miss the cache (429 without a DB query); a token-less POST /uploads starts the visitor and returns visitorToken (query params firstUrl, referrer, pageUrl, pageTitle); widget stores it. Unit, integration and widget tests added.
