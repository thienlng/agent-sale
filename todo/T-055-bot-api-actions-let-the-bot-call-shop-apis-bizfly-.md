---
id: T-055
title: Bot API actions: let the bot call shop APIs (Bizfly-style integrations)
status: review            # backlog | next | in-progress | blocked | review | done | cancelled
type: feature              # feature | bug | chore | spike | docs
priority: P1               # P0 | P1 | P2 | P3
owner: '@agent:claude'                   # @github-handle or @agent:<tool>
feature_ids: []            # e.g. [BOT-07, CRM-11] from docs/02-functional-requirements.md
created: 2026-10-25
updated: 2026-10-25
branch: feat/T-055-bot-api-actions
pr:
parent:                    # T-xxx if this is a sub-task
---

## Context

Owner request (2026-10-25): the current "Tích hợp" is only channel connections; Bizfly's integration lets the bot call shop APIs (name, description, API link, method, parameters, responses). Design: `docs/superpowers/specs/2026-10-25-bot-api-actions-design.md`; plan: `docs/superpowers/plans/2026-10-25-bot-api-actions.md`; guide: `docs/actions.md`.

## Goal

A shop owner declares HTTP APIs the bot may call mid-conversation, safely (SSRF-hardened executor, write confirmation gate, secrets sealed).

## Scope

- In scope: contracts, `action` module, executor, bounded call loop in the AI pipeline (`sales-agent@8`), bot routes, web list/form/test panel, docs.

## Out of scope

- OAuth2/Basic auth, templates, cross-conversation rate limits, native provider function calling, live Facebook verification.

## Acceptance criteria

- [x] Owner can create/edit/test/enable/delete actions in the bot menu "Hành động API".
- [x] Bot calls read actions, asks confirmation for writes and executes the stored args once.
- [x] SSRF, secret, tenant-isolation and injection review done; findings fixed.
- [x] Tests added and `pnpm check` green (2026-10-25).
- [x] Docs updated (`docs/actions.md`, 05, 06, 09, MODULE.md).
- [ ] Channel confirm yes/no and "bot without actions unchanged" re-run on the real stack once the Hermes quota resets.

## Plan

See the plan document above (6 tasks: contracts/DB/CRUD, safe executor, runner, AI loop, web UI, QA/review/acceptance).

## Log

- 2026-10-25 — created; brainstormed with the owner (placement "Hành động API", all methods with confirmation gate for writes, auth none/API key/Bearer).
- 2026-10-25 — implemented in 6 commits; unit/integration tests green (backend 645, web action suites, contracts, ai-core).
- 2026-10-25 — independent review found no blocker; fixed duplicate write on requeue (idempotency key now conversation+action+args hash+10 min bucket), non-atomic confirm (`consumePending`), single-address connect, readback grounding, param validation, pending age.
- 2026-10-25 — real-stack QA (fake shop, dev DB migration 0015, api+agent restarted with `ACTION_DEV_ALLOW_HTTP_HOSTS=127.0.0.1`): lookup, missing param, booking confirm/yes/no in playground, slow/redirect/huge/blocked hosts, injection, API key, secret audit, "Thử gọi" and a channel lookup via the real webhook PASSED. NOT RUN: channel confirm yes/no and the no-actions control (Hermes ChatGPT usage limit, HTTP 429). Not verified: live Facebook Page, web UI in a real browser.
- Known: the contract requires https, so a plain-http fake shop needs `bot_actions.url` rewritten in the dev DB (QA workaround); playground action runs are `is_test`.

## Links

- Docs: `docs/actions.md`, `docs/06-ai-engine.md` §3.2, `docs/09-security-and-compliance.md` §5
- Related tasks: T-053 (chat feel), ADR-010 (Hermes has no tools)
