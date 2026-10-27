---
id: T-096
title: Rebuild the inbox core around the Meta Business Suite layout
status: done
type: feature
priority: P1
owner: '@agent:claude'
feature_ids: []
created: 2026-10-27
updated: 2026-10-27
branch: feat/T-096-meta-inbox-core
pr:
parent:
---

## Context

The product owner asked to rebuild the inbox to look and work like the Meta Business Suite inbox, following the T-095 BA specification ([business spec](../../docs/business/rapiz-inbox-meta-ba.vi.md), [handoff](../../docs/handoffs/2026-10-27-meta-inbox-spec.md)). On 2026-10-27 the owner chose the **inbox core slice** (spec §16 steps 2–3) and accepted the spec's proposed defaults for the open decisions:

- Star = follow/priority (the "Ưu tiên" quick filter). "Trao đổi thêm" = the existing follow-up reminder (`followUpAt`), not a second flag.
- Read state stays shared per workspace.
- A new customer message reopens a Done conversation; Spam never reopens by itself; real deletion is not implemented.

Brand stays Rapiz (orange), not Meta blue. The global app sidebar is unchanged.

## Goal

Staff work the inbox in Meta's three-region layout (list · thread + composer · customer panel) with channel tabs, quick and advanced filters, Done/Spam folders, star, bulk management and a sectioned customer panel, without losing any working Rapiz capability.

## Scope

Requirement IDs from the business spec:

- Layout and context: INB-UX-01…06, INB-CTX-01, INB-CTX-04 (existing keyed reset kept).
- Channel tabs and list: INB-LST-01…04 (all messages, Messenger, Instagram; Facebook comments tab explains and links to the existing comment screen; WhatsApp / Instagram comments shown as not supported).
- Search and filters: INB-SRC-01, INB-SRC-03, INB-FLT-01 (unread, priority = star, follow-up; ad replies hidden — no source data), INB-FLT-04…10 (advanced filter with Apply / Clear all / close-discards).
- Lifecycle: INB-STA-01…03, INB-STA-05…07 with the folder send policy table (staff must reopen Done/Spam before replying; bot already blocked outside `open`).
- Assignment and bulk: INB-ASG-01…02, INB-BLK-01…02 (select visible, per-item results, retry failed only).
- Thread and composer: INB-MSG-01…02, INB-CMP-01…03, INB-CMP-05…08 (emoji picker, quick 👍 send only when the draft is empty), INB-SEND-01.
- Customer panel: INB-CRM-01, INB-CRM-06 (tags move into the panel), INB-CRM-08 (conversation notes, labelled), INB-CRM-10 (images shared in the loaded thread, labelled as such), INB-CRM-11 (kept).
- Rapiz specifics: INB-RPZ-01…05 kept.

## Out of scope

Each is a separate task (see Log for the follow-up list): comment parity inside the inbox (INB-COM-*), automation (INB-AUT-*), inbox settings (INB-SET-*), calls/payments, real delete/block/report (INB-STA-04, INB-CRM-12), lead quality/stage and ad-reply filters (INB-FLT-02/03, INB-CRM-04), commerce markers (INB-CRM-05), availability/tasks/notifications (INB-OPS-*), file upload (INB-CMP-04), shop/bot filters (T-087), server-synced saved views, persistent drafts, activity-ordered sort that ignores control updates (INB-LST-04 partial).

## Acceptance criteria

- [x] Desktop shows list · thread · panel with Meta's region order; the panel collapses; narrow screens show list → thread → panel with back navigation and drafts kept.
- [x] Channel tabs filter by provider; the comments tab explains and links to the comment screen; unsupported tabs are not clickable fake lists.
- [x] Quick filters (unread, waiting, priority, follow-up) apply immediately and show their state; the advanced filter only changes the list on Apply, Clear all resets the form, closing discards edits.
- [x] Counts come from the server for the whole filtered set and ignore only the queue tab.
- [x] A conversation can be starred/unstarred without touching read state or folder; the priority filter matches.
- [x] Done and Spam are folders: Done/Spam leave the main queue; Spam can be viewed and restored; a customer message reopens Done but not Spam; staff sends from Done/Spam are rejected (409) and the UI offers reopen.
- [x] Bulk mode selects visible rows only, runs done/reopen/spam/star/unstar/read/unread/assign/clear-follow-up, reports per-item failures and retries only the failed ones; changing tab/filter/search clears the selection.
- [x] Composer: icon row (attach, quick replies, emoji, products), Enter sends / Shift+Enter newline / IME-safe, 👍 quick send only with an empty draft, drafts and safe retry unchanged.
- [x] Customer panel: profile header, contact, tags (library from Customer settings), notes, orders, follow-up, shared images.
- [x] Cross-tenant test for the bulk endpoint; unit tests for filters, lifecycle, bulk and the new UI behaviour.
- [x] `pnpm check` green; docs updated (`docs/meta-inbox.md`, `docs/18-sales-inbox-workspace.md`).

## Plan

1. **Contracts** (`packages/contracts/src/conversation`): `status` gains `spam`; `starred: boolean` (default false); list query gains `starred`, `followUp`, `status` accepts `spam`; `UpdateConversationRequest` gains `starred`; new `BulkConversationRequest` / `BulkConversationResponse` + route `POST /conversations/bulk` (max 100 ids, per-id result).
2. **Backend domain/store**: filter semantics for `starred` / `followUp` in `conversation-filter.ts` (reference) and `conversation.store.ts` (SQL on `data` jsonb — no migration); `applyControlUpdate` handles `starred`; inbound keeps `spam` (no reopen) while Done reopens; staff `send` rejects non-open conversations with `CONFLICT`. Bulk in the facade: each id runs the existing single-update path in its own transaction, results collected; assignment validated once. Tests: domain unit, inbox-v2 spec, store integration incl. cross-tenant bulk.
3. **Web list**: header with title + insights link; channel tab bar; search + "Quản lý"; quick filter row; advanced filter popover with Apply/Clear; folder indicator; rows with star and bulk checkboxes; bulk action bar with partial-failure toast and retry.
4. **Web thread**: Meta-style header (avatar, name, assignee subtitle menu, icon actions with tooltips: spam, star, unread, done; reply mode + more + panel toggle kept); Meta bubbles (outbound primary, inbound muted with avatar, time separators); reopen banner for Done/Spam.
5. **Web composer**: single box, placeholder "Trả lời trong {{channel}}…", icon row, emoji popover, 👍 quick send.
6. **Web panel**: profile header + collapse; sections Giới thiệu (contact/CRM link), Nhãn (tag bar moved here), Ghi chú, Đơn hàng, Hẹn chăm sóc lại, Ảnh được chia sẻ.
7. **i18n** vi/en; **docs**; follow-up tasks for out-of-scope items; `pnpm check`; fresh-context review; manual run against the local stack with synthetic data only.

Risks: status enum widening touches every consumer — typecheck catches them; the Meta UI could not be attached through Playwright (owner's Chrome has no remote debugging), so the two owner screenshots + spec are the visual reference (no pixel-parity QA per owner preference).

## Log

- 2026-10-27 — created. Owner chose the inbox core slice, the spec's proposed defaults and a fresh worktree from main. T-095 spec files carried into this branch as their own commit.
- 2026-10-27 — The owner's Chrome (profile Tùng) runs without remote debugging, so the Playwright MCP browser could not attach to the live Meta inbox. The two owner screenshots plus the T-095 spec were the visual reference; no action was taken on the owner's Meta account.
- 2026-10-27 — Backend: `spam` status, `starred`, `starred`/`followUp` list filters (document fields, no migration), staff send on Done/Spam → 409, `POST /conversations/bulk`. Changed behaviour: the T-068 HTTP test replied on a resolved conversation; it now asserts 409 and reopens first (spec folder send policy). Unit, SQL-integration (incl. cross-tenant bulk) and HTTP tests added.
- 2026-10-27 — Web: Meta layout, channel tabs, quick + draft advanced filters, manage/bulk mode, header icon actions, Messenger bubbles, composer icon row with emoji and 👍, sectioned panel (portalled into a page-owned region so the list never remounts). Removed the replaced `ChannelFilter` and tag-bar-expanded hook with their tests.
- 2026-10-27 — Verified: `pnpm check` green (one pre-existing `max-lines` warning on `conversation.facade.impl.ts`, 552 → 562 lines). Playwright e2e inbox-sales, inbox-layout, lane-b-workflows, smoke: 22/22 pass after updating three tests for the new behaviour (apply-to-filter, renamed "Giới thiệu" section, two "Mở lại" entry points). `responsive.spec.ts` fails on non-inbox pages (order settings, contacts) on main 9265c3c too (5 failures there, 4 here) — pre-existing, not touched. Manual run on a local stack with a synthetic QA workspace (signup + seeded fake conversations, no real customers): desktop 1600px and mobile 390px flows, bulk Done, Done folder + reopen banner, filter draft/apply. Found and fixed during QA: nested button in bulk rows, wait clock on Done rows, duplicate folder chip, page growing 1900px from the order form (missing `relative`).
- 2026-10-27 — Fresh-context review (Sonnet, read-only): no blockers. Fixed: star-only changes no longer bump revision/updatedAt (they dropped queued bot replies), bulk reports unexpected errors per id as `INTERNAL`, bulk count/act on visible ticked rows only, `E` on Spam restores instead of filing it as Done, a 409 send explains the folder change and reloads, leaving for the comments tab resets selection. Not changed (minor, noted): filter popover tab/radio keyboard semantics, draft not re-synced if the list state changes while the popover is open.
- 2026-10-27 — After the review fixes one `pnpm check` run reported 17/18 tasks; its log was discarded before inspection (disk nearly full), and the immediate rerun passed with exit 0. Treat as unexplained, likely environment.
- 2026-10-27 — Independent acceptance QA (Sonnet agent, Playwright on the local stack, synthetic fixtures: 2nd business "QA Shop B" with a same-name customer, an analyst and a sales member added directly to the QA workspace because the free plan has one seat). PASS: layout 1440/1280, mobile 390 flow, channel tabs, quick filters, advanced filter draft/apply/clear/AND, star, Done/Spam/restore + reopen banner + `E`, mark unread (INB-AT-04), bulk select/act/clear (INB-AT-06 partial), assignment, composer (Enter/Shift+Enter, Vietnamese diacritics, emoji, 👍, per-conversation drafts INB-AT-09, double Enter → one message INB-AT-08), panel sections, business isolation (INB-AT-01), concurrency (INB-AT-07: stale send refused with draft kept, stale change rejected), keyboard shortcuts, focus/aria, dark mode, 0 console errors. Not testable here: long-thread scrolling, bulk per-item failure in the UI, shared-image rendering, inbound messages (Done reopen covered by backend tests), real channels.
- 2026-10-27 — Defects from that pass, fixed and re-verified in the browser by the implementer: D1 row time jumped to the action time after assign/resolve → control changes no longer bump `updatedAt` (list ordered by activity, INB-LST-04; backend test added); D2 the announced count ignored the queue tab and stale placeholder rows → tab-aware and hidden while refreshing; D3 analyst saw an enabled composer and a vague error → view-only banner, composer locked, FORBIDDEN explained; D4 note field cleared only after the save round-trip → cleared at once, restored on failure; D5 the open conversation stayed open under a tab of the other provider → closed. Not fixed (low, recorded): D6 a failed send can show two toasts; D7 emoji buttons are labelled by the emoji itself; browser Back on mobile leaves the inbox instead of stepping back (no per-pane history); analysts are offered as assignees.
- 2026-10-27 — After these fixes: `pnpm check` exit 0 (an earlier run failed once on `integrations-view.test.tsx` with a 5 s timeout under parallel load — a file this task does not touch; it passes 3/3 in isolation and on rerun; this also explains the earlier unexplained 17/18 run). E2E inbox-sales, inbox-layout, lane-b-workflows, smoke: 22/22.
- 2026-10-27 — Machine disk was 100% full during QA (not caused by this task); temporary QA files were removed.

Follow-ups (not in this slice; to be created as tasks after owner review): comment threads inside the inbox (INB-COM-*), automation (INB-AUT-*), inbox settings (INB-SET-*), delete/block/report (INB-STA-04, INB-CRM-12), lead quality/stage and ad-reply filters (INB-FLT-02/03, INB-CRM-04), commerce markers (INB-CRM-05), availability/tasks/notifications (INB-OPS-*), direct upload (INB-CMP-04), shop/bot filters (T-087).
- 2026-10-27 — Rebased on `main` after the website chat channel (T-097..T-104) landed: conflicts in the contracts schema, facade, list and view resolved keeping both sides; the website channel got its own inbox tab and composer label. `pnpm check` green; e2e inbox, website chat, statistics, fanpage, lane B and smoke 40/40. Pushed directly to `main` (owner-approved); status done.

## Links

- [Business specification](../../docs/business/rapiz-inbox-meta-ba.vi.md)
- [Implementation handoff](../../docs/handoffs/2026-10-27-meta-inbox-spec.md)
- [T-095 spec task](T-095-write-meta-business-suite-inbox-functional-specifi.md)
- [T-086 original refinement](../T-086-refine-the-sales-inbox-around-the-agreed-pancake-w.md)
