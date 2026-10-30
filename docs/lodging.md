# Whole-property lodging (T-155)

Hotel businesses use **Accommodations** (`/app/accommodations`) and **Stay requests** (`/app/stays`). The shared catalog retains a single product/variant per whole property; its bedrooms, guest allowances, amenities, weekday references, policies and captioned gallery are validated accommodation metadata. Hotel product and bot-product routes open the same editor. The Inbox sales panel can open a stay request with the selected contact's name/phone. A stay is not currently linked to a conversation.

## Operator workflow

1. Configure the property. Leave missing policies blank; mark the rate basis unconfirmed until the owner establishes it. Weekday references cover all seven ISO weekdays exactly once. Standard adults/children are allowances, not an invented maximum; `childAgeBelow` is exclusive.
2. Enter check-in/check-out local dates, adults, children and optionally every child's age. A partial age list is invalid. Dates must exist, checkout must follow check-in, and a request spans at most 90 nights.
3. Preview references. With an unconfirmed rate basis there is **no calculated total**. A nightly basis allows an estimated base total, excluding unconfigured extras/holidays/taxes. The local conflict check can find confirmed occupancy; it cannot establish physical availability across other booking channels.
4. Save an unconfirmed request. Replaying the same key and payload returns that request; changing payload under a used key returns 409. Requested/reviewing records do not hold dates. A changed form invalidates the displayed preview.
5. Staff can mark reviewing, confirm or cancel. Confirmation requires both availability and guest/terms attestations plus an explicit integer agreed total. It rechecks current property capacity, local overlap and optimistic version. Adjacent checkout/check-in dates are allowed. Cancellation releases local occupancy, with no refund/payment side effect. Cancelled requests cannot be revived; make a new request for changed dates.

Agreed total records an agreement, **not collected money**. There is no deposit ledger, payment, external calendar/PMS synchronization, automated rescheduling or AI booking action in this slice. Bot conversation alone cannot create or confirm a stay.

## API and isolation

All routes are authenticated and workspace-scoped. Hotel industry is required. `orders.view` permits listing/detail/reference quotes; `orders.manage` permits creation/status changes; accommodation editing uses `catalog.manage`.

| Route | Behavior |
| --- | --- |
| GET `/stay-requests?offset=0&propertyId=…&status=…` | 100 rows, newest first; `nextOffset` or null. UI exposes previous/next pages. |
| GET `/stay-requests/{id}` | Tenant-owned request or 404. |
| POST `/stay-requests/quote` | Read-only reference snapshot and internal conflict result. |
| POST `/stay-requests` | Idempotent unconfirmed request, status 201. |
| PATCH `/stay-requests/{id}/status` | Versioned state transition; confirmation requires verified flags and agreed total. |

Migration `0035_lodging_stay_requests.sql` adds nullable product metadata and forced-RLS stay requests with a composite tenant/product FK. Confirmation locks the property and uses a GiST exclusion constraint on `(workspace, property, daterange(check_in, check_out, '[)'))` for confirmed records. A competing confirmation returns 409. Writes and non-PII audit metadata share the tenant transaction. Accommodation variants are excluded from retail variant search and order resolution; stock adjustments are rejected.

## AI behavior

Hotel bots automatically use `sales-agent@12`; retail defaults to @11 and explicit pins of older versions remain supported. Accommodation context omits warehouse stock and generic retail price fields. Reference units, guest standards and unavailable policies remain distinct from facts. Unknown availability is an inquiry requiring dates/checking, rather than sold-out stock or a fabricated vacancy. The bot can explain the known standard before seeking staff approval for a larger party. Captioned accommodation gallery photos, including images after the retail five-image limit, enter the query-ranked image allowlist. URLs never enter model context.

See [ADR-013](adr/ADR-013-lodging-catalog-and-stay-requests.md), [A17 sample](business/villas-a17-sample-data.json), and [A17 acceptance](business/villas-a17-acceptance.md).
