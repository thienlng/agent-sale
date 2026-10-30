# Test data and independent oracles

## Fixture families

| Alias | Purpose | Preparation and boundaries |
| --- | --- | --- |
| L | Owner's existing TinyMind conversation | Record original state. Approved existing product K has a known name, variant, price, stock policy and training-source revision; unknown product U has no training/catalog entry. If K cannot be established, block grounding cases rather than inventing an answer. |
| I | Inbox matrix in a disposable business | At least six synthetic conversations: I1 open/unread/unanswered/bot/P1/tag A/Sales S1; I2 open/read/unanswered/human/P1/tags A+B/S2; I3 open/read/replied/bot/P2/no tags/unassigned; I4 resolved; I5 spam; I6 open/follow-up set. Give each unique search tokens, message IDs and explicit phones yes/no. Save a full state manifest before each case. These are synthetic fixture criteria, not claims about live users. |
| G | Statistics golden dataset below | Disposable database/workspace G-A, timezone Asia/Ho_Chi_Minh, definition version 1, owner privileges, required statistics entitlements; projection history starts before D0. G-B is a separate business with different known counts. No other writes during the run. |
| R | Role and fault matrix | Owner/admin/analyst/sales/CSKH as actually available in the role contract; record effective capabilities per account. Separate authorized business, forbidden business, expired session and selected missing capability. Inject faults only in an isolated browser/test backend. |
| C | Stored Facebook comment matrix | Synthetic fixtures for ordinary, hidden, deleted, old/ineligible, already-private-replied and pending/unknown action comments, parent threads, media-only posts, >50 comments and >200 stored posts. Actual Facebook mutation needs a dedicated owned test post and separate approval. |

## Golden statistics timeline

D0 = 2026-10-19, D1 = 2026-10-20, D2 = 2026-10-21; all times below are local UTC+07. The disposable environment uses a frozen clock just after the last D2 event. Source operations/fixtures must preserve their occurred-at times. Do not backdate or rewrite the real environment. If a local harness cannot seed historical events safely, mark historical cases BLOCKED and run through a dedicated fixture harness instead.

Create these records through domain operations or the isolated integration fixture layer, preserving outbox events and initial ownership/status. Do not seed only analytics facts: that would bypass the behavior being tested. Fixture source manifest is the independent expected-value ledger, reviewed before loading the projection.

| Record | Creation / source | Sales owner | Phone / initial status |
| --- | --- | --- | --- |
| C0 | D0 09:00 / manual | S1 throughout | no phone; New |
| C1 | D1 09:00 / manual | S1 until D2 15:00, then S2 | first phone D1 11:00; New |
| C2 | D1 09:30 / channel | S1 throughout | first phone at creation D1 09:30; New |
| C3 | D2 09:00 / import | S2 throughout | first phone at creation; Won |

Use non-routable synthetic contact details; do not send verification/SMS/email. Changing C1's existing phone on D2 is a correction, not a second first-phone event.

| Time | Operation | Expected accounting |
| --- | --- | --- |
| D0 10:00 | Add tag A to C0 | Outside event range; active entering D1 |
| D1 12:00 | Add A to C1 | assignment 1 |
| D1 12:01 | Add B to C1 | assignment 1 |
| D1 12:02 | Add A to C2 | assignment 1 |
| D1 13:00 | Remove A from C1 | removal 1 |
| D2 10:00 | Re-add A to C1 | assignment 1; distinct new assignment cycle |
| D2 11:00 | Remove A from C2 | removal 1 |
| D2 12:00 | Remove A from C0 | removal 1 even though the add was before the range |
| D1 13:10 / 14:00 | C1 New → Qualified; C2 New → Qualified | two status changes |
| D2 13:00 / 14:00 | C1 Qualified → Won; C2 Qualified → New | two status changes |
| D2 14:30 | Save C1 Won again | no status transition |
| D2 15:00 | Transfer C1 from S1 to S2 | changes snapshot ownership; does not rewrite prior event attribution |

Messaging source manifest (no implicit CRM linkage is assumed):

| Day | Conversation / page | Incoming successful source messages | Successfully sent shop messages |
| --- | --- | --- | --- |
| D0 | X / P1 | first message before the range | not in range |
| D1 | X / P1 | x1 | staff reply sx1 |
| D1 | Y / P1 (new) | y1, y2 | bot reply by1 |
| D2 | Y / P1 (existing) | y3 | staff reply sy1 |
| D2 | Z / P2 (new) | z1, z2 | bot reply bz1 |

Add a failed outbound attempt and an unresolved/pending attempt in isolated fixtures. They contribute **zero successful outbound messages** until a final successful source event exists. Provider echoes/replays of the four existing successes must not add another outbound message. A later transition to sent belongs to a separate variant with a freshly calculated oracle.

## Expected event cards (all supported origins, no salesperson/page narrowing)

| Metric | D1 | D2 | D1–D2 |
| --- | ---: | ---: | ---: |
| customers.new | 2 | 1 | 3 |
| phones.captured | 2 | 1 | 3 |
| tags.assigned | 3 | 1 | 4 |
| tags.removed | 1 | 2 | 3 |
| tags.net | 2 | -1 | 1 |
| statuses.changed | 2 | 2 | 4 |
| conversations.opened | 1 | 1 | 2 |
| messages.inbound | 3 | 3 | 6 |
| messages.outbound | 2 | 2 | 4 |
| comments.received | unavailable | unavailable | unavailable |

## Expected snapshots and breakdowns

- At end D1: active tagged customers C0/C1/C2 = **3**. Tag A = 2, B = 1. Status New = 1, Qualified = 2; customer total = **3**.
- At end D2: active tagged customers C1 only = **1**. Tag A = 1 and B = 1; row sum **2 must not replace distinct card 1**. Status New = 2 (C0/C2), Won = 2 (C1/C3); total **4**. A customer with no status uses a separate variant/null bucket, not an unannounced fifth base customer.
- Changing the event date range does not automatically change `asOf`. Historical snapshot variants send an explicit supported `asOf`; the baseline UI defaults snapshots to now. Never expect the D1 snapshot merely from choosing a D1 date range.
- Origin variants for D1–D2: manual new/phone **1/1**, channel **1/1**, import **1/1**. The dashboard's all-source total is **3/3**; API omission defaults to channel for these metrics. Typing a phone into Messenger alone does not prove a stored CRM first-phone event. Under the current mapper, a phone present at creation uses the creation origin; a first phone added later by `crm.contact.updated.v1` is attributed to manual, even when the contact was originally channel-created. Test that separate update-origin variant without changing this base fixture. Whether the desired report should instead preserve original customer origin is DECISION_REQUIRED.
- Sales event attribution: S1 new **2**, phones **2**, tag adds **4**, removals **3**, status changes **4**; S2 new **1**, phones **1**, tag adds/removals/status changes **0**. Current tagged-customer ownership is S2 **1**, S1 **0**. Current statuses by owner: S1 New **2**, S2 Won **2**. Initial status creation is not a change.
- Page variants: P1 opened/inbound/outbound **1/4/3**; P2 **1/2/1**. Customer/tag/status cards must not change solely because of a page filter they do not support.
- In a separate no-data date range, event metrics = 0 with an empty drilldown. Current snapshots may still be nonzero; do not treat this as a contradiction.

## Second-business portfolio fixture G-B

Use separate synthetic IDs, no shared CRM contact identities, and the same timezone/entitlements as G-A. Prepare this source manifest independently of analytics:

- Contacts B1/B2 created on D1 and B3/B4/B5 on D2 (all supported origins); B1 gets its first phone on D1 and B3 on D2. No other phone events.
- Conversation BX opens on D1 with three incoming messages on D1. BY and BZ open on D2 with two incoming messages each on D2. All have a page belonging only to G-B.
- Therefore G-B D1/D2/range values are: new customers **2/3/5**, first phones **1/1/2**, new conversations **1/2/3**, incoming messages **3/4/7**.
- Combined G-A + G-B D1/D2/range values are: new customers **4/4/8**, first phones **3/2/5**, new conversations **2/3/5**, incoming messages **6/7/13**. Portfolio daily opened points are **2, 3**.
- Use these exact source IDs in the fixture-run manifest. Unspecified G-B tag/status/outbound metrics are not part of the portfolio arithmetic oracle; do not use made-up values for them.

## Independent evidence rules

1. For delivery, Messenger is the external observation; record visible content, order and timestamps. Rapiz's own sent toast/API answer alone is insufficient.
2. For storage, use the relevant domain read API and scoped source records/outbox events read-only, **not** the same analytics query repeated in a second tab. Compare event IDs, kinds, occurred-at, contact/conversation/page IDs and owner history. Keep contents/credentials private.
3. For statistics, compute the oracle from the reviewed source manifest, then reconcile source → unique projected events → metric units → UI. A chart/card/drilldown agreeing with one another can still share the same bug.
4. For live cumulative metrics, first enumerate every eligible historical source row in the selected scope/range; the new QA messages are only a delta cross-check. If complete source access is missing, mark the numerical case BLOCKED/partial evidence rather than certify an absolute total.
5. The projection is eventually updated. Record `generatedAt`, `watermarkId`, `timezone`, `scope` and `lagSeconds` for each group. Freeze data at the returned watermark for drilldowns. Refresh after projection catch-up; do not compare different unrecorded snapshots.
6. Retry/replay injection and historical time/entitlement failures happen only in disposable fixtures. No real provider webhook replay, live queue manipulation or clock change.
7. Latency evidence uses actual measured times. Do not promise a response-time SLA or exact AI wording not in an approved instruction. For grounded answers compare factual claims and required behavior, not sentence equality.

## Cleanup rules

`Restore L` = restore only the saved own-thread mode, assignee, status, priority and follow-up; remove the QA tag assignment if this run added it. Keep pre-existing notes/tags. Sent external messages and read receipts remain as disclosed test history. Do not delete messages to hide effects.

`Reset I/G/R/C` = reset the disposable fixtures through their test harness to the recorded manifest; no shared-database truncation or production rebuild. Preserve failing evidence before reset. `No writes` = close test panels/contexts and restore viewport/filter/theme as needed; do not delete data.
