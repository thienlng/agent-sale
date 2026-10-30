# ADR-014: SaaS vertical — customer statuses, customer subscriptions and a built-in bot tool

- Status: Proposed
- Date: 2026-10-30
- Decision makers: thienlng

## Context

Version 2 adds businesses that sell software subscriptions ("SaaS"). Rapiz is one of them and will run its own customers through the product (dogfooding, back-office in a follow-up PR). A SaaS shop's sale is not a shipped order or a dated stay: the customer asks for a demo or a trial, staff follow up, and the customer becomes a subscriber on a plan with a stage (trial, active, past due, cancelled), a billing period and a monthly recurring revenue (MRR).

The owner decided (2026-10-30) that the bot itself may record a demo/trial request from the conversation. Today the bot can only call owner-declared HTTPS actions (`modules/action`, docs/actions.md); their pending confirmations and run log reference `bot_actions` by foreign key, and lodging (ADR-013) deliberately has no AI booking action. [docs/17](../17-multi-tenancy-and-verticals.md) anticipates per-vertical objects and tools.

A first cut kept requests in their own table with their own status flow, and put requests and subscribers on two extra pages. The owner rejected it (2026-10-30): the same person showed up in three places with three statuses. SaaS CRMs avoid that. HubSpot keeps one record per contact with a lifecycle stage on it and never downgrades the stage automatically. Attio's Stripe sync writes plan, MRR and renewal as attributes on the customer record. The common "lead → trial → paying → churned" SaaS pipeline is a set of views on one list, with one writer per field.

## Decision

1. **Industry `saas`** joins the industry list with its own profile fields (plans and prices, free trial, demo, integrations, onboarding, support, data security, refund and cancellation; `payment` is shared), seed pack and starter rules. No new prompt version: the profile, rules and the tool description carry the SaaS behaviour.
2. **SaaS customer statuses.** `crm` seeds a SaaS business with its own built-in statuses instead of the generic ones: `new_lead`, `contacted`, `requested`, `trial`, `paying`, `past_due`, `churned`, in that order. They are ordinary `crm_statuses` rows, editable in CRM settings. `crm` exposes two system writes on its facade: move a customer to a status by built-in key (optionally forward only, by position), and add a note signed by a name instead of a member. Both leave the usual history entry and event.
3. **New tier-2 module `saas`** (depends on the `crm` and `workspace` facades only) owns one tenant table under forced RLS (migration 0036). `saas_subscriptions` holds one row per customer, with a composite FK to `contacts`. A row has a plan name, stage, billing period, MRR in integer VND, seats, the trial end / start / renewal / cancellation dates, an optional external reference and an optimistic version. Staff enter it today; Rapiz HQ will fill it from billing in the follow-up. **The subscription decides the customer's status, one way:** `trial` → `trial`, `active` → `paying`, `past_due` → `past_due`, `canceled` → `churned`. A status change never edits the subscription. Demo and trial requests have no table.
4. **Built-in bot tool.** For a `saas` bot, the `ai` module adds one built-in entry to the `<actions>` block: `builtin.saas.request`, with `confirm: no`.
   - The action loop routes built-in ids to the `saas` facade in-process: no network call, no `bot_actions` row, no `action_runs` row.
   - The tool needs a name and a phone. The phone (and any email) must be vouched by the customer's own words: the phone's last 9 digits, or the whole email address.
   - A call finds or creates the customer by phone (one phone = one customer). It moves the customer forward to `requested` and never moves one already at or past it. Then it adds a note signed "Bot AI" with the request kind and details.
   - A repeat of the latest note is skipped, so retries are idempotent.
   - Playground (test) calls never write; they return a preview.
   - Staff remain the ones who contact, schedule and convert.
5. **One customer list.** The web app adds no SaaS pages. For members with `contacts.view_all`, the customer list of a SaaS business gains three things:
   - a summary strip: MRR, customers per stage (each one filters the list by status), and trials ending soon;
   - plan, MRR and next-date columns;
   - the subscription card in the customer sheet and the Inbox sales panel.

## Options considered

1. **Use the generic HTTPS action module** (owner declares an action pointing at their own API): rejected. Shops without an API get nothing, and calling our own API over HTTPS from the bot would bypass tenant transactions.
2. **A separate `saas_requests` table with its own status flow and pages** (the first cut): rejected. It splits one person into a request, a customer and a subscriber with three statuses, and staff must link them by hand.
3. **Put subscriptions in `crm`** (custom fields or tags): rejected. Stage, MRR and dates need typed columns, totals and validation, and `crm` stays industry-neutral apart from its seed sets.
4. **Confirm-required built-in tool via `action_pending`**: deferred. `action_pending` references `bot_actions`. A request is a low-risk, staff-reviewed lead the customer is already asking for, so an extra confirmation turn adds friction without protecting money or inventory.

## Consequences

- `ai` gains an optional dependency on the `saas` facade (tier 2 → tier 2, like `commerce`). Other industries see no change in their prompt or actions block.
- Subscriptions and MRR need `contacts.view_all` (owner, admin, analyst), because they are revenue figures across customers. Writing a subscription also needs `contacts.edit`.
- Staff can still move a customer to `trial`, `paying`, `past_due` or `churned` by hand. The next subscription save puts the status back in line with the stage.
- The tool does not link the conversation to the customer (`saas` may not depend on `conversation`, tier 3). Facebook and Instagram conversations link themselves by phone, and webchat links its lead. A Zalo conversation is linked by staff.
- Follow-ups:
  - the Rapiz HQ workspace, created by the system and synced from signups and billing (next PR);
  - confirm-required built-in tools;
  - a plan catalog with prices;
  - reminders before trial end and renewal.
