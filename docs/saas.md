# SaaS businesses (ADR-014)

A business with industry `saas` sells software subscriptions. Its sidebar shows **Demo / trial requests** (`/app/saas-requests`) and **Subscribers** (`/app/saas-customers`) instead of orders and products. Rapiz itself is such a business: the system-created Rapiz HQ workspace and its billing sync arrive in the follow-up PR.

## Requests

A request is a lead asking for a `demo`, a `trial` or a `consultation`: name, phone and/or email (at least one), company, team size, need, preferred time and plan of interest as free text, an optional customer (`contact_id`) and conversation. It reserves nothing and charges nothing.

- **Created by the bot** with the built-in tool below (`source = bot`), or **by staff** from the requests page or the Inbox panel (`source = staff`, prefilled with the conversation's name, phone and linked customer).
- **Status** `new → contacted → scheduled → converted | closed`; `contacted` and `scheduled` can swap; `converted` and `closed` are final. Every change carries the row `version` (409 when stale).
- **Idempotent**: staff requests carry a `clientRequestId`; replaying the same payload returns the same request, a different payload under the same key returns 409.

## Subscriptions

One subscription per customer, edited on the customer profile (overview tab, **Subscription** card): plan name, stage (`trial | active | past_due | canceled`), billing period (`monthly | quarterly | yearly`), MRR in whole VND per month (a yearly price counts / 12), seats, trial end / start / renewal / cancellation dates, an external reference and a note. A trial needs its end date and a cancellation its date. The first save sends `version: null`; later saves send the current version.

The **Subscribers** page shows the summary (MRR of active and past-due subscriptions, counts per stage, trials ending within 7 business-local days, requests still `new`) and the list filtered by stage, linking each row to the customer profile.

## Permissions

| Action | Capability |
| --- | --- |
| List / read requests | `contacts.view` |
| Create / update requests | `contacts.edit` |
| Read subscriptions, list and summary (revenue) | `contacts.view_all` (owner, admin, analyst) |
| Create / update a subscription | `contacts.view_all` **and** `contacts.edit` |

Every route returns 404 when the workspace is not a SaaS business.

## API

| Route | Behavior |
| --- | --- |
| GET `/saas-requests?status=&kind=&offset=0` | 100 rows, newest first; `nextOffset` or null. |
| POST `/saas-requests` | Idempotent staff request, 201. |
| GET `/saas-requests/{id}` | Tenant-owned request or 404. |
| PATCH `/saas-requests/{id}` | Versioned update: status, details, customer link, note. Cannot go back to `new`; keeps a phone or an email. |
| GET `/saas-subscriptions?stage=&offset=0` | 100 rows with the customer's display name. |
| GET `/saas-subscriptions/summary` | MRR, stage counts, trials ending soon, new requests. |
| GET `/contacts/{id}/saas-subscription` | `{subscription}` or `{subscription: null}`. |
| PUT `/contacts/{id}/saas-subscription` | Create (`version: null`) or versioned update. |

Writes and their audit events (`saas.request.created|updated`, `saas.subscription.created|updated`, no PII in metadata) share the tenant transaction. Tables: [data model](05-data-model.md#implemented-saas-extension-adr-014).

## Bot behavior

A SaaS bot sees one built-in entry in its `<actions>` block, `builtin.saas.request` (no confirmation turn). The action loop runs it in-process through the `saas` facade: no `bot_actions` row, no HTTP call, no `action_runs` row.

- Arguments: `kind` and `name` are required, plus a phone or an email. A phone or email the customer never wrote in the conversation (last 9 digits of the phone; the email verbatim) is refused as `invalid_args`, so the model cannot invent contact details.
- One request per conversation and kind (key `bot:<conversationId>:<kind>`): a repeat call fills in or corrects the details while the request is still `new`; later it is left alone. Concurrent calls are serialized by an advisory lock.
- The request is linked to an existing customer when the phone matches one; otherwise staff link it.
- Playground and test conversations get a preview result and never write.

The bot never contacts, schedules or converts; staff do. The industry profile fields (plans and prices, trial, demo, integrations, onboarding, support, data security, refunds) and the starter rules carry the rest of the SaaS behaviour.
