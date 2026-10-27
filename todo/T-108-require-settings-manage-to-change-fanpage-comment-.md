---
id: T-108
title: Require settings.manage to change fanpage comment automation settings
status: backlog
type: bug
priority: P1
owner:
feature_ids: []
created: 2026-10-28
updated: 2026-10-28
branch:
pr:
parent: T-106
---

## Context

Found during T-106: `PATCH /channels/{id}/fanpage/settings` (`FanpageController.save`) only requires workspace membership, so a view-only analyst can enable automatic public/private replies, keyword hiding or post exclusions by calling the API directly. Channel connection routes already require `settings.manage`.

## Goal

Only roles with `settings.manage` can change fanpage comment automation settings, enforced server-side.

## Scope

- In scope: `@RequireCapability('settings.manage')` on the settings PATCH route; hide the save controls in the settings panel for roles without it; HTTP test for analyst/sales 403 and owner 200; docs API table.

## Out of scope

- Comment actions (already `contacts.edit` since T-106); new roles.

## Acceptance criteria

- [ ] Analyst and sales get 403 on `PATCH /fanpage/settings`; owner/admin succeed.
- [ ] The settings panel does not offer saving to roles without `settings.manage`.
- [ ] Tests added/updated and `pnpm check` green
- [ ] Docs updated (or "no docs impact" stated)

## Plan

Written by the implementer before coding (see `start-task` skill). Steps, files, tests, migration/docs/i18n impact, risks.

1. …

## Log

Dated entries, newest last. Decisions, blockers, questions, what was verified and how.

- 2026-10-28 — created.

## Links

- Docs: …
- Related tasks: …
