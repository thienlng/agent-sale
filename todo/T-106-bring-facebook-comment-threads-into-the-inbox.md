---
id: T-106
title: Bring Facebook comment threads into the inbox
status: review
type: feature
priority: P1
owner: '@agent:claude'
feature_ids: []
created: 2026-10-27
updated: 2026-10-28
branch: feat/T-106-facebook-comments-inbox
pr:
parent:
---

## Context

On 2026-10-27 the product owner approved the brainstormed parallel split: external Claude implements Facebook comments inside Inbox; Codex writes its spec and implements DM draft continuity and personal Enter settings. This continues the T-095 specification and T-096 core.

## Goal

Handle received Facebook comments directly in Inbox with correct context and safe public/private/moderation actions.

## Scope

Implement the approved handoff: Facebook-only comments workspace, Page/post selection, server pagination over stored comments, detail context and existing reply/hide/unhide actions. Preserve T-069 safety and follow T-107 file ownership.

## Out of scope

Generic automation, background reminders, direct upload/private storage design, Instagram comments, deletion/block/report, shop/tenant model changes, global sidebar or unrelated screens. No live customer mutations.

## Acceptance criteria

- [x] C01–C13 of the handoff are verified with synthetic data.
- [x] Existing fanpage settings and DM inbox remain compatible; no cross-feature imports.
- [x] New read/action contracts have validation, permission and cross-tenant tests.
- [x] Targeted browser checks, pnpm check and fresh-context QA pass; live limitations are stated.

## Plan

Approved scope is the handoff. Gaps found in the current code before coding:

- `GET /fanpage/comments` returns a fixed latest-100 page with no cursor, filter or detail lookup.
- `POST …/actions` uses workspace-member authorization only (an analyst can reply/hide).
- The manual path revalidates the source only for a private reply without a snapshot; the public-output phone/email guard exists only inline in the automatic processor.
- `context()` writes a snapshot and can mark review, so it is not a getter.
- No conversation lookup by Meta scoped id exists, so "Open DM" cannot be resolved honestly: FB-06 ships the explanation path only.

Steps (one commit each where practical):

1. **Shared guard** — move the processor's phone/email regex to `@agent-sales/shared` (`exposesContactDetails`), reuse it in the processor unchanged, unit-test it.
2. **Contracts (additive)**
   - `FanpageCommentListQuery` (`limit` 1–50, `cursor`, `postId`, `q`) and `nextCursor` on the list response.
   - `FanpageCommentDetail` (comment, stored parent, eligibility).
   - `FanpageCommentSource` (fresh read-only fetch result).
   - `FanpageCommentPost` (known stored posts).
   - Optional `version` and `confirmPublicContact` on `FanpageManualAction`.
   - Routes registered in `channel.routes.ts`. No query keeps the legacy latest-100 behavior.
3. **Store**
   - `page()` with keyset `(updated_at desc, comment_id desc)` under workspace + connection, with post and text/author filter.
   - `get()`, a pure read with no lock.
   - `posts()`, distinct stored post ids with count and latest activity.
   - Memory store parity. Integration tests on Postgres: >100 rows with equal `updated_at`, no dup/skip, filter matches only on later pages, RLS/foreign workspace.
4. **Facade**
   - Cursor encode/decode bound to connection/post/q (malformed or mismatched → 400).
   - Detail: no writes; the eligibility projection.
   - `source()`: Graph read with no comment write.
   - Manual `act()` always revalidates against Graph (text/author/deleted/version) before reserving.
   - Stale or unavailable → actionable 409/422.
   - Public contact guard needs explicit confirmation.
   - Reservation/idempotency rules unchanged.
   - Unit tests for each rule, including that the automatic path is unchanged.
5. **Controller**
   - `GET comments?…`, `GET comments/:commentId`, `GET comments/:commentId/source`, `GET comment-posts`.
   - `@RequireCapability('contacts.edit')` on POST actions. `contacts.edit` = owner/admin/sales/care; analyst lacks it.
   - HTTP integration test: analyst 403 on direct action, foreign workspace/page/cursor rejection, detail does not change `updated_at`.
6. **Web data layer** (`features/channel/api/fanpage-comments.ts`)
   - Infinite list, detail, source, posts and action hooks. The settings screen keeps `useFanpage`.
   - A module-level draft/attempt store keyed `user/workspace/connection/comment/mode`, with attempt UUID reuse for unconfirmed transport failures and reconciliation by request id.
7. **Web UI** (`features/channel/components/comments-workspace/…`)
   - Page picker (auto-select sole, remember last), post selector, server search, list with Load more, detail (post card, parent, comment, local action history with honest scope labels), hide/unhide with uncertain state, Public/Private composer (Enter = newline, explicit Send, target shown, contact-guard confirm, private eligibility explanation).
   - Mobile list ↔ detail with Back.
   - i18n under `channelInbox.commentsWorkspace.*`.
   - Composed through a new `renderComments` slot on `InboxPage` from `routes/app/inbox.tsx`; no conversation → channel import. Component tests per behavior.
8. **Browser suite** `apps/web/e2e/inbox-comments.spec.ts` with mocked API: C01–C05, C07, C08, C10–C12 flows, 390px and dark mode.
9. **Docs**: `docs/integrations/facebook-comments.md` (API table, pagination, permission, manual validation), `docs/18-sales-inbox-workspace.md` comments tab.

Risks:

- Cursor stability while rows are updated: keyset on activity may move an updated row to the top. That is acceptable and documented; it is never duplicated within one scan.
- Graph revalidation adds one read per manual action.
- `inbox-page.tsx`/i18n are shared with T-107: keep patches minimal and rebase before landing.

## Log

- 2026-10-27 — Created from the approved parallel block. Codex authored the T-106 handoff before application implementation. T-106 remains next for external Claude; only T-107 is active locally.
- 2026-10-27 — Claimed by @agent:claude on `feat/T-106-facebook-comments-inbox` (worktree `agent-sale-t106`, based on the spec commit 466b256). Owner asked in chat to plan, implement and QA directly, so no draft-plan PR wait (the `gh` CLI is unavailable here; direct landing is allowed by T-105). Open DM after a private reply is not resolvable with current data (no conversation lookup by scoped id): ships as an explanation, per FB-06.
- 2026-10-28 — Implemented per plan (backend contracts/store/facade/controller, web workspace via route slot, docs). Verification:
  - Backend unit 1097/1097. Integration: `fanpage.store` (130 rows with equal µs `updated_at`), `fanpage-comments` HTTP (analyst 403 on all action kinds, foreign workspace/Page 404, foreign cursor 400, detail/source do not bump `updated_at`), `inbox-v2`.
  - Web unit 456+, e2e `inbox-comments.spec.ts` (desktop, 390 px, keyboard, dark mode) green. `pnpm check` green.
  - `e2e/responsive.spec.ts` fails 5 tests (contact drawer heading); the same 5 fail on the baseline 466b256, unrelated to T-106.
- 2026-10-28 — Fresh-context QA (sonnet agent, review-pr checklist): no blockers. Fixed:
  - (1) cursor limit 500 → 2000, since q/postId are embedded;
  - (2) a retried request id returns `null` before the source check, so a lost-answer retry after an edit/delete can't invite a duplicate;
  - (3) a new public attempt after an unknown/unmatched outcome needs explicit confirmation;
  - permalinks with credentials are rejected;
  - 503 UNAVAILABLE (raised before reservation) is a refusal, not a locked "unconfirmed".
  Accepted as-is/follow-up: the source GET marks `reauth_required` on an expired token (same as the existing `readGraph`); the list refetches all loaded pages every 15 s; the post selector is capped at 200 stored posts; text search is an `ilike` scan per connection (no trigram index yet).
- 2026-10-28 — Not live-verified (no Meta calls in tests): Graph reads of hidden comments for unhide revalidation, the id-based post link fallback, and real feed webhook ordering. Pre-existing gap found, out of scope: `PATCH /fanpage/settings` has no capability check (an analyst can change automation settings), so a follow-up task was created.

## Links

- [T-106 functional/implementation handoff](../docs/handoffs/T-106-facebook-comments-inbox.md)
- [Meta-style BA specification](../docs/business/rapiz-inbox-meta-ba.vi.md)
- [Current sales workspace](../docs/18-sales-inbox-workspace.md)
- [Current comment behavior](../docs/integrations/facebook-comments.md)
