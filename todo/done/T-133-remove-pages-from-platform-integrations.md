---
id: T-133
title: Remove pages from platform integrations
status: done
type: feature
priority: P1
owner: '@agent:claude'
feature_ids: []
created: 2026-10-29
updated: 2026-10-29
branch: feat/T-133-remove-page
pr: main de04081
parent:
---

## Context

On "Tich hop nen tang" (`/app/channels`) a dead or test page (for example "QA Actions", status `disconnected`) can never leave the list: `PATCH /channels/{id}` with `disconnect: true` only flips the status. The owner approved a "Go trang" (remove page) action.

## Goal

Owners can remove Facebook/Instagram pages from the integrations list; removal is soft, stops ingestion and the bot, keeps history, and a later OAuth reconnect restores the same row.

## Scope

- In scope: `removed` status, `DELETE /channels/{id}` (204), best-effort Meta webhook unsubscribe for Facebook, list hiding, ingestion hardening, row menu + bulk action + confirmation in the web UI, vi/en strings, docs.
- Website channels are excluded (they keep their own enable/disable/"Ngat ket noi" flow); `DELETE` on a website connection is rejected with a validation error.

## Out of scope

- Hard delete of rows, conversations, messages or statistics.
- Instagram webhook unsubscribe (no DELETE `subscribed_apps` for Instagram Login is used by the current subscribe code; skipped).
- Re-using a removed row from a different workspace (still "connected to another workspace").

## Acceptance criteria

- [x] `DELETE /channels/{id}` needs `settings.manage`, is tenant scoped (other workspace -> 404), returns 204.
- [x] A removed connection is hidden from `GET /channels`, has no bot, a wiped token, and is rejected by webhook ingress and `receive`.
- [x] Facebook pages are unsubscribed from webhooks on a best effort basis; failures never block removal and log only code/subcode.
- [x] OAuth select of the same Page makes the row `connected` again.
- [x] UI: row menu "Go trang", bulk "Go trang" with partial-failure retry, confirmation dialog, hidden for users without `settings.manage`.
- [x] Tests added/updated and `pnpm check` green
- [x] Docs updated (`docs/meta-inbox.md`, channel `MODULE.md`)

## Plan

1. Contracts: add `removed` to the connection status enum; add `DELETE /channels/{id}` (204) route; schema test.
2. DB: migration `0033_channel_removed_status.sql` replaces the status CHECK constraint (adds `removed`); no new column.
3. Backend: `MetaGateway.unsubscribe`, `ChannelStore.remove` (wipes the sealed token, clears bot, hides from `list`), `ChannelFacadeImpl.remove`, `@Delete(':id')`; `ConversationFacade.receive` also rejects `removed`; webhook ingress already only accepts `connected|reauth_required`.
4. Tests first: facade spec with fakes, store integration spec (Testcontainers), webhook ingress integration spec, conversation receive spec, http contract spec.
5. Web: `useRemoveChannels` hook (partial failures, like bulk update), `ConnectionCard` row menu, toolbar bulk button, ConfirmDialog usage, i18n vi/en, component tests, e2e touch-up if the integrations page is covered.
6. Docs + MODULE.md; run `pnpm check`.

Data-model choice: a new `removed` status instead of a `removed_at` column. Every status-gated path (ingress `inArray(status, [connected, reauth_required])`, `deliver`, bot replies, fanpage actions) already fails closed on any status other than the live ones, so a new status is strict by default and needs no extra predicate everywhere; one nullable column would require every reader to remember it. The migration only replaces a CHECK constraint (additive, no data rewrite). Trade-off: pods still running pre-T-133 code cannot parse a `removed` row in `GET /channels`; deploy order is migration, then code, and removal is only reachable from the new UI.

## Log

- 2026-10-29 — created. Verified: `apps/webhook/src/infrastructure/meta-ingress.store.ts` only accepts `connected`/`reauth_required`; `ConversationFacade.receive` rejected only `disconnected` (to be tightened); `channel.store.ts` `select()` upserts on (provider, external_id) and sets status `connected`.

- 2026-10-29 — Root review: migration renumbered 0029 → 0033 because the open lane A2/A3 branches already use 0029–0032 (runner tracks files by name, so out-of-order application is safe).
- 2026-10-29 — Independent QA review: no blockers; fixed every should-fix. (1) Inbox reads `GET /channels?includeRemoved=true` under its own query key so old conversations keep the page name; the page filter leaves removed pages out; the thread shows a "page removed" notice and locks the composer. (2) `deliver` on a removed page fails with `page_removed`, not `reauth_required`. (3) Runtime 403 test: a `sales` member gets 403 from the global guard and the page stays (replaces the metadata-only assertion). (4) Web treats a DELETE 404 (already removed elsewhere) as success — test verified red without the fix. Also: DB write before the Meta unsubscribe (token captured first; failed write leaves the page connected and subscribed; tested), doc timeout 5→8 s, MODULE.md migration number, permission comment. Backend channel+HTTP 92/92, store integration 12/12, web conversation+channel 313/313.

- 2026-10-29 — Landed on main de04081 after independent review and the branch gate (pnpm check green; load-induced timeouts in untouched suites passed when rerun alone). Closed.

## Links

- Docs: `docs/meta-inbox.md`
- Related tasks: T-049 (page release on disconnect, partially addressed here: webhook unsubscribe on removal)
