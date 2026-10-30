# Inbox acceptance

Run ordinary own-thread cases in LIVE and deterministic multi-record/error/role cases in ISOLATED. A mode, unread marker, CRM status, conversation tag and CRM contact tag are different fields. The authoritative sources are the current UI, contracts and source events; older prose sections in the inbox documentation predate the current layout.

<a id="inb-001"></a>

## INB-001 — Channel tabs and unsupported entries

- **Priority / environment:** P1 / ISOLATED.
- **Preconditions and data:** I plus Instagram/website fixtures and C.
- **Steps:** Visit all messages, Messenger, Instagram, Website and Facebook comments; keyboard-focus unsupported WhatsApp/Instagram-comments labels.
- **Expected result:** Each supported tab shows only its own kind/provider; comments open the comment workspace rather than a DM list; unsupported entries explain absence and never claim an empty connected inbox.
- **Independent evidence:** Provider IDs/types in source manifest and each visible list; no cross-tab mutation.
- **Cleanup:** Reset tab/filter.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="inb-002"></a>

## INB-002 — List identity, ordering and latest preview

- **Priority / environment:** P1 / LIVE + ISOLATED.
- **Preconditions and data:** L/I; distinct last messages, timestamps, pages, unread and assignee states.
- **Steps:** Inspect avatar/name/page/provider, preview, timestamp, unread/star/handler markers; receive a new QA message while another conversation is open.
- **Expected result:** Correct identity and safe fallback names; preview/sort match latest source event; selected thread is not replaced by another conversation; no duplicate list row after polling.
- **Independent evidence:** Raw eligible conversation/message IDs, last-event timestamps and visible previews.
- **Cleanup:** Restore L or reset I.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="inb-003"></a>

## INB-003 — Inbox search correctness and out-of-order results

- **Priority / environment:** P1 / ISOLATED.
- **Preconditions and data:** I with unique name/message/phone matches and no-match term.
- **Steps:** Search each supported field; try whitespace, diacritics, no result and long input; type two queries rapidly while delaying the first response; clear search.
- **Expected result:** Result set exactly matches server-supported search semantics; unsupported field behavior is documented, not invented; old-query response cannot overwrite new results; clear restores scope. Search text never leaks into saved view.
- **Independent evidence:** Independent matching of fixture source fields, actual request q and visible IDs; document accent/case behavior if not specified.
- **Cleanup:** Clear search and faults.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="inb-004"></a>

## INB-004 — Unread state and server counts

- **Priority / environment:** P1 / LIVE + ISOLATED.
- **Preconditions and data:** L/I; include unread and read conversations; isolated set larger than list limit.
- **Steps:** Observe unopened incoming; open it; use mark-unread while thread remains selected; navigate away/back; compare unread tab/count and a second authorized tab.
- **Expected result:** Opening marks read as designed; explicit unread is not immediately cancelled by a repeated auto-read; count uses matching server population, not only loaded rows; actor/read time and multi-tab state consistent.
- **Independent evidence:** Read source fields/count manifest before/after and list requests; count unread conversations, not sum unread messages.
- **Cleanup:** Restore own-thread unread state as far as possible; disclose read receipt effects.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="inb-005"></a>

## INB-005 — Waiting queue and longest-wait sorting

- **Priority / environment:** P1 / ISOLATED.
- **Preconditions and data:** I with customer-last, successfully-replied, read-not-replied and failed-reply variants.
- **Steps:** Select waiting tab; test any/longest/read-not-replied; reply successfully to one; inject failed reply to another.
- **Expected result:** Waiting membership and awaiting-since follow source sender/delivery contract; successful reply removes eligibility, failed attempt does not pretend to answer; oldest waits sort first; unread and waiting may overlap, never assumed disjoint.
- **Independent evidence:** Message sender/sent status/read time and awaitingSince manifest; compare exact IDs/order/count.
- **Cleanup:** Reset I.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="inb-006"></a>

## INB-006 — Priority, follow-up quick filters and intersections

- **Priority / environment:** P1 / LIVE + ISOLATED.
- **Preconditions and data:** L/I, starred and unstarred, follow-up set/unset variants.
- **Steps:** Toggle own priority; apply priority and follow-up quick filters separately and together with search/provider/tab; clear each.
- **Expected result:** Each intersection equals matching fixture IDs; counts and active UI reflect current filters; follow-up-set filter does not falsely mean overdue only; unrelated filters stay intact.
- **Independent evidence:** Star/followUpAt source values and independent set intersection.
- **Cleanup:** Restore L star/follow-up; reset I.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="inb-007"></a>

## INB-007 — Advanced filter draft, apply, cancel and reset

- **Priority / environment:** P1 / ISOLATED.
- **Preconditions and data:** I with existing search/provider/quick filters.
- **Steps:** Change several advanced options and close without Apply; reopen/apply; use Reset then cancel; finally Reset and Apply; remove individual filter chips.
- **Expected result:** Unapplied edits discarded; apply changes intended groups once; reset only advanced fields, preserving search/tabs/quick filters; badge/chips match applied groups and removals.
- **Independent evidence:** Outgoing query parameters and matching source sets, compared after each action.
- **Cleanup:** Restore default filters.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="inb-008"></a>

## INB-008 — Tag ANY, ALL, EXCLUDE and untagged logic

- **Priority / environment:** P1 / ISOLATED.
- **Preconditions and data:** I1 A, I2 A+B, I3 none; all same base scope for this variant.
- **Steps:** Run ANY A/B, ALL A+B, EXCLUDE A, and untagged; combine inclusion/exclusion; choose a previously excluded tag as included.
- **Expected result:** ANY returns I1/I2, ALL only I2, EXCLUDE A only I3 in this three-record variant, untagged only I3; conflicting tag choices are cleared consistently; no impossible hidden filter persists.
- **Independent evidence:** Set membership from conversation tag assignment records, not CRM contact tags.
- **Cleanup:** Reset tag filters.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="inb-009"></a>

## INB-009 — Assignee, mode, page and phone filters

- **Priority / environment:** P1 / ISOLATED.
- **Preconditions and data:** I; current caller S1; second member S2; two pages; phone yes/no source fields.
- **Steps:** Individually test all/me/unassigned/specific member, bot/human, page P1/P2 and has/no phone; run a combined intersection and clear.
- **Expected result:** Each result exactly matches supported conversation fields in current business; no colleague or page from other business; phone does not infer a CRM match solely by display name; counts match filtered population.
- **Independent evidence:** Conversation source fields plus request scope and manually computed intersections.
- **Cleanup:** Reset filters.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="inb-010"></a>

## INB-010 — Resolved, spam and reopen folders

- **Priority / environment:** P1 / LIVE + ISOLATED.
- **Preconditions and data:** L own thread or I; original folder recorded.
- **Steps:** Resolve, locate via Done, edit a draft but attempt send; reopen. In isolation repeat Spam and more-menu reverse action; receive a new input in each folder.
- **Expected result:** Correct folder banner/action; sending blocked until reopen with draft retained; status persists after reload. Automatic reopen/spam behavior on new input is checked against server transition contract; if unspecified, record decision rather than assume.
- **Independent evidence:** Persisted conversation.status, eligible list IDs and blocked-send request absence.
- **Cleanup:** Restore original L status; reset I.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="inb-011"></a>

## INB-011 — Assignee menu and stale-write protection

- **Priority / environment:** P1 / LIVE + ISOLATED.
- **Preconditions and data:** L own assignment or I with S1/S2; record original assignee/revision.
- **Steps:** Assign to self, unassign, assign S2 in isolated fixture; alter same conversation from second tab before first-tab change.
- **Expected result:** Changes persist and reflect names correctly; assignment does not silently equal bot mode or CRM sales-owner change; stale write is rejected/reconciled without overwriting newer state.
- **Independent evidence:** Conversation revision/assignee source, CRM owner unchanged and conflict response.
- **Cleanup:** Restore original assignee; reset I.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="inb-012"></a>

## INB-012 — Thread layout, history and search

- **Priority / environment:** P1 / LIVE + ISOLATED.
- **Preconditions and data:** L/I with long thread, >30-minute gap, bot/staff/customer messages and loaded-window boundary.
- **Steps:** Inspect grouping/times/senders/delivery; use search-in-thread; search loaded and unloaded tokens; scroll older while new message arrives; jump to latest.
- **Expected result:** Correct actor attribution and order; new message does not yank reading position; latest action reaches new message; search only promises loaded history and labels limits, never silently claims all-history results.
- **Independent evidence:** Source message order/IDs/times and known loaded window; screen capture of scroll behavior.
- **Cleanup:** Clear thread search and return to latest.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="inb-013"></a>

## INB-013 — Text send, whitespace and length boundaries

- **Priority / environment:** P0 / LIVE + ISOLATED.
- **Preconditions and data:** Human mode; L short text, isolated 1999/2000/2001-character variants.
- **Steps:** Send one uniquely tagged reply; double-click Send; try whitespace-only and length boundaries; reload after final result.
- **Expected result:** One provider delivery for one accepted attempt; exact text preserved; empty input cannot send blank text; configured 2000-character limit enforced without silent message corruption; successful send clears only that original draft.
- **Independent evidence:** Messenger delivery plus idempotency/message source records; rejected attempts produce no provider send.
- **Cleanup:** Restore L; reset isolated boundary fixtures.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="inb-014"></a>

## INB-014 — Empty composer thumbs-up sends a real message

- **Priority / environment:** P1 / LIVE.
- **Preconditions and data:** L, human mode, empty draft.
- **Steps:** Click empty-composer thumbs-up once; inspect Messenger, thread and list preview.
- **Expected result:** Exactly one actual thumbs-up message is delivered and stored with staff attribution; the icon is not treated as a local reaction or a no-op.
- **Independent evidence:** Messenger and successful outbound source message.
- **Cleanup:** Restore L; retain disclosed test message.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="inb-015"></a>

## INB-015 — Enter preference, Shift+Enter and IME

- **Priority / environment:** P1 / LIVE + ISOLATED.
- **Preconditions and data:** L safe draft; synthetic send harness for key-edge variants.
- **Steps:** Test Enter-to-send on/off, Shift+Enter, explicit Send, Vietnamese IME composition, slash selection and modified/repeated keys; reload preference.
- **Expected result:** Preference changes only this user/device; Shift+Enter newline; IME confirmation never sends; slash Enter selects a reply before sending; preference persists independently of business; other user unaffected.
- **Independent evidence:** Textarea value/caret, send request count and preference keys; Messenger only for explicitly sent live text.
- **Cleanup:** Restore original preference; clear QA draft.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="inb-016"></a>

## INB-016 — Draft switching, reload and scope isolation

- **Priority / environment:** P0 / LIVE + ISOLATED.
- **Preconditions and data:** Own L and I second thread/business/user/channel.
- **Steps:** Write unsent text; switch thread and return; reload/close-reopen tab; switch business; sign out only isolated account.
- **Expected result:** Text restored only to original user/business/channel/conversation; no auto-send on restoration; logout/expiry removes private drafts; another person/device cannot see them. Lifetime/capacity variants are covered by QLT-006.
- **Independent evidence:** Draft contents and scope keys without dumping unrelated private storage; network confirms no unsolicited send.
- **Cleanup:** Clear only QA drafts; leave owner logged in.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="inb-017"></a>

## INB-017 — Two-tab draft conflict and send completion race

- **Priority / environment:** P0 / ISOLATED.
- **Preconditions and data:** Two tabs same QA conversation; intentionally delayed send.
- **Steps:** Edit same draft concurrently; resolve Use latest/Keep this text; start send then type newer text elsewhere; simultaneously attempt same draft send in both tabs.
- **Expected result:** Conflict explicit and sending blocked until resolution; latest edits not overwritten by old completion; same original draft shares send identity and cannot create duplicate delivery; logout in another test tab invalidates stale callbacks.
- **Independent evidence:** Draft revisions, shared request identity, provider stub call count and persisted messages.
- **Cleanup:** Close tabs/reset I.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="inb-018"></a>

## INB-018 — Quick replies and slash insertion

- **Priority / environment:** P1 / LIVE + ISOLATED.
- **Preconditions and data:** Approved QA quick reply from current bound bot; text with selected substring.
- **Steps:** Insert via menu at caret/selection; type slash and navigate matches with arrows/Enter/Escape; change bot/business in isolated variant.
- **Expected result:** Insertion preserves surrounding text, never sends automatically; correct bot library; keyboard selection and dismissal work; empty/error/no-bot states honest.
- **Independent evidence:** Expected composed string and zero provider sends before explicit Send; quick-reply source IDs.
- **Cleanup:** Clear QA draft; no library changes live.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="inb-019"></a>

## INB-019 — Emoji and product sharing

- **Priority / environment:** P1 / LIVE + ISOLATED.
- **Preconditions and data:** Existing approved product K/variant and an editable text draft.
- **Steps:** Insert emoji at caret; select K variant using product tool; inspect inserted name/variant/price; cancel and retry; explicitly send approved sample only.
- **Expected result:** No replacement of unrelated draft text; price/name match selected current variant; selection alone does not send or create order; unavailable product states explained.
- **Independent evidence:** Catalog variant source and composed text, then Messenger for actual send.
- **Cleanup:** Clear unsent QA draft or restore L after sent sample.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="inb-020"></a>

## INB-020 — Attachments, validation and explicit delivery

- **Priority / environment:** P1 / LIVE + ISOLATED.
- **Preconditions and data:** Harmless approved public HTTPS QA image/library asset; invalid URLs only in isolation.
- **Steps:** Pick library image, preview, remove; choose HTTPS asset and send explicitly; try HTTP/malformed/oversized URL in isolation; combine text and selected attachment.
- **Expected result:** Preview before send; remove sends nothing; attachment and text follow separate explicit actions; selected asset reaches Messenger once; invalid input rejected; no claim of direct upload capability.
- **Independent evidence:** Image/file source URL, provider outcomes and Messenger display; no hidden text send alongside attachment.
- **Cleanup:** Remove QA selections; restore L.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="inb-021"></a>

## INB-021 — Definitive send failure and uncertain delivery

- **Priority / environment:** P0 / ISOLATED.
- **Preconditions and data:** Dedicated provider stub: definitive failure, network loss after server acceptance, pending and unknown.
- **Steps:** Send each variant; refresh/remount; click permitted retry or status check; recover provider.
- **Expected result:** Definitive failure preserves draft and offers explicit retry; unconfirmed transport reuses original key; pending/unknown stays explicit and never becomes false success; recovery produces at most one actual send per authorized attempt.
- **Independent evidence:** Provider stub calls keyed by attempt, persisted send records/status and restored draft; response alone insufficient.
- **Cleanup:** Reset I/provider faults.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="inb-022"></a>

## INB-022 — Send while switching conversation

- **Priority / environment:** P0 / ISOLATED.
- **Preconditions and data:** I1/I2; delayed reply and delayed attachment success.
- **Steps:** Start I1 send; navigate I2 and type new draft; let I1 finish; return I1; repeat after logout and after failure.
- **Expected result:** Completion clears/updates I1 only, never I2 text; correct message remains in I1; stale session cannot mutate a new session; failure remains actionable on original thread.
- **Independent evidence:** Captured request conversation/workspace and both draft/message source records.
- **Cleanup:** Reset I.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="inb-023"></a>

## INB-023 — Closed window, disconnected source and view-only compose

- **Priority / environment:** P0 / ISOLATED.
- **Preconditions and data:** Expired messaging eligibility, unavailable channel and contacts.edit-denied variants from actual backend policy.
- **Steps:** Open each thread; type draft; try text/like/attachment send; restore eligibility in fixture and reopen.
- **Expected result:** Clear reason and prohibited send disabled or rejected server-side; draft retained; successful response not fabricated. Never assume a fixed Meta eligibility rule without checking current adapter policy.
- **Independent evidence:** Capability/channel state, refused responses and provider stub confirms zero sends.
- **Cleanup:** Reset fixtures.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="inb-024"></a>

## INB-024 — Conversation tag library and persistence

- **Priority / environment:** P1 / LIVE + ISOLATED.
- **Preconditions and data:** QA conversation tag; same-named distinct IDs in another isolated business.
- **Steps:** Add/remove/re-add tag; close picker without select; double-click; reload; open management link; test stale revision/error.
- **Expected result:** One assignment per active tag; color/name/library from selected business; removal persistent; errors preserve honest state; management leads to customer tag settings. No automatic CRM tag mutation assumed.
- **Independent evidence:** Conversation tag source IDs/assignment rows and CRM tags unchanged; reopened picker/state.
- **Cleanup:** Remove only QA assignments added by run.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="inb-025"></a>

## INB-025 — Append-only notes, formatting and privacy

- **Priority / environment:** P1 / LIVE + ISOLATED.
- **Preconditions and data:** Own thread and synthetic author A/B; unique QA note.
- **Steps:** Save with Enter; multiline via Shift+Enter; test whitespace, double Enter, failed save and second author in isolation; reload.
- **Expected result:** Note saved once with correct author/time, newest-first; multiline retained; no note sent to Messenger; failure preserves recoverable input; pre-existing notes remain.
- **Independent evidence:** Persisted note IDs/author/timestamps, Messenger no extra message and outbound call count.
- **Cleanup:** Keep clearly marked QA note if deletion is unavailable; do not erase old notes.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="inb-026"></a>

## INB-026 — Follow-up save, due state and timezone

- **Priority / environment:** P1 / LIVE + ISOLATED.
- **Preconditions and data:** L original follow-up; isolated fixed clock and browser timezone different from UTC.
- **Steps:** Save QA date/note; switch thread with unsaved edit; reload saved state; cross due time in isolation; edit/clear; test invalid/missing input/conflict.
- **Expected result:** Local input converts to correct UTC and shows device timezone; saved state persists; unsaved session draft scope correct; due behavior matches actual UI; no background customer message/push schedule falsely promised.
- **Independent evidence:** Stored followUpAt/note/revision, clock conversion and list membership; no outbound provider calls.
- **Cleanup:** Restore original follow-up exactly; reset clock fixture.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="inb-027"></a>

## INB-027 — Shared photos and panel toggles

- **Priority / environment:** P2 / LIVE + ISOLATED.
- **Preconditions and data:** Thread with image/sticker duplicates, expired image and unloaded old images.
- **Steps:** Collapse/expand customer panel and each section; inspect shared photos; open image in new tab; test broken image.
- **Expected result:** Panel controls preserve thread/composer; deduplicated photos are only from loaded messages and labelled so; source links safe; broken assets have fallback; no false whole-history claim.
- **Independent evidence:** Loaded attachment manifest and opened source URL; screenshots desktop/mobile.
- **Cleanup:** Close opened QA tabs; restore panel preference.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="inb-028"></a>

## INB-028 — CRM search and explicit customer selection

- **Priority / environment:** P0 / ISOLATED.
- **Preconditions and data:** Two same-name synthetic contacts with different IDs and fields; conversation sender has no CRM UUID.
- **Steps:** Search by supported fields; inspect ambiguous matches; explicitly select each; open CRM profile; switch thread and reload.
- **Expected result:** No auto-link by name/Meta ID; correct chosen profile and fields; persistence behavior disclosed rather than a false durable link. Any durable association claim must be backed by actual stored relation, otherwise deferred.
- **Independent evidence:** Contact IDs/domain reads, selected UI context and source relation availability.
- **Cleanup:** Clear selection/reset I.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="inb-029"></a>

## INB-029 — CRM status/tag editing from inbox context

- **Priority / environment:** P1 / ISOLATED.
- **Preconditions and data:** Explicitly selected contact; editable and read-only role; distinct conversation and CRM tag assignments.
- **Steps:** Change contact status/tag using available panel/profile controls; reload CRM screen and inspect history; fail a save and retry.
- **Expected result:** Correct contact updated with version checks; CRM state and analytics source events agree; conversation tag does not silently change; read-only role cannot mutate via UI or API.
- **Independent evidence:** CRM contact/history/outbox and conversation source before/after.
- **Cleanup:** Reset contact status/tags.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="inb-030"></a>

## INB-030 — Order draft without live submission

- **Priority / environment:** P1 / ISOLATED.
- **Preconditions and data:** Synthetic contact A/B, catalog variant, warehouse and safe order source; no real order submission.
- **Steps:** Open order panel; fill fields; choose A then switch to B; change thread and return; try invalid quantity/stock/required fields; use F2 only inside form.
- **Expected result:** Draft fields preserved; changing contact does not silently overwrite edited details; totals use integer amounts and actual variant; validation/stock policy matches selected source; no global shortcut sends an order.
- **Independent evidence:** Form values versus catalog/order-policy source and zero create/shipping/payment calls.
- **Cleanup:** Discard QA order draft.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="inb-031"></a>

## INB-031 — Order creation and session-only panel scope

- **Priority / environment:** P0 / CONDITIONAL.
- **Preconditions and data:** Disposable environment with shipping/payment/outbound disabled; accepted test order persistence scope.
- **Steps:** Submit valid draft once and double-click; switch away during submission; return; inspect order list/detail and inbox panel; start fresh session.
- **Expected result:** One order/request identity; correct items/customer/warehouse/integer totals; completion belongs to original draft; no customer confirmation automatically sent; panel lists only session-created orders, not false full purchase history.
- **Independent evidence:** Persisted order source, create call IDs and disabled external integration call counters.
- **Cleanup:** Reset disposable order fixture; no real order cancellation side effects.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="inb-032"></a>

## INB-032 — Keyboard shortcuts and focus safety

- **Priority / environment:** P1 / ISOLATED.
- **Preconditions and data:** I with editable/read-only thread, dialogs and note/composer fields.
- **Steps:** Use J/K, /, R, E, T, U outside inputs; then type those characters in input/textarea/contenteditable/menu/dialog, IME and Ctrl/Alt/Meta/Shift combinations.
- **Expected result:** Intended select/search/focus/resolve/tag/unread actions only outside protected typing contexts; no accidental mutations or browser shortcut interception; no mutation for read-only user.
- **Independent evidence:** Focus target, source state/revisions and request counts for each key/context variant.
- **Cleanup:** Restore thread states/reset I.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="inb-033"></a>

## INB-033 — Bulk selection boundary and reset

- **Priority / environment:** P1 / ISOLATED.
- **Preconditions and data:** I with more records than visible limit; no real customer data.
- **Steps:** Enter Manage; select some and all visible; click a row; change search/provider/tab/filter; exit and re-enter.
- **Expected result:** Row click selects rather than opens in bulk mode; select-all means loaded visible rows only; count correct; any scope change clears selection with notice; zero selection actions disabled.
- **Independent evidence:** Visible IDs versus bulk request IDs; hidden/unloaded/unrelated records untouched.
- **Cleanup:** Clear selection/reset filters.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="inb-034"></a>

## INB-034 — Every bulk action and partial failure

- **Priority / environment:** P0 / ISOLATED.
- **Preconditions and data:** Synthetic selected set, one stale or forbidden record; record each original state.
- **Steps:** Independently run resolve/reopen, star/unstar, read/unread, spam, assign/unassign and clear follow-up; force one member to fail; retry.
- **Expected result:** Only selected authorized IDs mutate; success/failure counts accurate; only failed rows remain selected for retry; opposite folder actions sensible; duplicate retry does not repeat completed work.
- **Independent evidence:** Per-ID source before/after and partial response results; no provider customer messages.
- **Cleanup:** Reset I after each independent action variant.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="inb-035"></a>

## INB-035 — Saved views, limit and private scope

- **Priority / environment:** P2 / ISOLATED.
- **Preconditions and data:** I; two users/businesses; storage-blocked variant.
- **Steps:** Save/apply/delete named views; attempt sixth view; search before saving/applying; reload; switch business/user; block storage writes.
- **Expected result:** At most five device-local views; expected filters retained, search excluded/cleared on apply; no cross-user/business leak; storage error honest, not fake save; no cross-device sync claim.
- **Independent evidence:** Saved-view payload and exact resulting query; no unrelated localStorage dump.
- **Cleanup:** Delete QA views/reset contexts.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="inb-036"></a>

## INB-036 — External Facebook link and list/thread recovery

- **Priority / environment:** P1 / LIVE + ISOLATED.
- **Preconditions and data:** Own L and isolated disconnected/no-page variant.
- **Steps:** Open external Facebook link; return; cause list failure and thread failure separately; use retry; compare selection and unsent draft.
- **Expected result:** Link targets correct page inbox, not a fabricated stable per-person thread URL; unavailable source clear; errors distinct from no messages; retry restores correct data without sending or discarding draft.
- **Independent evidence:** Opened URL/page asset identifier; scoped failed/recovered requests; draft value.
- **Cleanup:** Close external tab and reset faults.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="inb-037"></a>

## INB-037 — Notifications and lead alert privacy

- **Priority / environment:** P2 / ISOLATED.
- **Preconditions and data:** Dedicated context with default/granted/denied/unsupported notification permission; newly captured unseen lead/phone fixture after the list is primed.
- **Steps:** Exercise Enable notifications only on the QA browser; prime the first list without alerts, then surface a new unseen lead/phone with a new capturedAt key; repeat its polling result; change query and prime again; surface four new unseen leads together; test blocked/missing audio APIs.
- **Expected result:** Permission requested only after user action; unavailable/denied states do not loop prompts; alerts reflect actual supported behavior and never claim a background reminder service; initial load/query change does not replay old leads; new capturedAt lead triggers the implemented alert path; duplicate poll does not repeat it; at most three browser notifications per fresh batch; blocked audio/notification APIs never break inbox. A plain new message without an unseen lead is not a positive notification test.
- **Independent evidence:** Browser permission state, notification calls and source event IDs with synthetic text.
- **Cleanup:** Close QA context; do not alter owner browser permission.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="com-001"></a>

## COM-001 — Stored comments list, search and pagination

- **Priority / environment:** P1 / ISOLATED.
- **Preconditions and data:** C with >50 comments and >200 stored posts, separate pages and no-match token.
- **Steps:** Choose page; search server text; select oldest post by loading older posts past 200; load older comments to end; change page rapidly.
- **Expected result:** Correct stored comment/page/post results; older items reachable without duplicates or lost cursor; loading/error/no-page/no-comments/no-match distinct; late prior-page results do not leak.
- **Independent evidence:** Independent stored post/comment ID manifest and fetched cursors; external source not assumed complete.
- **Cleanup:** Reset C/search/page.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="com-002"></a>

## COM-002 — Comment context, source freshness and recorded history

- **Priority / environment:** P1 / ISOLATED.
- **Preconditions and data:** C parent/reply/media-only/unavailable/changed/deleted post variants.
- **Steps:** Open each comment; inspect source post, parent, author ID, action history and external link; simulate fresh-source failure.
- **Expected result:** Known fields displayed honestly; fresh versus stored snapshot timestamp distinguished; unavailable reason visible; author name not guessed; opening does not pause automation or mutate review state; history limited to Rapiz-recorded actions.
- **Independent evidence:** Stored source snapshot/action IDs and controlled fresh-source response; zero write calls on open.
- **Cleanup:** No writes; reset faults.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="com-003"></a>

## COM-003 — Public/private reply modes and safety

- **Priority / environment:** P0 / CONDITIONAL.
- **Preconditions and data:** C in isolation; public live reply requires dedicated owned test post and approval.
- **Steps:** Compose different public/private texts; switch modes; press Enter; test public phone/email confirmation cancel/accept; test private ineligible/already-attempted/deleted variants.
- **Expected result:** Separate drafts per mode/comment/page/user; Enter newline and explicit Send only; cancel sends nothing; eligibility explanation matches current adapter policy; no unsupported Open DM link or guaranteed synced DM claim.
- **Independent evidence:** Attempt/source records, provider stub calls and target comment IDs; live external verification only after approved mutation.
- **Cleanup:** Clear QA drafts/reset C; retain approved external test history.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="com-004"></a>

## COM-004 — Reply idempotency, unknown and pending reconciliation

- **Priority / environment:** P0 / ISOLATED.
- **Preconditions and data:** C with transport loss, known request, pending action, unknown outcome and another-tab attempt.
- **Steps:** Send; lose response; remount; retry/check status; change fresh-source availability; attempt a new request while stored mode unresolved.
- **Expected result:** Original unanswered/pending request ID retained and text locked; known request reconciles before new-source validation; new attempt after unknown requires explicit risk acknowledgment; no silent duplicate send.
- **Independent evidence:** Provider stub invocation/request-ID ledger, stored action history and locked composer state.
- **Cleanup:** Reset C/attempt memory.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="com-005"></a>

## COM-005 — Hide/unhide and uncertain-action protection

- **Priority / environment:** P0 / CONDITIONAL.
- **Preconditions and data:** C; actual provider moderation only on an owned approved QA comment.
- **Steps:** Hide then unhide known final state; inject pending/transport loss and reload; attempt opposite action; reconcile/retry original.
- **Expected result:** Visibility not falsely final before confirmation; original request ID preserved; unresolved opposite action blocked or requires the documented stored-attempt confirmation; action history names correct actor/result.
- **Independent evidence:** Stored moderation attempt IDs, stub/external visibility and final source read.
- **Cleanup:** Restore original visibility only after final outcome; reset isolated C.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="com-006"></a>

## COM-006 — Comment permissions and automation-settings permissions

- **Priority / environment:** P0 / ISOLATED.
- **Preconditions and data:** Owner/admin/analyst/sales fixtures with explicit contacts.edit and settings.manage capabilities.
- **Steps:** Try comment public/private/moderation with no contacts.edit; read fanpage settings; try editing switches/keywords/post exclusions without settings.manage; repeat direct scoped requests.
- **Expected result:** Comment writers require their capability; fanpage automation writes independently require settings.manage; read access retained where authorized; owner/admin allowed, restricted writes denied and leave data unchanged; foreign tenant resource returns 404.
- **Independent evidence:** Effective role map, source settings/action before/after, denied statuses and zero provider calls.
- **Cleanup:** Reset roles/settings fixtures.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="inb-038"></a>

## INB-038 — Customer phone display, clipboard and lead acknowledgement

- **Priority / environment:** P1 / ISOLATED.
- **Preconditions and data:** Synthetic conversation with a known safe test phone, an unseen lead, a missing-phone variant and clipboard granted/denied contexts. No real calls.
- **Steps:** Inspect About phone and new-lead badge; copy phone; verify clipboard result; deny clipboard and retry; inspect the telephone link target without launching it; open/acknowledge the unseen lead using the actual supported control and reload.
- **Expected result:** Correct stored phone displayed and copied once; success/error toast matches clipboard outcome; missing phone shows honest empty state; telephone href targets that exact synthetic number without an automatic call; supported lead acknowledgement persists and the new-lead indicator follows the saved seenAt state. If no acknowledgement control exists in this baseline, record that variant NOT_IMPLEMENTED rather than inventing one.
- **Independent evidence:** Conversation/lead source phone and capturedAt/seenAt, clipboard fixture readback/rejection, inspected href and zero OS telephone launches or customer sends.
- **Cleanup:** Reset synthetic phone/lead fixture, clipboard and dedicated context.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.
