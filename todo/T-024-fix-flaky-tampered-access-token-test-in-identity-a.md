---
id: T-024
title: Fix flaky tampered access-token test in identity auth flow
status: backlog            # backlog | next | in-progress | blocked | review | done | cancelled
type: bug                  # feature | bug | chore | spike | docs
priority: P1               # P0 | P1 | P2 | P3
owner:                     # @github-handle or @agent:<tool>
feature_ids: []            # e.g. [BOT-07, CRM-11] from docs/02-functional-requirements.md
created: 2026-10-24
updated: 2026-10-24
branch:
pr:
parent:                    # T-xxx if this is a sub-task
---

## Context

`apps/backend/src/modules/identity/__tests__/auth.flow.spec.ts` ("access tokens are rejected when tampered with") fails about 1 run in 5. It replaces the last two characters of the token with `AA`/`BB`; the last base64url character of the signature carries padding bits, so e.g. `…AB` → `…AA` can decode to the same signature bytes and the token still verifies. Found while running `pnpm check` for T-023.

## Goal

Tamper a byte that is fully significant (e.g. flip a character in the payload segment, or decode/flip/re-encode a signature byte) so the test is deterministic.

## Scope

- In scope: …

## Out of scope

- …

## Acceptance criteria

- [ ] Verifiable statement 1
- [ ] Verifiable statement 2
- [ ] Tests added/updated and `pnpm check` green
- [ ] Docs updated (or "no docs impact" stated)

## Plan

Written by the implementer before coding (see `start-task` skill). Steps, files, tests, migration/docs/i18n impact, risks.

1. …

## Log

Dated entries, newest last. Decisions, blockers, questions, what was verified and how.

- 2026-10-24 — created.

## Links

- Docs: …
- Related tasks: …
