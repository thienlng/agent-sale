# Statistics (analytics)

Implementation notes for the statistics module (ANA-01..03, epic #25 / #43). Everything here is a **proposed product decision**: the reference product's formulas, events and latency are not verified, so each rule is written down and versioned (`ANALYTICS_DEFINITION_VERSION`). Changing a rule means a new version; reports always quote the version they used.

Code: `apps/backend/src/modules/analytics` (module doc: its `MODULE.md`), contracts in `packages/contracts/src/analytics/`, web in `apps/web/src/features/analytics`.

## 1. Metric definitions (version 1)

`GET /analytics/definitions` serves the table below as data; the web help panel and the query validator read the same source (`METRIC_DEFINITIONS`).

| Metric | Kind | Counts | Placed on the calendar by | Distinct over | Origins (default) | Sales attribution | Page filter |
|---|---|---|---|---|---|---|---|
| `customers.new` | event | customers created | creation time | customer | channel, manual, import (**channel**) | sales owner **at creation** | no |
| `phones.captured` | event | customers whose phone number was provided for the first time | the moment it was provided | customer | channel, manual, import (**channel**) | sales owner at the event | no |
| `tags.assigned` | event | tag assignments added | assignment time | none (every add counts) | manual, rule (both) | sales owner at the event | no |
| `tags.removed` | event | tag assignments removed | removal time | none | manual, rule (both) | sales owner at the event | no |
| `tags.net` | derived | `tags.assigned − tags.removed` of the same range | — | none | manual, rule | as its parts | no |
| `tags.current` | snapshot | assignments active at `asOf` | `asOf` | customer (total) | manual, rule | sales owner **at `asOf`** | no |
| `statuses.changed` | event | status changes | change time | none | manual, rule | sales owner at the event | no |
| `statuses.current` | snapshot | customers per status at `asOf` | `asOf` | customer | manual, rule | sales owner at `asOf` | no |
| `conversations.opened` | event | conversations opened by a first customer message | that message's time | conversation | channel | — | yes |
| `messages.inbound` | event | customer messages | message time | none | channel | — | yes |
| `messages.outbound` | event | staff and bot messages | message time | none | channel | — | yes |
| `comments.received` | event | page comments | — | none | channel | — | yes — **no data source yet** |

## 2. Rules

- **Events are not snapshots.** An event count answers "how many times in this range"; a snapshot answers "how many right now / at `asOf`". A tag added and removed in the range gives `tags.assigned` 1, `tags.removed` 1, `tags.net` 0 and `tags.current` 0. The two are never mixed in one number.
- **Origin is explicit.** Customers created by hand in the CRM have origin `manual` and are not counted as `customers.new` unless the query asks for `manual` (the default is `channel`). Tag and status events have origin `manual` when a person did it and `rule` when automation did.
- **Attribution.** Filtering an event metric by salesperson uses the salesperson who owned the customer **when the event happened** (from the ownership history), not the current owner. Snapshots use the owner at `asOf`.
- **Dates.** A range is local, inclusive days in the shop's time zone (`from` 00:00 of the first day to 00:00 after the last day = half-open UTC interval). Events are bucketed by when they **happened**, not when they were processed: a late event lands in its original day. At most 366 days per query.
- **Distinct totals.** A total is never the sum of breakdown rows when a unit can sit in several rows. A customer with two tags appears in both tag rows of `tags.current`, so its total is the count of distinct customers (`additiveAcrossBreakdown: false`).
- **Undefined is not zero.** A ratio whose denominator is 0 is `null` (`ratio()` in contracts). A metric with no data source (`comments.received`), a locked feature or a failed query is reported as such — never as a successful 0.
- **Unsupported combinations are rejected** with the offending metric and filter named (`validateAnalyticsQuery`): an origin a metric cannot have, a salesperson filter on conversation metrics, a page filter on customer metrics, a snapshot in the future, an inverted range.
- **No personal data in the facts.** Facts keep ids and times, never names, phone numbers or message text.

## 3. Decisions the product owner still has to confirm

The definitions above are the proposal the dashboard is built on. Before the dashboard claims parity with the reference product, confirm or change:

1. What counts as a **conversion** (this version has none; `phones.captured` and `customers.new` are the closest).
2. **Phone capture**: first time a number is stored on the customer, whichever way (proposed), or only a number found in a conversation.
3. **`asOf` snapshots** for the shop's current tags and statuses: defaults to now; historical `asOf` is supported only from the first day the projection ran.
4. **Attribution** at event time (proposed) vs the current owner.
5. A **page** filter for customers needs customers linked to the page/channel they came from (not yet stored).
