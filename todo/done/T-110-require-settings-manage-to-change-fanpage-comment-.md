---
id: T-110
title: Require settings.manage to change fanpage comment automation settings
status: done
type: bug
priority: P1
owner: '@agent:codex'
feature_ids: []
created: 2026-10-28
updated: 2026-10-28
branch: feat/tung-dev
pr: 77
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

- [x] Analyst and sales get 403 on `PATCH /fanpage/settings`; owner/admin succeed.
- [x] The settings panel does not offer saving to roles without `settings.manage`.
- [x] Tests added/updated and `pnpm check` green
- [x] Docs updated (or "no docs impact" stated)

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

- 2026-10-28 — Reproduced failing-first: 2 frontend role cases and 2 real-HTTP permission cases failed before the fix. Added existing settings.manage capability and read-only UI controls. Focused green: frontend 4/4, HTTP integration 7/7. Fresh same-model QA approved server/UI/docs; final combined gate/browser pending T-093 integration.

## Links

- Docs: …
- Related tasks: …

- 2026-10-28 — Final frozen source passed full pnpm check (backend 1,104 and frontend 499 tests; bundle 232.1 KB). Fresh same-model independent QA approved 47/47 functional and 114/114 responsive browser cases with unchanged timeout/assertions and reviewed the 390px image. Delivery report: docs/handoffs/2026-10-28-lane-b-closeout.md. Prepared for the owner-requested feat/tung-dev push; main is not a landing target.

- 2026-10-28 — Review PR #77 mirrors the canonical feat/tung-dev commit on feat/T-117-lane-b-closeout. All code/browser acceptance passed before publication; CI runs on the matching review ref.
