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
| `statuses.current` | snapshot | customers per status at `asOf` | `asOf` | customer | — (a status does not depend on who set it) | sales owner at `asOf` | no |
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

## 4. The projection (T-040)

Statistics read `analytics_facts`, never the CRM or inbox tables. Facts are derived from the transactional outbox and can be rebuilt from it.

- **Source.** `crm.*` events (customers, owners, statuses, tags) and the inbox's `conversation.message.received.v1` / `conversation.reply.completed.v1`. Payload additions are optional fields on the existing `v1` events (`origin`, `phoneCaptured`, `channelId`, `occurredAt`, `firstMessage`, `sender`); events written before them parse with defaults (origin `manual`, time = outbox time, no channel).
- **One fact per (event, kind).** `unique (workspace, outbox id, kind)` makes duplicates, retries and replays no-ops. Facts hold ids and times only.
- **Event time.** `occurred_at` is when it happened; `received_at` is when the outbox recorded it. Buckets and snapshots use `occurred_at`, so a late event lands in its original local day.
- **Temporal state is derived, not stored.** A tag assignment is active between its `tag.assigned` and `tag.removed` facts (same assignment id); a customer's status at `asOf` is the latest `status.initial` (the status it was created with) or `status.changed` at or before it; the owner at any time is the latest `assignment.changed` for that role at or before it. Out-of-order arrival cannot corrupt history because nothing is mutated in place. If volume demands it, intervals or daily rollups can be materialised later behind the same queries.
- **Ordering and gaps.** Outbox ids are handed out when a row is inserted but become visible when its transaction commits, so a higher id can commit before a lower one, and the xid order of transactions differs from the id order too. The projector therefore does not follow ids. It keeps a *transaction horizon* (the oldest transaction still running when it last read): every transaction below it has finished, so the rows those transactions wrote are all visible and none can appear later. A pass reads exactly the rows of the transactions that finished since the previous horizon (each outbox row records the 64-bit id of the transaction that wrote it in an indexed `tx_id` column, migration 0022: it never wraps, and a pass reads only its window, so an idle check or a query's catch-up costs an index probe, not a scan of the outbox), in pages, under an advisory lease, and then moves the horizon. A long-running transaction elsewhere in the database delays projection; that shows up as lag, not as missing data.
- **Customers from before M4b.** Earlier code emitted an ownership event only for an auto-assigned Sales and no starting status. Migration 0023 writes the owners and status each existing customer started with as outbox events (`crm.contact.assigned.v1` from nobody, `crm.contact.initial_status.v1`), taken from the `from` side of the earliest change or the current value. Ownership-based scope and status snapshots are then right for old customers too, and a rebuild keeps them because they live in the outbox.
- **Failure handling.** A payload that cannot be parsed goes to `analytics_dead_letters` and the projection moves on; a database error stops the batch and it is retried (checkpoint unchanged).
- **Freshness.** `ProjectorService.tick()` runs every 2 s in the `worker` entry; queries also catch up on whatever is pending before answering, so a single-node setup works without a worker. Responses carry `generatedAt`, the projection watermark and the lag in seconds.
- **Rebuild.** `pnpm --filter @agent-sales/backend analytics-rebuild <workspace-id>` replays a workspace's events and replaces its facts in one transaction under the lease: a crash keeps the old facts and queries never see a half-built set. Events it cannot read are dead-lettered like in the live projection. It only reads the outbox and writes facts: nothing is sent to customers or channels. A golden test checks the rebuilt facts equal the original ones.
- **Not covered yet.** Customers are not linked to the page/channel they came from, so customer metrics have no page filter; page comments have no source; the outbox is never pruned, so a rebuild can always replay from the start.

## 5. Queries, drilldown and the dashboard (T-041)

- **Endpoints.** `POST /analytics/query` (cards, a zero-filled series per local day, breakdowns, distinct totals, `meta`) and `POST /analytics/drilldown` (the rows behind one number, keyset pages). Both need `analytics.view`.
- **One relation per metric.** Cards, days, breakdown rows and drilldown rows are all computed from the same "units" of a metric, so a card and its drilldown cannot disagree. A metric that counts distinct customers lists each customer once (their latest unit); the drilldown `total` is exactly the card.
- **Watermark.** A response carries `meta.watermarkId` (the highest fact id it read). Sending it back as `query.watermark` freezes the data (`fact id <= watermark`): a drilldown opened from a card reproduces that card even if events arrive meanwhile. The watermark never widens what a viewer may see: scope is decided by who owns a customer *now*, whatever watermark a request names.
- **Filters.** Origin per metric is the requested origins the metric supports (the default when none are asked); a request none of whose origins fit a metric is rejected. Salesperson (owner at the event for events, owner at `asOf` for snapshots) applies to customer, tag and status metrics; page applies to conversation metrics. Anything else is a 400 with `details.issues` naming the metric and filter.
- **Scope.** A member without `contacts.view_all` (Sales, CSKH) only gets customers they own or nobody owns (same rule as the CRM list); `meta.scope` says `own`. Conversation numbers are aggregates without names and are not scoped. Drilldown rows carry customer ids and names only for customers inside that scope. The salesperson breakdown of an own-scope viewer can name (by id) a colleague who owned one of their customers earlier: ids only, no names or contact data.
- **States.** `locked` (the plan lacks the entitlement a definition names) is a card state; an unavailable source (`comments.received`) and an invalid query are explicit errors; a failed query is an HTTP error. None of them is ever shown as 0.
- **Freshness.** Before answering, a query waits (up to 3 s) for the projector (the worker's, or another query's) and runs a pass of its own, so whatever was committed before the call is included. `meta.lagSeconds` reports when the projection is behind, for example when the wait ran out. A page's concurrent queries all wait for the same lease: none reads around it.
- **Series versus totals.** A distinct metric (customers, phones, conversations) is distinct *within each day* in the series and within the whole range in the card, so the days can add up to more than the card; the card is the truth for the range.
- **Stale answers.** After a filter change the previous answer stays in memory but is not shown as a result: cards show loading, the chart and tables are dimmed and not clickable, and a drilldown never takes its watermark from them.
- **Dashboard** (`/app/analytics`). Filters in the URL (ids only): date range with presets, customer source, salesperson, page. The page asks in three groups because each metric only accepts the filters its definition supports: customers (source + salesperson), tags and statuses (salesperson), conversations (page). The UI defaults to all customer sources so a CRM-only shop sees data; the API default for `customers.new` stays channel-only. Each card has a definition popover; clicking a card or a breakdown row opens the drilldown.
- **Still open** (T-042): the acceptance suite of the BA cases, plan entitlements for premium statistics, role/source/page scoping beyond owner scope, CSV export.
