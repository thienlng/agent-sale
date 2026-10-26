---
id: T-052
title: Sign in to ChatGPT from the Admin LLM page for hermes-runtime
status: done            # backlog | next | in-progress | blocked | review | done | cancelled
type: feature              # feature | bug | chore | spike | docs
priority: P2
owner: @mrkenknight
feature_ids: []            # e.g. [BOT-07, CRM-11] from docs/02-functional-requirements.md
created: 2026-10-24
updated: 2026-10-26
branch: feat/T-052-hermes-chatgpt-admin-login
pr: '#58'
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

- [x] Logout during a concurrent refresh stays logged out (test with an injected refresh)
- [x] ADR-010 / ARCHITECTURE §7 / Rule 05 match the code
- [ ] Owner decision on B3 recorded in this file's Log
- [x] Tests added/updated and `pnpm check` green
- [x] Docs updated (or "no docs impact" stated)

## Plan

Written by the implementer before coding (see `start-task` skill). Steps, files, tests, migration/docs/i18n impact, risks.

1. B1: `services/hermes/authstore.py` (one `flock` on `.auth.lock`, atomic write) used by `login.py` (sign-in write, logout) and `runtime.py` (read under lock, refresh outside, re-lock, compare refresh token, write; discard + `MODEL_AUTH_REQUIRED` otherwise). Tests with injected refresh in `test_authstore.py`.
2. Logout revocation: no OpenAI revoke endpoint found in Hermes, so logout stays local only; stated in README, docs and the web confirm dialog (vi+en).
3. Nits: `start()` requests the code outside `_lock`; auth POSTs reject any body (400); panel tells the admin to keep the page open; 401/404 tests for the hermes-login and models routes; `http.spec.ts` no longer opens real sockets (fake provider factory); one shared `parseBridgeBaseUrl` in `packages/ai-core`.
4. B3 gate: `HERMES_SUBSCRIPTION_LOGIN` (default on outside production, off in production unless `true`); contract state `disabled`; POST/DELETE 403; panel note.
5. B2 docs: ADR-010 amendment, ARCHITECTURE §7, Rule 05, services/hermes/README, docs/06 §10, ai MODULE.md.
6. UX: Test-provider popover keeps the result inline (seconds), toasts too, clears on model change.

## Log

Dated entries, newest last. Decisions, blockers, questions, what was verified and how.

- 2026-10-24 — created by the maintainer when splitting commit `2896628` out of PR #40; code kept on `feat/T-052-hermes-chatgpt-admin-login`.
- 2026-10-24 — PR #40 merged; branch rebased onto `main`, draft PR opened for the team to continue.

- 2026-10-24 — implemented review items B1, B2, B3 gate, nits and the test-provider UX fix (see Plan). No real OpenAI sign-in was performed; all tests use fakes.
- 2026-10-24 — **B3 owner decision on ChatGPT-plan eligibility for a hosted product is still pending.** Until it is recorded here and in ADR-010, the gate is in place: sign-in is disabled in production (`HERMES_SUBSCRIPTION_LOGIN` unset or `false`) and enabled elsewhere. T-050 (pinned Hermes version) is still a prerequisite.
- 2026-10-24 — logout revocation: searched the Hermes sources for a documented OpenAI token revoke endpoint; none found, so logout is local only and the README, docs and the confirm dialog say so.
- 2026-10-24 — the former per-file URL checks never restricted hosts (only scheme, credentials, query, fragment), so the shared `parseBridgeBaseUrl` keeps exactly that behaviour; a loopback/private-host policy was not added because it would change existing behaviour for configured bridge hosts. Open for the maintainer if a host policy is wanted.

- 2026-10-26 — merged into main with PR #58.

## Links

- Docs: …
- Related tasks: T-045, T-047, T-050 (PR #40)
