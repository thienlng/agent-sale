# ADR-014: SaaS vertical — saas module, demo/trial requests, customer subscriptions and a built-in bot tool

- Status: Proposed
- Date: 2026-10-30
- Decision makers: thienlng

## Context

Version 2 adds businesses that sell software subscriptions ("SaaS"). Rapiz is one of them and will run its own customers through the product (dogfooding, back-office in a follow-up PR). A SaaS shop's sale is not a shipped order or a dated stay: the customer asks for a demo or a trial, staff follow up, and the customer becomes a subscriber on a plan with a stage (trial, active, past due, cancelled), a billing period and a monthly recurring revenue (MRR).

The owner decided (2026-10-30) that the bot itself may record a demo/trial request from the conversation. Today the bot can only call owner-declared HTTPS actions (`modules/action`, docs/actions.md); their pending confirmations and run log reference `bot_actions` by foreign key, and lodging (ADR-013) deliberately has no AI booking action. [docs/17](../17-multi-tenancy-and-verticals.md) anticipates per-vertical objects and tools.

## Decision

1. **Industry `saas`** joins the industry list with its own profile fields (plans and prices, free trial, demo, integrations, onboarding, support, data security, refund and cancellation; `payment` is shared), seed pack and starter rules. No new prompt version: the profile, rules and the tool description carry the SaaS behaviour.
2. **New tier-2 module `saas`** (depends on the `crm` facade only) owns two tenant tables under forced RLS (migration 0036):
   - `saas_requests` — demo, trial or consultation requests: lead details (name, phone, email, company, team size, need, preferred time as free text, plan of interest), optional customer (`contact_id`, composite same-workspace FK) and conversation id, source `bot` | `staff`, status `new → contacted → scheduled → converted | closed`, optimistic version, idempotent `client_request_id`. A request reserves nothing and charges nothing.
   - `saas_subscriptions` — one row per customer (composite FK to `contacts`): plan name, stage, billing period, MRR in integer VND, seats, trial end / start / renewal / cancellation dates, optional external reference, optimistic version. Entered by staff; Rapiz HQ will fill it from billing in the follow-up.
3. **Built-in bot tool.** For a `saas` bot the `ai` module adds one built-in entry to the `<actions>` block (`builtin.saas.request`, `confirm: no`). The action loop routes built-in ids to the `saas` facade in-process (no network, no `bot_actions` row, no `action_runs` row). The write is idempotent per conversation and kind (`bot:<conversationId>:<kind>`): a repeat call fills in or corrects the lead details while the request is still `new`, never creates a second request. The tool needs a name and a phone or email; argument values are vouched by the customer's own words like any action. Playground (test) calls never write; they return a preview. Staff remain the ones who contact, schedule and convert.

## Options considered

1. **Use the generic HTTPS action module** (owner declares an action pointing at their own API): rejected — shops without an API get nothing, and calling our own API over HTTPS from the bot would bypass tenant transactions.
2. **Put requests and subscriptions in `crm`** (custom fields or tags): rejected — stage, MRR and dates need typed columns, totals and validation; `crm` stays industry-neutral.
3. **Confirm-required built-in tool via `action_pending`**: deferred — `action_pending` references `bot_actions`; a request is a low-risk, staff-reviewed lead that the customer is already asking for, so an extra confirmation turn adds friction without protecting money or inventory.

## Consequences

- `ai` gains an optional dependency on the `saas` facade (tier 2 → tier 2, like `commerce`). Other industries see no change in their prompt or actions block.
- Requests are visible to members with `contacts.view` and changed with `contacts.edit`; subscriptions and MRR totals need `contacts.view_all` (owner, admin, analyst) because they are revenue figures across customers.
- A bot-created request links to a customer only when the phone matches an existing customer (`crm` facade lookup); otherwise staff link it.
- Follow-ups: Rapiz HQ workspace created by the system and synced from signups and billing (next PR), confirm-required built-in tools, plan catalog with prices, reminders before trial end and renewal.
