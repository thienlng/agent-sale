# Statistics acceptance — numerical reconciliation

Every visible metric has an individual numerical case. Use golden fixture G and the manually calculated [source ledger](data-and-oracles.md), not a second call to the same analytics endpoint as the oracle. All numeric cases require the correct business, timezone, date range, origins, permissions, entitlements and a caught-up/frozen projection. LIVE variants require full eligible-source enumeration for absolute totals; delta-only checks are insufficient. Current formula correctness and final product-policy approval are separate verdicts.

<a id="ana-001"></a>

## ANA-001 — Inventory, metric definitions and provenance

- **Priority / environment:** P0 / ISOLATED.
- **Preconditions and data:** G; current definitions/version and card labels.
- **Steps:** Expand details; inventory every card, definition popover, table, chart metric and filter; compare definitions endpoint, source code policy and documented business rule.
- **Expected result:** All 12 metric keys accounted for, each label/help/unit/kind/attribution/version correct; no invented conversion/revenue/response-time card. Pending product decisions explicitly logged even if implemented formula passes.
- **Independent evidence:** Versioned definition table plus UI inventory; approved policy or DECISION_REQUIRED entry.
- **Cleanup:** No writes.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="ana-002"></a>

## ANA-002 — Hội thoại mới — new conversations

- **Priority / environment:** P0 / ISOLATED + LIVE.
- **Preconditions and data:** G X before range, Y on D1, Z on D2; LIVE absolute source manifest if available.
- **Steps:** Query D1, D2, combined; open card drilldown; replay Y first-message event in isolated harness; resolve/reopen Y and send another input.
- **Expected result:** Values 1,1,2; combined distinct Y/Z only. Repeated input, replay or resolve/reopen does not invent another conversation opening. Source contract first-message identity determines count.
- **Independent evidence:** First-customer-message source events and distinct conversation IDs; expected manifest predates query.
- **Cleanup:** Reset variant additions; do not replay live events.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="ana-003"></a>

## ANA-003 — Khách hàng mới — new customers

- **Priority / environment:** P0 / ISOLATED + LIVE.
- **Preconditions and data:** G C0–C3; channel/manual/import sources; full live source visibility or BLOCKED.
- **Steps:** Query all sources D1/D2/combined; filter each origin; edit existing C1 and explicitly create new QA contact in isolated variant.
- **Expected result:** 2,1,3; each origin combined =1; C0 excluded by creation date; edit does not add customer; a Messenger sender is not automatically assumed a CRM record.
- **Independent evidence:** Contact creation records/outbox and source origins; compare IDs, not display names.
- **Cleanup:** Reset created-contact variant.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="ana-004"></a>

## ANA-004 — Số điện thoại thu được — first stored phone

- **Priority / environment:** P0 / ISOLATED + LIVE.
- **Preconditions and data:** G C1/C2 first phones D1, C3 at D2 creation.
- **Steps:** Query all sources, then origin filters; correct existing C1 phone; save unchanged phone; test a message that contains digits without stored CRM capture. In a separate variant create a channel contact without a phone, then add its first phone through contact update.
- **Expected result:** D1=2,D2=1,range=3; correction/no-op does not count twice; phone-on-create counts; mere chat text not counted without eligible stored event. Rule is first stored phone under current proposal. The extra update-origin variant increases manual phone count by1 (not channel); explicitly record DECISION_REQUIRED if product expects original-customer-source attribution instead.
- **Independent evidence:** First-phone source-event flags and contact history; never expose actual phone values in git.
- **Cleanup:** Reset phone correction variant.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="ana-005"></a>

## ANA-005 — Nhãn được gắn — tag assignment events

- **Priority / environment:** P0 / ISOLATED.
- **Preconditions and data:** G assignments; independent conversation tags variant.
- **Steps:** Read D1/D2/combined and tag breakdown; attempt same active CRM tag add twice; compare remove/re-add; separately change only a conversation tag.
- **Expected result:** 3,1,4; A adds3 and B adds1 in range; re-add after removal counts, no-op duplicate assignment does not; conversation-only tag cannot masquerade as CRM tag event.
- **Independent evidence:** CRM assignment IDs/outbox event kinds and independent conversation tag source.
- **Cleanup:** Reset variants.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="ana-006"></a>

## ANA-006 — Nhãn bị gỡ — tag removal events

- **Priority / environment:** P0 / ISOLATED.
- **Preconditions and data:** G includes C0 tag added before the event range.
- **Steps:** Query D1/D2/range; inspect tag breakdown; attempt removal of already-absent tag.
- **Expected result:** 1,2,3; C0 removal counts even though add predates range; A removals3, B0; absent no-op does not create removal.
- **Independent evidence:** Actual removal events and assignment lifecycle ledger.
- **Cleanup:** Reset variants.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="ana-007"></a>

## ANA-007 — Nhãn ròng — derived net, including negative values

- **Priority / environment:** P0 / ISOLATED.
- **Preconditions and data:** G add/remove counts in identical scope.
- **Steps:** Query D1/D2/combined; compare every tag row; select net chart metric; try clicking net card.
- **Expected result:** 2,-1,1 exactly assigned minus removed; negative value not clipped/absolute; no invented drilldown for a derived metric; chart computes from same-day parts.
- **Independent evidence:** Manual integer subtraction from reviewed eligible add/remove events, not card-to-card agreement alone.
- **Cleanup:** No writes.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="ana-008"></a>

## ANA-008 — Khách đang có nhãn — distinct current tagged customers

- **Priority / environment:** P0 / ISOLATED.
- **Preconditions and data:** G at end D2; explicit end-D1 asOf API variant.
- **Steps:** Read current card/table; count unique active contacts; change event date range only; query supported explicit D1 asOf separately.
- **Expected result:** Current total1 while A1+B1 sums2; D1 asOf distinct3 with A2+B1. Changing range alone does not time-travel default snapshot; all-tags-removed customers excluded.
- **Independent evidence:** Assignment intervals at asOf and distinct contact IDs, independent of event-range counts.
- **Cleanup:** Reset clock/query; no live historical rewrite.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="ana-009"></a>

## ANA-009 — Lượt đổi trạng thái — actual transitions

- **Priority / environment:** P0 / ISOLATED.
- **Preconditions and data:** G four changes plus initial statuses and no-op Won save.
- **Steps:** Read D1/D2/combined; inspect rows; save same C1 status again; create contact with initial status in separate variant.
- **Expected result:** 2,2,4; initial status and repeated same-status save do not count as changes; change back to New is a real transition.
- **Independent evidence:** CRM transition history/outbox with old/new values and occurred-at.
- **Cleanup:** Reset variants.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="ana-010"></a>

## ANA-010 — Khách theo trạng thái — complete snapshot partition

- **Priority / environment:** P0 / ISOLATED.
- **Preconditions and data:** G at end D2; separate null-status customer variant.
- **Steps:** Read card/status table/drilldowns; query historical supported asOf; add a no-status fixture and test its bucket.
- **Expected result:** Base current total4: New2/Won2; D1 asOf total3: New1/Qualified2. Null variant has one explicit no-status bucket and total5; each eligible customer appears once, not once per prior transition.
- **Independent evidence:** Latest initial/change event at or before asOf for each contact; owner history for scoped variants.
- **Cleanup:** Reset null-status variant.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="ana-011"></a>

## ANA-011 — Tin nhắn khách gửi — source message count

- **Priority / environment:** P0 / ISOLATED + LIVE.
- **Preconditions and data:** G incoming x1,y1,y2,y3,z1,z2; LIVE full manifest.
- **Steps:** Read D1/D2/combined; drill down; replay one incoming event and include read/delivery notifications in isolated fixture.
- **Expected result:** 3,3,6; count actual source messages once; no growth from webhook replay, opening a thread, delivery/read notifications or chart refresh.
- **Independent evidence:** Unique persisted inbound IDs and eligible outbox kinds; exclude non-message events explicitly.
- **Cleanup:** Reset isolated replay variant.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="ana-012"></a>

## ANA-012 — Tin nhắn shop gửi — successful staff and bot sends

- **Priority / environment:** P0 / ISOLATED + LIVE.
- **Preconditions and data:** G sx1/by1/sy1/bz1, plus definitive failure and pending.
- **Steps:** Read daily/range/page breakdown; replay provider echo; inspect bot/staff attribution; change pending to sent in separate variant.
- **Expected result:** 2,2,4 baseline; staff2 + bot2; failure/pending/unknown are not successful zero-cost sent events; success and echo never double-count; settled extra success increases by exactly1 in correct occurred-at bucket.
- **Independent evidence:** Persisted successful delivery source events/provider IDs and recorded actor, including outbound/echo dedup path.
- **Cleanup:** Reset settlement variant.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="ana-013"></a>

## ANA-013 — Bình luận — unavailable is not zero

- **Priority / environment:** P0 / ISOLATED + LIVE.
- **Preconditions and data:** Current main has comment UI but analytics source unavailable.
- **Steps:** Open detailed statistics after a stored comment exists; inspect card, help and drilldown affordance; attempt unsupported query in isolated API test.
- **Expected result:** Explicit unavailable/pending-source state, not successful 0; no active drilldown suggesting complete data. This is NOT_IMPLEMENTED analytics coverage, not a failed claim that stored comments are absent.
- **Independent evidence:** Current source wiring and definition availability, independent stored comment record.
- **Cleanup:** No writes.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="ana-014"></a>

## ANA-014 — Every daily chart metric and tooltip

- **Priority / environment:** P1 / ISOLATED.
- **Preconditions and data:** G; all supported event metrics and a no-event day.
- **Steps:** Choose each offered metric, including tag net; inspect dates/points/tooltip; include D0/no-event day as controlled variant; narrow page via chart selector.
- **Expected result:** One point per inclusive local date with actual zeros; ascending dates; values equal per-day source oracle; negative net visible; no snapshot mixed into event chart. Do not require daily sums to equal range-distinct totals in general.
- **Independent evidence:** Reviewed daily event manifest plus exact tooltip values and chart input; inspect every offered option.
- **Cleanup:** Restore range/page/metric.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="ana-015"></a>

## ANA-015 — Every breakdown and aggregation invariant

- **Priority / environment:** P0 / ISOLATED.
- **Preconditions and data:** G with per-tag, current-tag, status, Sales and page rows.
- **Steps:** Open all tables; verify each row/column, names and null/unknown labels; calculate additive and distinct totals separately.
- **Expected result:** Tag A assigned3/removed3/net0, B1/0/1; current-tag row sum2 versus distinct1; status rows total4; Sales new/phone S1=2/2 S2=1/1; P1 opened/in/out1/4/3, P2 1/2/1. No unsupported cross-table sum substituted for a total.
- **Independent evidence:** All row IDs/names and hand-calculated source groupings, not only top cards.
- **Cleanup:** No writes.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="ana-016"></a>

## ANA-016 — Date presets, custom range and range validation

- **Priority / environment:** P1 / ISOLATED.
- **Preconditions and data:** G, frozen today D2; 366/367-day variants.
- **Steps:** Use last7, last30, this month and one-day custom range; reload/back/forward/share URL; try inverted and >366-day ranges, malformed date URL and future snapshot API.
- **Expected result:** Presets include expected local dates; valid 366-day range accepted, 367 rejected; invalid range never produces stale successful result; URL restores supported filters; unsupported future snapshot rejected explicitly.
- **Independent evidence:** Calculated inclusive day counts, actual request boundaries/validation status and UI range.
- **Cleanup:** Reset URL/clock.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="ana-017"></a>

## ANA-017 — Timezone boundaries and delayed events

- **Priority / environment:** P0 / ISOLATED.
- **Preconditions and data:** Separate edge fixture at D1 23:59:59.999, D2 00:00:00 and next-day00:00; browser timezone different.
- **Steps:** Query D1/D2; delay original D1 event ingestion until D2; inspect both day buckets and displayed timezone.
- **Expected result:** Half-open UTC interval maps inclusive business-local days; exactly-midnight belongs to new day; no double inclusion; delayed D1 event stays D1. Device timezone must not silently change business calculation.
- **Independent evidence:** Source occurred-at UTC plus independent UTC+07 conversion, recorded browser/business zones and ingestion times.
- **Cleanup:** Reset separate boundary fixture.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="ana-018"></a>

## ANA-018 — Customer-source filters versus other metric groups

- **Priority / environment:** P1 / ISOLATED.
- **Preconditions and data:** G all origins.
- **Steps:** Toggle channel/manual/import individually and together; try deselecting last origin; clear secondary filters.
- **Expected result:** People totals each1/1, combined3/3; last selected source cannot leave an ambiguous empty selection; tag/status and conversation metrics not incorrectly narrowed by customer source. API default channel differs intentionally from dashboard all-source requests.
- **Independent evidence:** Request groups and independent eligible source IDs by origin; definition filter applicability.
- **Cleanup:** Reset origins.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="ana-019"></a>

## ANA-019 — Sales ownership history and reassignment

- **Priority / environment:** P0 / ISOLATED.
- **Preconditions and data:** G C1 transfers to S2 after events.
- **Steps:** Filter S1/S2; inspect event cards and current snapshots; repeat after changing current owner in isolated variant.
- **Expected result:** Historical C1 events remain attributed to S1; current tagged C1 belongs to S2; no reassignment-driven rewrite of prior new/phone/tag/status counts. Conversation cards do not receive unsupported salesperson filters.
- **Independent evidence:** Initial and transfer event chronology plus independent owner-at-event/asOf calculation.
- **Cleanup:** Reset owner variant.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="ana-020"></a>

## ANA-020 — Page filtering and unsupported combinations

- **Priority / environment:** P0 / ISOLATED.
- **Preconditions and data:** G P1/P2; foreign page in G-B.
- **Steps:** Select P1, P2, both and clear; attempt foreign page/unsupported page-on-people or Sales-on-conversation requests in isolated API.
- **Expected result:** Conversation groups match1/4/3 and1/2/1; customer/tag/status unchanged solely by page choice; invalid combinations rejected naming offending filter/metric; foreign resource never exposes foreign data.
- **Independent evidence:** Source page IDs, request-group payloads and direct denial without widening scope.
- **Cleanup:** Reset page filters.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="ana-021"></a>

## ANA-021 — Card and row drilldown for every drillable metric

- **Priority / environment:** P0 / ISOLATED.
- **Preconditions and data:** G; all valid cards and breakdown rows; frozen watermark.
- **Steps:** Open each non-derived available metric and each table row; verify label, timestamp, contact/page link and total; follow a CRM contact link; close/back.
- **Expected result:** Drilldown total equals clicked value for same filters, dimensions, scope and watermark; units are unique per definition; correct contact opens in same business; net/unavailable/locked cards have no misleading drilldown.
- **Independent evidence:** Independent source unit list and captured drilldown request; verify IDs rather than only count.
- **Cleanup:** Close sheet/restore screen.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="ana-022"></a>

## ANA-022 — Drilldown pagination and concurrent arrivals

- **Priority / environment:** P0 / ISOLATED.
- **Preconditions and data:** Variant with >50 units including equal timestamps; concurrent new eligible events.
- **Steps:** Open drilldown; load every page while adding known new units; change card filters and reopen; retry a failed next page.
- **Expected result:** No missing/duplicated units across equal timestamps/cursors; original watermark freezes original total; new card gets new watermark; row counts and load-more termination correct; failure retry does not discard loaded rows.
- **Independent evidence:** Source ID set frozen at original watermark and paginated row ID union.
- **Cleanup:** Reset pagination variant.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="ana-023"></a>

## ANA-023 — Stale responses, group failures and retry

- **Priority / environment:** P0 / ISOLATED.
- **Preconditions and data:** Slow old filter response, failing one analytics group, source-name lookup failure.
- **Steps:** Change dates/business rapidly; try clicking during placeholder load; fail people/tag/conversation separately; retry; fail definitions/name lookups separately.
- **Expected result:** Old value cannot masquerade as current result; charts/tables not clickable while stale; failed group not rendered as zero; partial success remains honest; retry targets current scope and cannot reopen old-business drilldown.
- **Independent evidence:** Delayed request sequence, captured request scope and visible state transitions.
- **Cleanup:** Remove faults/restore filters.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="ana-024"></a>

## ANA-024 — True zero versus loading, locked, denied and unavailable

- **Priority / environment:** P0 / ISOLATED.
- **Preconditions and data:** Separate no-data range, missing entitlement, no analytics.view,500 and slow-response variants.
- **Steps:** Observe every card state; attempt drilldown/direct requests; recover role/entitlement in fixture only.
- **Expected result:** Valid empty event result0; nonempty current snapshots remain accurate; locked/forbidden/error/loading/unavailable have distinct explanation and no false numeric zero; protected data not fetched or leaked by hidden controls.
- **Independent evidence:** Source absence for zero, effective entitlement/capability and server status; screenshots of each state.
- **Cleanup:** Reset role/entitlement/fault fixture.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="ana-025"></a>

## ANA-025 — Projection replay, freshness and idempotency

- **Priority / environment:** P0 / ISOLATED.
- **Preconditions and data:** G source/outbox retained; controlled worker/lease delay; no external outbound execution.
- **Steps:** Replay same eligible source IDs through isolated projector; issue concurrent queries; simulate lag>30s; recover; optionally rebuild only disposable fixture with approved harness.
- **Expected result:** Counts unchanged after replay; no partial rebuild result; lag/update timezone shown honestly; caught-up queries include committed eligible events; no duplicate facts or provider sends.
- **Independent evidence:** Source IDs versus unique projected fact keys, independent manual oracle and meta watermark/lag; record no external send calls.
- **Cleanup:** Reset isolated projector/fault fixture; never rebuild live business.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="ana-026"></a>

## ANA-026 — Restricted user and current visibility scope

- **Priority / environment:** P0 / ISOLATED.
- **Preconditions and data:** R with owned/unassigned/other-owned contacts and historical transfers.
- **Steps:** Open statistics as own-scope member; inspect cards/drilldowns/Sales selector and portfolio; try direct foreign contact/dimension requests; revoke ownership while sheet open.
- **Expected result:** Only owned/unassigned CRM data per current capability; historical watermark cannot retain unauthorized names after ownership loss; own-scope disclosure visible; unsupported Sales selection hidden; conversation aggregate scope follows documented contract, not an invented CRM filter.
- **Independent evidence:** Capabilities, present owner source records, response IDs and denied/filtered rows; never expose private data in evidence.
- **Cleanup:** Reset ownership/roles.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="ana-027"></a>

## ANA-027 — Portfolio totals, daily chart and business rows

- **Priority / environment:** P0 / ISOLATED.
- **Preconditions and data:** G-A base plus G-B same timezone with distinct manifest, e.g. event cards opened3/new5/phone2/inbound7; complete entitlements.
- **Steps:** Open logo portfolio; verify each four-card total, every daily point and each business row; open A/B separately under same period.
- **Expected result:** Combined cards opened5/new8/phone5/inbound13; row opened A2/B3; daily opened chart equals each date union sum; customer counts labelled records across businesses rather than deduplicated real people.
- **Independent evidence:** Separate source manifests A/B and arithmetic sum; source business scope captured per request.
- **Cleanup:** Restore selected business.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="ana-028"></a>

## ANA-028 — Portfolio incomplete, incompatible and unauthorized businesses

- **Priority / environment:** P0 / ISOLATED.
- **Preconditions and data:** One portfolio business forbidden/failing/locked/timezone-incompatible; stale membership and no-business variants.
- **Steps:** Run each failure independently; click retry; remove membership while request pending; verify no-membership screen.
- **Expected result:** Incomplete total explicitly shown instead of partial sum as complete; unauthorized data never counted/exposed; rows identify issue; incompatible zones not summed into misleading daily total; no-member state distinct from genuine zero-business statistics.
- **Independent evidence:** Membership/capability source and per-business responses with independent allowed set.
- **Cleanup:** Reset portfolio variants.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="ana-029"></a>

## ANA-029 — Freshness labels, formatting and presentation

- **Priority / environment:** P1 / ISOLATED.
- **Preconditions and data:** G plus large numbers, negative net and long business names; vi/en; desktop/mobile.
- **Steps:** Compare footer generatedAt/timezone/max lag and portfolio oldest timestamp; change language; inspect all numbers/tooltips/popovers/details.
- **Expected result:** Dates/numbers and full tooltips reflect selected locale; no clipped minus signs/meaningful digits; freshness reflects actual answering groups, never local now invented as server update; definitions remain readable.
- **Independent evidence:** Raw response metadata/expected values and screenshots at each locale/width.
- **Cleanup:** Restore locale/viewport.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="ana-030"></a>

## ANA-030 — Live absolute totals and cross-screen reconciliation

- **Priority / environment:** P0 / CONDITIONAL.
- **Preconditions and data:** Read-only authorized enumeration of all eligible source events/CRM records for selected live business/date; stable baseline snapshot.
- **Steps:** Inventory each displayed card/table/chart value; independently compute its full source population; compare every value then execute approved QA messages and recalculate; reconcile successful staff/bot sends, CRM writes and all out-of-scope events.
- **Expected result:** Every available live metric has exact absolute oracle plus delta reconciliation; comment metric remains unavailable; old conversation messages do not create new customer/opening counts; inability to enumerate full history is BLOCKED, never a numerical PASS.
- **Independent evidence:** Private sanitized source calculations with IDs/times/filter scopes and recorded projection watermark per group; no customer content committed.
- **Cleanup:** Restore own-thread state; preserve disclosed QA history and source evidence privately.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.

<a id="ana-031"></a>

## ANA-031 — Absent or undecided analytics capabilities

- **Priority / environment:** P1 / DEFERRED.
- **Preconditions and data:** Current baseline lacks conversion/revenue/response-time/shop/bot-history/account-usage completeness.
- **Steps:** List requested additional indicators and compare actual supported UI/API; identify unresolved formula owner and required source events.
- **Expected result:** No fake success/zero for absent indicators; one named dependency/decision per missing requirement. Existing proposed formulas and future business rules remain separately tracked.
- **Independent evidence:** Source/contract inventory plus T-081/T-087/T-091/T-092 and analytics open decisions.
- **Cleanup:** No writes; no product decision invented.
- **Execution status:** NOT_RUN. Record the actual run in the execution ledger.
