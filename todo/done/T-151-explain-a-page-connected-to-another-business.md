---
id: T-151
title: Explain a page connected to another business when selecting it
status: done
type: bug
priority: P1
owner: '@agent:claude'
feature_ids: []
created: 2026-10-29
updated: 2026-10-29
branch: fix/T-151-page-conflict-message
pr: main
parent:
---

## Context

The owner created the business "Villas" and tried to connect the Tam Dao page there. `POST /channels/discoveries/:id/select` answered 409 CONFLICT twice because the page was still connected (not removed) in "Ken Shop" — one business per live page (T-133/T-142). The web showed the generic "Cấp quyền thất bại. Kiểm tra quyền truy cập…" toast, which points at Facebook permissions instead of the real cause.

## Goal

A page that is live in another business is explained in the toast, with the way out.

## Scope

- Web: map a CONFLICT from the discovery selection to a dedicated message (vi + en); other errors keep the permission message. The other business is not named (the caller may not belong to it).

## Out of scope

- Moving the page automatically; backend behaviour.

## Acceptance criteria

- [x] CONFLICT on selection shows "Trang này đang được kết nối ở một business khác…" with the removal path; other errors unchanged.
- [x] Unit test for the mapping; channel feature tests, web typecheck, eslint, i18n tests and web build pass.

## Plan

1. Failing unit test for `selectionErrorKey`. 2. Implement and use it in `useIntegrations().saveSelection`. 3. Strings vi/en.

## Log

- 2026-10-29 — API log: two selects → 409; DB: page `connected` in Ken Shop. Red: module missing; green: mapping test + channel feature 90/90 (--testTimeout=30000 on the loaded host), web tsc/eslint clean, i18n tests and web build pass. Owner workaround: remove the page in Ken Shop first, then connect in Villas.

## Links

- apps/web/src/features/channel/lib/selection-error.ts, apps/web/src/features/channel/hooks/use-integrations.ts
