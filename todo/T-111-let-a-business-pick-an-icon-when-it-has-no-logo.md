---
id: T-111
title: Let a business pick an icon when it has no logo
status: review
type: feature              # feature | bug | chore | spike | docs
priority: P1               # P0 | P1 | P2 | P3
owner: "@agent:claude"
feature_ids: []            # e.g. [BOT-07, CRM-11] from docs/02-functional-requirements.md
created: 2026-10-28
updated: 2026-10-28
branch: feat/T-108-account-portfolio-layer
pr: 76
parent:                    # T-xxx if this is a sub-task
---

## Context

Owner review of PR #76: a business without a logo should still have an icon, chosen by the user (T-110 shows the logo; this adds the fallback the owner picks).

## Goal

A business can pick one of a fixed set of icons, shown wherever its logo would be when it has none.

## Scope

- `workspaces.icon` column (migration 0032 — renumbered from 0028 when integrated after lane A, which owns 0028–0031; additive, default `building`), `BUSINESS_ICONS` in contracts, `icon` in the profile DTO, the update request and memberships.
- Icon picker in Settings › Shop profile, saved with the profile form; `BusinessAvatar` draws it without a logo.

## Out of scope

- Custom-colour icons or uploading an icon; the logo upload stays as is.

## Acceptance criteria

- [x] The owner can pick an icon in Settings › Shop profile and save it.
- [x] The icon shows in the selector, account sidebar and portfolio when there is no logo; the logo wins when there is one.
- [x] An icon outside the list is refused (400) and nothing changes.
- [x] Tests added (integration against Postgres, avatar, session) and `pnpm check` green
- [x] Docs: no impact beyond the additive column

## Plan

Written by the implementer before coding (see `start-task` skill). Steps, files, tests, migration/docs/i18n impact, risks.

1. …

## Log

Dated entries, newest last. Decisions, blockers, questions, what was verified and how.

- 2026-10-28 — created.

## Links

- Docs: …
- Related tasks: …
