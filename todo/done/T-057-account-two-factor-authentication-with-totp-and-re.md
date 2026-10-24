---
id: T-057
title: Account two-factor authentication with TOTP and recovery codes (ADM-04)
status: review
type: feature
priority: P1
owner: @agent:claude
feature_ids: [ADM-04]
created: 2026-10-24
updated: 2026-10-24
branch: feat/T-053-m4a-admin-foundation
pr:
parent:
---

## Context

GitHub #47. Accounts need a second factor.

## Goal

Users can protect their login with TOTP and recover with single-use codes.

## Scope

- `user_mfa` (migration 0018, app_system only); secret sealed with SecretBox; recovery codes stored as sha256 hashes.
- RFC 6238 TOTP (±1 step) with replay protection (`last_used_step`, atomic).
- Login: 401 `mfa_required` / `mfa_invalid`; same limiter key, reset only after the second factor passes.
- Setup needs the password; enabling needs a first valid code; disable and new recovery codes need password + code.
- Operator CLI `mfa-reset <email>`.
- Web: login code step with recovery option; Settings → Bảo mật with QR (qrcode), recovery codes shown once.

## Out of scope

- WebAuthn/passkeys, SMS codes, enforcing MFA per workspace.

## Acceptance criteria

- [x] RFC 6238 vectors pass.
- [x] A code works once; a recovery code works once.
- [x] Disabling needs password and a code.
- [x] Live e2e covers enable, login, recovery and disable.
- [x] Tests added/updated and `pnpm check` green
- [x] Docs updated (identity MODULE.md, docs/09 §2)

## Log

- 2026-10-24 — created, implemented in milestone M4a; verified with unit, integration and live e2e tests.
