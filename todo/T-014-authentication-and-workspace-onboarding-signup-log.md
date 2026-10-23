---
id: T-014
title: Authentication and workspace onboarding: signup, login, refresh rotation, membership guard, bootstrap
status: backlog            # backlog | next | in-progress | blocked | review | done | cancelled
type: feature
priority: P0
owner:                     # @github-handle or @agent:<tool>
feature_ids: [ACC-01, ACC-02, ACC-06, ACC-07, SET-01]
created: 2026-10-23
updated: 2026-10-23
branch:
pr:
parent:                    # T-xxx if this is a sub-task
---

## Context

Every API call is currently scoped by a dev-only `X-Workspace-Id` header. M1 needs real users and sessions so the dashboard can be used end to end (docs/09 §2, token storage rules).

## Goal

A visitor can sign up (creating user + workspace + owner membership), log in, stay logged in via refresh rotation, and every tenant endpoint is protected by authentication + membership.

## Scope

- `identity` module (generated): users, sessions (migration 0001), Argon2id, JWT access 15 min (EdDSA, `jose`), opaque refresh token hashed in DB with rotation + reuse detection, HttpOnly refresh cookie scoped to `/api/v1/auth/refresh`, `client=native` body variant.
- Endpoints: `POST /auth/signup`, `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /me`, `GET /bootstrap` (user + workspaces + current workspace).
- `AuthGuard` (bearer) + `WorkspaceGuard` (membership via workspace facade); `X-Workspace-Id` only selects among the user's memberships; dev header fallback removed.
- Rate limits on auth endpoints; audit events for login/logout.

## Out of scope

- Email/phone verification (OTP), Google login, 2FA, invitations — follow-up tasks.

## Acceptance criteria

- [ ] Signup creates user + workspace + owner membership atomically.
- [ ] Refresh rotation; reusing an old refresh token revokes the family.
- [ ] Tenant endpoints: 401 without token, 404 for a workspace the user is not a member of.
- [ ] Integration tests on real Postgres; `pnpm check` green.

## Plan

Written by the implementer before coding (see `start-task` skill). Steps, files, tests, migration/docs/i18n impact, risks.

1. …

## Log

Dated entries, newest last. Decisions, blockers, questions, what was verified and how.

- 2026-10-23 — created.

## Links

- Docs: …
- Related tasks: …
