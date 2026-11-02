# SaaS businesses (ADR-020)

A business with industry `saas` sells software subscriptions. It has no orders or products, and no pages of its own: leads, trials and subscribers are all **customers** on the one customer list (`/app/contacts`), told apart by their status. Rapiz itself is such a business: the Rapiz HQ workspace mirrors every platform account as a customer with its subscription ([below](#rapiz-hq-sync-adr-021)).

This follows the usual SaaS mini-CRM shape: one record per customer, the lifecycle stage on the customer, subscription facts (plan, MRR, trial end, renewal) as attributes of that customer, views and filters instead of separate lists, and one writer per status.

## Customer statuses

A SaaS business gets its own built-in statuses (seeded on first use, editable and orderable like any status in CRM settings):

| Key | Name | Who sets it |
| --- | --- | --- |
| `new_lead` | Lead mới | staff |
| `contacted` | Đã liên hệ | staff |
| `requested` | Xin demo / dùng thử | the bot (forward only), or staff |
| `demo_scheduled` | Đã hẹn demo | staff |
| `trial` | Dùng thử | the subscription (stage `trial`) |
| `free_plan` | Dùng gói miễn phí | the subscription (stage `free`) |
| `paying` | Khách trả phí | the subscription (stage `active`) |
| `past_due` | Quá hạn thanh toán | the subscription (stage `past_due`) |
| `churned` | Rời bỏ | the subscription (stage `canceled`) |

The subscription is the only automatic writer of `trial`, `free_plan`, `paying`, `past_due` and `churned`: saving a plan moves the customer to the matching status, one way (a status change never edits the subscription). The bot only moves a customer forward to `requested`; a customer already at or past it in the status order stays where it is. Businesses seeded before migration 0054 get `demo_scheduled` after `requested` and `free_plan` after `trial`. Every automatic move leaves the usual `contact.status_changed` history entry and event, with no staff actor.

## Demo / trial / consultation requests

A request is not a record of its own. When a customer asks the bot for a `demo`, a `trial` or a `consultation` and gives a name and a phone:

1. the customer is found by phone, or created (one phone = one customer; a new customer has no built-in source and a `contact.created` entry with channel `bot`);
2. the customer moves forward to `requested`;
3. a note signed **Bot AI** records what was asked and what the customer said: company, team size, need, preferred time, plan of interest, email. A repeat of the customer's latest note is skipped, so a retried call leaves one note.

Staff follow up from the customer sheet (status, notes, owner) like any other lead.

## Subscriptions

One subscription per customer, edited on the customer sheet (overview tab, **Subscription** card, also shown in the Inbox sales panel): a plan from the catalog or a typed plan name, stage (`trial | free | active | past_due | canceled`), billing period (`monthly | quarterly | semiannual | yearly`), MRR in whole VND per month, seats, trial end / start / renewal / cancellation dates, an external reference and a note. A catalog plan names the subscription and sets its MRR (the plan's price for the period divided by the months in it; a period without a price is refused); without one, the MRR is typed (a yearly price counts / 12). A trial needs its end date; a cancellation needs its date and, when staff cancel, a churn reason (`price | missing_feature | competitor | no_longer_needed | poor_support | business_closed | other`) with an optional note. The first save sends `version: null`; later saves send the current version.

**History.** Every change of plan, stage or MRR appends a `saas_subscription_history` row (from → to, churn reason, source `staff | sync | system`, actor); the card's **History** button lists them, newest first.

**Read-only linked rows.** A subscription written by the Rapiz HQ sync (`external_source = 'rapiz'`) keeps its plan, stage, period, MRR, dates and external reference: a staff PUT that changes one answers 400 `VALIDATION_FAILED` with `LINKED_READ_ONLY` per field; seats, the note and the churn reason stay editable. The form shows those fields disabled with a lock hint.

## Plan catalog

CRM settings → **Plans** (`/app/crm-settings/saas-plans`, SaaS businesses only): a name and the price of a whole period in VND for any of the four periods. Active plan names are unique per business (409 `CONFLICT`). Plans are archived, never deleted: an archived plan is no longer offered, and a subscription already on it keeps it (a new subscription on an archived plan is refused). Editing a plan's prices does not rewrite existing subscriptions; their MRR is recomputed on their next save.

## Reminders

A daily job (worker, claimed once per day across workers) adds a follow-up note signed **Rapiz** on customers whose trial ends in 3 days or whose renewal is due in 7 days (dates in Vietnam time). Each reminder is written once per subscription and date (`reminders_sent`). The CRM has no task object yet, so a follow-up is a note.

For members with `contacts.view_all`, the customer list of a SaaS business adds:

- a **summary strip** on top: MRR of active and past-due subscriptions; customers paying, on trial, past due and churned (a click filters the list by that status); trials ending in the next 7 business-local days, today included (a click lists them, and a name opens the customer);
- **Plan**, **MRR** and **Next date** (trial end for a trial, renewal otherwise) columns per row, loaded for the rows of the current page.

## Permissions

| Action | Capability |
| --- | --- |
| Read subscriptions, list and summary (revenue) | `contacts.view_all` (owner, admin, analyst) |
| Create / update a subscription | `contacts.view_all` **and** `contacts.edit` |
| Read the plan catalog | `contacts.view_all` |
| Add / edit plans | `settings.manage` |

Every route returns 404 when the workspace is not a SaaS business.

## API

| Route | Behavior |
| --- | --- |
| GET `/saas-subscriptions?stage=&contactIds=&endingSoon=&offset=0` | 100 rows with the customer's display name, most recently updated first. `contactIds`: comma-separated, at most 100. `endingSoon=true`: trials ending in the next 7 days, soonest first. |
| GET `/saas-subscriptions/summary` | MRR, stage counts, trials ending soon. |
| GET `/contacts/{id}/saas-subscription` | `{subscription}` or `{subscription: null}`. |
| PUT `/contacts/{id}/saas-subscription` | Create (`version: null`) or versioned update; then moves the customer's status. 400 with `LINKED_READ_ONLY` when a synced field of a linked row changes. |
| GET `/contacts/{id}/saas-subscription/history` | Plan / stage / MRR changes, newest first. |
| GET `/saas-plans` | The plan catalog, archived plans included, by position. |
| POST `/saas-plans` | Add a plan (`name`, `prices`, `position`). |
| PATCH `/saas-plans/{planId}` | Rename, reprice, archive or restore (`expectedVersion`). |

Writes and their audit events (`saas.subscription.created|updated`, no PII in metadata) share the tenant transaction. A created subscription, or a change of plan, stage, period, MRR or one of its dates, also writes `saas.subscription.changed.v1` to the outbox in that transaction; it is the source of the public `saas.subscription.changed` webhook (ADR-022). The subscription routes above, except the summary and plan writes, accept workspace API keys with the `contacts.view_all` scope. Table: [data model](05-data-model.md#implemented-saas-extension-adr-020).

## Bot behavior

A SaaS bot gets one built-in tool in its agent loop, `record_saas_request` (no confirmation turn; `apps/backend/src/modules/ai/application/saas-tools.ts`, added by `turnTools` next to the order and hold tools). It runs in-process through the `saas` facade: no `bot_actions` row, no HTTP call, no `action_runs` row. The call shows in the reply's `actions` list like an owner action.

- Arguments: `kind`, `name` and `phone` are required; email, company, team size, need, preferred time and plan of interest are optional. A phone or email the customer never wrote in the conversation (last 9 digits of the phone; the whole email address, not part of a longer one) is refused as `contact_not_from_customer`, so the model cannot invent contact details; arguments the facade rejects come back as `invalid_arguments` with the problems, and a failed write as `not_recorded_retry_later`.
- The tool answers `recorded: true`; a call with a fuller set of details adds a newer note.
- Playground and test conversations get a preview result and never write.

The bot never contacts, schedules or converts; staff do. The industry profile fields (plans and prices, trial, demo, integrations, onboarding, support, data security, refunds) and the starter rules carry the rest of the SaaS behaviour.

**Limitation:** the bot's tool does not link the conversation to the customer. Facebook and Instagram conversations link themselves by phone after a customer message, and webchat links its lead; a Zalo conversation is linked by staff.

## Rapiz HQ sync (ADR-021)

Rapiz runs its own sales and success team as a normal SaaS business, the **HQ workspace** (`RAPIZ_HQ_WORKSPACE_ID`). The platform is the source of truth for accounts and billing; HQ only mirrors them, one way.

- **Setup.** `pnpm --filter @agent-sales/backend hq-init <owner-email>` creates (or finds) the business "Rapiz", industry `saas`, owned by that user, and prints its id; set it as `RAPIZ_HQ_WORKSPACE_ID` on the worker. Then `pnpm --filter @agent-sales/backend hq-backfill --dry-run` (counts only) and `hq-backfill` link every existing account. Unset, the sync, backfill and reconcile do nothing.
- **Live sync.** The worker reads the platform events from the outbox every 2 s (one consumer, advisory lock, checkpoint `saas_hq_checkpoints`, the projector pattern): `account.account.created.v1`, `account.account.status_changed.v1`, `billing.subscription.changed.v1`, `billing.usage.snapshot.v1`, `billing.subscription.reminder.v1`. An event that cannot be applied goes to `saas_hq_dead_letters` by outbox id and code; the others continue.
- **Customer.** One customer per account (the owner, D3), linked with `external_source = 'rapiz'`, `external_id = <accountId>`: the existing customer with the owner's phone, else with the owner's email, else a new one (source "Rapiz"). Phone and email come from the platform and are read-only in HQ (400 `LINKED_READ_ONLY`); the name stays editable.
- **Subscription.** Written with `external_ref = <accountId>`, history source `sync`. Stage: `trialing → trial`, `active → active` (or `free` for the free plan or zero MRR), `past_due → past_due`, `suspended` / `canceled → canceled`. Period from the months (3, 6, 12, else monthly); MRR from the platform. An account without a subscription is on the free plan.
- **Order and idempotency.** Per account and event kind, an event older than the last applied one is ignored (`saas_hq_links.applied`), so a replay or an out-of-order delivery changes nothing.
- **Follow-ups.** A reminder event (trial ending, renewal due, past due) becomes a note signed **Rapiz** once per kind and date; a suspension or reactivation leaves a note; a usage snapshot at 80% or more of the AI-reply limit flags the subscription **Upsell**; crossing that line leaves one note.
- **Nightly reconcile.** Once per day the worker compares every account with HQ (the same code as `hq-backfill`) and fixes drift; a run with nothing to fix writes nothing.
- **Logs.** Codes and counts only, never names, phones or emails.

The backfill and the reconcile read accounts through the platform admin facades (`account.listForAdmin`, `billing.subscriptionsOf` / `listPlans`, `identity.usersByIds`; `saas/application/platform-directory.ts`), read only; MRR follows billing's rule (the period's monthly price while active or past due, else 0).

**Future work (spec §6.7):** more than one contact per customer company (a company entity, or "contact belongs to account").
