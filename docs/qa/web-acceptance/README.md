# Rapiz web acceptance pack — T-125

Owner review draft, 2026-10-29. Baseline: `main` at `b0f1be6`. This is an executable acceptance specification, **not an execution report**. No case in this pack has been run merely because it is documented. Earlier automated smoke tests and the observed existing TinyMind exchange do not count as execution of these cases.

## Review and execution order

1. [Shared data, independent evidence and statistics oracle](data-and-oracles.md).
2. [Landing, authentication, business scope and bot behavior](01-journey-and-bot.md).
3. [Inbox controls, composer, filters, CRM context and Facebook comments](02-inbox.md).
4. [Every statistics metric, chart, breakdown, filter and portfolio](03-statistics.md).
5. [Supporting screens, permissions, resilience and mobile](04-supporting-and-quality.md).
6. [Control-to-case coverage map](coverage.md).
7. [Execution ledger (CSV)](execution-ledger.csv). Copy it for each run; never overwrite the previous run's evidence.

The detail files use English, as required for repository technical documentation. Quoted Vietnamese names are the actual product labels, with an English explanation where needed.

## Environment lanes

| Lane | Where / purpose | Allowed operations |
| --- | --- | --- |
| LIVE | The owner's already-open designated Chrome profile; Rapiz and Messenger to TinyMind | Only the owner's test conversation. Approved test sends, reversible own-thread controls and QA notes. Existing bot responses consume the configured AI allowance; record actual sends rather than assuming one response per incoming message. |
| ISOLATED | A disposable workspace with synthetic contacts, conversations, users and a known clock; real backend/database where possible | Deterministic statistics, role accounts, multiple pages, boundary dates, error simulation, bulk selection and order drafts. Mocks prove only the UI response to fixtures, not backend/provider correctness. |
| CONDITIONAL | A named fixture, role, channel or additional approval is missing | Record BLOCKED with the exact dependency; do not silently pass or create customer-facing side effects to satisfy it. |
| DEFERRED | Capability absent from the baseline or product rule not decided | Record NOT_IMPLEMENTED or DECISION_REQUIRED; keep it visible in release scope. |

Cases marked LIVE + ISOLATED must be run in **both** lanes; an isolated pass does not prove Facebook delivery, and a live pass does not prove failure handling. For a combined lane, record separate ledger rows/evidence for each execution.

## Live session boundaries

- Identify the current authorized business, TinyMind channel and assigned active bot from the actual UI. Record IDs privately in the run evidence; never infer that a page is a shop.
- Only the owner's Messenger conversation is live test data. Do not open unrelated customer threads to manufacture a second example. Additional people, pages and roles belong in ISOLATED.
- Prefix outbound customer-visible text with `[QA <run-id> <case-id>]`. Never use real phone numbers, emails, addresses, customer screenshots or private documents as fixtures.
- Do not change page credentials, disconnect a channel, publish a public comment/reply, hide another person's comment, create a real order, buy a plan, block/delete/report a person or execute a billable bot action without separate scope approval. Such cases are isolated or conditional below.
- Preserve the original bot/human mode, assignee, priority, status and follow-up before modifying them. Restore these at the end. Mark-read/unread and external message history cannot be restored perfectly; disclose the remaining effects.
- Do not run negative-network or session-expiry tests against the owner's only working Chrome session. Use a separate test browser/context. Do not log out the owner to test cleanup.
- Do not modify bot training, catalog or global automation while exercising a live conversation. Use approved existing knowledge and a dedicated QA bot for mutation cases.
- Order creation is tested as a draft only; persist an order only in a disposable environment with outbound/shipping/payment actions disabled.

## Definition of a complete case

For every case: verify prerequisites; record the starting state and expected values **before** acting; perform all steps; compare UI, persisted source and (when applicable) Messenger; check after reload and navigation; record console/network errors with secrets removed; perform cleanup; attach evidence and actual results. A control working once is not enough: check scope, persistence, failure and permissions through the linked cases.

Use a 60-second observation window for live polling/bot response **as a diagnostic timeout, not an agreed product SLA**. Record first-visible timestamps and actual delay. A missing result at the deadline is investigated using scoped request/job metadata; do not send repeated probes or retry uncertain sends. Analytics has its own freshness/watermark rules in the data guide; a stale response is not a zero.

## Result vocabulary and release decision

- `NOT_RUN`: no execution evidence yet (initial value for every case).
- `PASS`: every expected assertion met in the stated lane/build; evidence and cleanup recorded.
- `FAIL`: an assertion contradicted by evidence; link a tracked bug and the failing step.
- `BLOCKED`: environment/data/role unavailable; name what is needed.
- `NOT_IMPLEMENTED`: expected capability is absent; distinguish an agreed deferred feature from a regression.
- `DECISION_REQUIRED`: the business rule has no approved answer; show current behavior, do not invent a passing formula.

P0 = tenant/privacy boundaries, message loss/duplicate delivery, incorrect sender/routing, fabricated commercial facts, wrong statistics calculations; P1 = core usability, persistence, filtering and recovery; P2 = non-blocking presentation and convenience. Release requires all in-scope P0/P1 to pass or explicit owner acceptance of named exceptions; no blanket "web complete" while required cases are blocked. Record known T-122 layout timeout separately from a product layout defect.

## Run record

Each run has: run ID, time/timezone, git SHA, build mode (dev/production), app/site URLs, browser/version, viewport/device, business/page/bot aliases, role, entitlements, fixture version, case IDs, actual inputs/outputs, event/provider IDs, durations, source-query recipe, expected/actual numbers, screenshots and sanitized console/network errors. Store raw live screenshots privately outside git; repository evidence uses synthetic data. Never attach HAR files with cookies/tokens or real conversations without redaction.

The ledger records one row per case/variant/run. Retests are new rows with the bug ID, fixed SHA and regression outcome; keep the original failing evidence. Every executed result requires actual outcome, evidence (including blocker evidence) and cleanup result. FAIL and bug retests require a tracked bug ID; a clean PASS uses N/A in the bug field. Evidence/actual/cleanup may remain blank only while NOT_RUN.

## Baseline limits and unresolved decisions

- Twelve statistics cards exist; `comments.received` explicitly has no analytics source despite Facebook comment handling being present. No conversion rate, response-time, revenue or bot-only-message card exists on this statistics page. These are not silently added to acceptance.
- The API definition defaults customer origins to channel; the dashboard intentionally requests channel + manual + import. Event-time attribution, first stored phone and snapshot meaning are implemented proposals in [analytics documentation](../../analytics.md), not evidence of final owner sign-off.
- Conversation tags and CRM contact tags share a library but are distinct assignments. An inbox read marker is not a CRM status. Inbox conversation assignment and CRM sales ownership are separate. Do not count one as the other.
- Current CRM selection supplies context/order data; durable conversation-to-contact linkage and full historical order linking are not promised. Orders in the inbox panel are current-session creations, not all historical purchases.
- WhatsApp and Instagram comments are unsupported; direct DM file upload, cross-device drafts, full archived-message search, shop/bot inbox filters, first-class shops and account-wide usage billing are not complete in this baseline. Missing cofounder integration is not disguised as a passing test.
- Snapshot totals are at `asOf` (now by default), not the sum of changes in the date range. Daily distinct totals and multi-tag breakdown sums need not equal range-distinct card totals.

## Source references

- [Analytics behavior and open decisions](../../analytics.md).
- [Sales inbox behavior and current limits](../../18-sales-inbox-workspace.md).
- [Meta inbox BA specification](../../business/rapiz-inbox-meta-ba.vi.md).
- [Lane B closeout and dependency boundaries](../../handoffs/2026-10-28-lane-b-closeout.md).
- UI inventory: `apps/web/src/features/{analytics,conversation,channel}/components`, `apps/web/src/components/layout/account-menu.tsx`.
- Contracts: `packages/contracts/src/{analytics,conversation,crm}`; do not promote branch-only contracts to current-main acceptance.
