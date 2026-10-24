---
id: T-052
title: Sign in to ChatGPT from the Admin LLM page for hermes-runtime
status: in-progress            # backlog | next | in-progress | blocked | review | done | cancelled
type: feature              # feature | bug | chore | spike | docs
priority: P2
owner: @mrkenknight
feature_ids: []            # e.g. [BOT-07, CRM-11] from docs/02-functional-requirements.md
created: 2026-10-24
updated: 2026-10-24
branch: feat/T-052-hermes-chatgpt-admin-login
pr:
parent: T-045
---

## Context

Commit `2896628` (by mrkenknight, pushed to PR #40 after its review) added device-code ChatGPT sign-in from Admin → LLM: three platform-admin endpoints, `services/hermes/login.py` with `GET /v1/auth/status`, `POST /v1/auth/start`, `POST /v1/auth/logout`, and a web panel. The maintainer split it out of PR #40 (reverted there) so #40 could merge; the code is preserved on branch `feat/T-052-hermes-chatgpt-admin-login`. Review findings of 2026-10-24 below must be resolved first.

## Goal

An admin can sign hermes-runtime in and out of ChatGPT from the dashboard, safely and consistent with the documented architecture.

## Scope

- Rebase the branch onto `main` after PR #40 merges
- B1: one lock shared by login, logout and the runtime's token refresh (e.g. `fcntl.flock` on `HERMES_HOME/.auth.lock`); refresh replaces `auth.json` only if it is unchanged since read; logout revokes the refresh token at OpenAI or the UI/README state that logout is local only
- B2: amend ADR-010, `docs/ARCHITECTURE.md` §7 (Contract, Owns, Caller rows) and Rule 05 for the `/v1/auth/*` endpoints and `HermesLoginClient`
- B3: owner decision recorded on ChatGPT-plan eligibility for a hosted product; until then the panel is available only outside production (and after T-050)
- Nits: no network call while holding `_lock` in `start()`; tell the admin to keep the page open until sign-in completes (or redeem in the bridge); reject a non-empty body on the auth POSTs; 401 test for the admin endpoints; avoid the real connection to `127.0.0.1:9` in `http.spec.ts`; shared loopback/private host check for bridge URLs

## Out of scope

- Other providers' sign-in flows

## Acceptance criteria

- [ ] Logout during a concurrent refresh stays logged out (test with an injected refresh)
- [ ] ADR-010 / ARCHITECTURE §7 / Rule 05 match the code
- [ ] Owner decision on B3 recorded in this file's Log
- [ ] Tests added/updated and `pnpm check` green
- [ ] Docs updated (or "no docs impact" stated)

## Plan

Written by the implementer before coding (see `start-task` skill). Steps, files, tests, migration/docs/i18n impact, risks.

1. …

## Log

Dated entries, newest last. Decisions, blockers, questions, what was verified and how.

- 2026-10-24 — created by the maintainer when splitting commit `2896628` out of PR #40; code kept on `feat/T-052-hermes-chatgpt-admin-login`.
- 2026-10-24 — PR #40 merged; branch rebased onto `main`, draft PR opened for the team to continue.

## Links

- Docs: …
- Related tasks: T-045, T-047, T-050 (PR #40)
