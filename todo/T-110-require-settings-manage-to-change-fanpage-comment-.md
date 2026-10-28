---
id: T-110
title: Require settings.manage to change fanpage comment automation settings
status: in-progress
type: bug
priority: P1
owner: '@agent:codex'
feature_ids: []
created: 2026-10-28
updated: 2026-10-28
branch: feat/tung-dev
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

1. Add failing HTTP regressions: owner/admin may save, analyst/sales may read but cannot save, and foreign workspace/channel requests return 404 without altering stored settings.
2. Add frontend regressions for read-only settings, including post exclusions and no save control.
3. Apply the existing settings.manage server capability and matching UI permission; add vi/en explanation and update integration docs.
4. Run focused tests, the full gate and relevant browser scenarios; request fresh same-model QA and push the existing owner-requested integration branch.

No schema, dependencies, migrations or architecture changes. Keep existing comment-action capability separate. Continue on feat/tung-dev per the owner's branch instruction.

## Log

Dated entries, newest last. Decisions, blockers, questions, what was verified and how.

- 2026-10-28 — created.
- 2026-10-28 — Claimed under the owner’s request to complete remaining Inbox work. Plan written before code; use existing capability guards without new role semantics.

## Links

- Docs: …
- Related tasks: …
