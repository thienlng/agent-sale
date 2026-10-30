# SaaS businesses (ADR-014)

A business with industry `saas` sells software subscriptions. It has no orders or products, and no pages of its own: leads, trials and subscribers are all **customers** on the one customer list (`/app/contacts`), told apart by their status. Rapiz itself is such a business: the system-created Rapiz HQ workspace and its billing sync arrive in the follow-up PR.

This follows the usual SaaS mini-CRM shape: one record per customer, the lifecycle stage on the customer, subscription facts (plan, MRR, trial end, renewal) as attributes of that customer, views and filters instead of separate lists, and one writer per status.

## Customer statuses

A SaaS business gets its own built-in statuses (seeded on first use, editable and orderable like any status in CRM settings):

| Key | Name | Who sets it |
| --- | --- | --- |
| `new_lead` | Lead mới | staff |
| `contacted` | Đã liên hệ | staff |
| `requested` | Xin demo / dùng thử | the bot (forward only), or staff |
| `trial` | Dùng thử | the subscription (stage `trial`) |
| `paying` | Khách trả phí | the subscription (stage `active`) |
| `past_due` | Quá hạn thanh toán | the subscription (stage `past_due`) |
| `churned` | Rời bỏ | the subscription (stage `canceled`) |

The subscription is the only automatic writer of the last four: saving a plan moves the customer to the matching status, one way (a status change never edits the subscription). The bot only moves a customer forward to `requested`; a customer already at or past it in the status order stays where it is. Every automatic move leaves the usual `contact.status_changed` history entry and event, with no staff actor.

## Demo / trial / consultation requests

A request is not a record of its own. When a customer asks the bot for a `demo`, a `trial` or a `consultation` and gives a name and a phone:

1. the customer is found by phone, or created (one phone = one customer; a new customer has no built-in source and a `contact.created` entry with channel `bot`);
2. the customer moves forward to `requested`;
3. a note signed **Bot AI** records what was asked and what the customer said: company, team size, need, preferred time, plan of interest, email. A repeat of the customer's latest note is skipped, so a retried call leaves one note.

Staff follow up from the customer sheet (status, notes, owner) like any other lead.

## Subscriptions

One subscription per customer, edited on the customer sheet (overview tab, **Subscription** card, also shown in the Inbox sales panel): plan name, stage (`trial | active | past_due | canceled`), billing period (`monthly | quarterly | yearly`), MRR in whole VND per month (a yearly price counts / 12), seats, trial end / start / renewal / cancellation dates, an external reference and a note. A trial needs its end date and a cancellation its date. The first save sends `version: null`; later saves send the current version.

For members with `contacts.view_all`, the customer list of a SaaS business adds:

- a **summary strip** on top: MRR of active and past-due subscriptions; customers paying, on trial, past due and churned (a click filters the list by that status); trials ending in the next 7 business-local days, today included (a click lists them, and a name opens the customer);
- **Plan**, **MRR** and **Next date** (trial end for a trial, renewal otherwise) columns per row, loaded for the rows of the current page.

## Permissions

| Action | Capability |
| --- | --- |
| Read subscriptions, list and summary (revenue) | `contacts.view_all` (owner, admin, analyst) |
| Create / update a subscription | `contacts.view_all` **and** `contacts.edit` |

Every route returns 404 when the workspace is not a SaaS business.

## API

| Route | Behavior |
| --- | --- |
| GET `/saas-subscriptions?stage=&contactIds=&endingSoon=&offset=0` | 100 rows with the customer's display name, most recently updated first. `contactIds`: comma-separated, at most 100. `endingSoon=true`: trials ending in the next 7 days, soonest first. |
| GET `/saas-subscriptions/summary` | MRR, stage counts, trials ending soon. |
| GET `/contacts/{id}/saas-subscription` | `{subscription}` or `{subscription: null}`. |
| PUT `/contacts/{id}/saas-subscription` | Create (`version: null`) or versioned update; then moves the customer's status. |

Writes and their audit events (`saas.subscription.created|updated`, no PII in metadata) share the tenant transaction. Table: [data model](05-data-model.md#implemented-saas-extension-adr-014).

## Bot behavior

A SaaS bot sees one built-in entry in its `<actions>` block, `builtin.saas.request` (no confirmation turn). The action loop runs it in-process through the `saas` facade: no `bot_actions` row, no HTTP call, no `action_runs` row.

- Arguments: `kind`, `name` and `phone` are required; email, company, team size, need, preferred time and plan of interest are optional. A phone or email the customer never wrote in the conversation (last 9 digits of the phone; the whole email address, not part of a longer one) is refused as `invalid_args`, so the model cannot invent contact details.
- The tool answers `recorded: true`; a call with a fuller set of details adds a newer note.
- Playground and test conversations get a preview result and never write.

The bot never contacts, schedules or converts; staff do. The industry profile fields (plans and prices, trial, demo, integrations, onboarding, support, data security, refunds) and the starter rules carry the rest of the SaaS behaviour.

**Limitation:** the bot's tool does not link the conversation to the customer. Facebook and Instagram conversations link themselves by phone after a customer message, and webchat links its lead; a Zalo conversation is linked by staff.
