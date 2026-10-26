---
id: T-045
title: Email verification at signup (ACC-01) and verified-email invitations
status: backlog            # backlog | next | in-progress | blocked | review | done | cancelled
type: feature              # feature | bug | chore | spike | docs
priority: P0
owner:                     # @github-handle or @agent:<tool>
feature_ids: [ACC-01, SET-01]
created: 2026-10-24
updated: 2026-10-24
branch:
pr:
parent:                    # T-xxx if this is a sub-task
---

## Context

Found in the M3b review: signup never verifies the email (`emailVerifiedAt` stays null), so an invitation bound to an email is only as safe as its link. Someone holding a leaked link could sign up with the invited address (if it is not registered yet) and join. M3b mitigates this (the preview masks the address for anyone else, links expire in 7 days, die with their inviter's authority and can be revoked) but cannot close it without verification. docs/02 ACC-01 already requires verification.

## Goal

Signup verifies the email (link or OTP, 15-minute expiry), and invitations can only be accepted by a verified email.

## Scope

- SMTP sending (self-hosted relay; SMTP_URL already in .env.example) behind a mail port, outbox-driven.
- Verify-email flow and resend; dashboard blocked until verified (ACC-01).
- `accept` requires `emailVerifiedAt`; optionally send invitation emails directly.

## Acceptance criteria

- [ ] An unverified account cannot accept an invitation (403 with a clear reason).
- [ ] Verification links expire after 15 minutes and are single-use.
- [ ] Tests added/updated and `pnpm check` green
- [ ] Docs updated

## Log

- 2026-10-24 — created from the M3b security review.
