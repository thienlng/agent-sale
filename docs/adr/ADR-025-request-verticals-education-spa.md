# ADR-025: Request verticals — one built-in `record_request` tool written by crm; education and spa

- Status: Proposed
- Date: 2026-11-04
- Decision makers: thienlng
- Supersedes in part: [ADR-020](ADR-020-saas-vertical-requests-subscriptions-builtin-tool.md) §4 (the writer moved to `crm`, the tool became `record_request`)
- Design: [spec](../superpowers/specs/2026-11-04-verticals-education-spa-design.md), [plan](../superpowers/plans/2026-11-04-verticals-education-spa.md) (T-187)

## Context

`education` (language and training centres) and `spa` (spa, salon, beauty clinic) existed as `Industry` values with seed packs, but sign-up did not offer them: they had no verified product flow. Their conversion is not an order. An education customer asks for a placement test, a trial class or a roadmap consultation; a spa customer asks for an appointment. Staff confirm each one. The bot had no way to record that. An education or spa bot either sent a delivery-address order or handed off.

ADR-020 already solved the same problem for `saas`: the built-in tool `record_saas_request` finds or creates the customer by phone, moves its status and leaves a signed note, with no requests table. Its writer lived in the `saas` module, although it only used the `crm` facade. The commerce catalog also could not describe a course or a service. It had no duration, sessions, format or level, and the bot saw a service with no stock as "hết hàng".

## Decision

1. **One generalised tool.** The saas tool becomes `record_request`, offered to every request industry (`REQUEST_INDUSTRIES = saas, education, spa`). Each industry's kinds (`demo`, `trial`, `consultation`, `placement_test`, `appointment`), fields, required and recommended groups, target status moves, Vietnamese labels and English tool description are data: `REQUEST_PROFILES` in `packages/contracts/src/crm/customer-request.ts`. The saas behaviour is unchanged: the same kinds, the same required name and phone, `requested` forward-only, and a byte-identical note. The vouching rule stays: the phone's last 9 digits and any whole email address must appear in the customer's own words. Playground calls are previews. Old traces with `record_saas_request` still render.
2. **The writer is in `crm`.** `CrmFacade.recordBotRequest` (`CustomerRequestService`) validates against the profile and the required groups. It checks the phone and rejects a past `preferredDate` (Asia/Ho_Chi_Minh). It computes the day label (`dateLabel`, from the shared `vietnameseDateLabel`), so the model never works out a weekday. Then it upserts the customer by phone and, in one transaction, moves the status, writes the history entry and adds a note signed "Bot AI". `CrmFacade.requestsRecorded` feeds the reports. The old saas writer (`SaasFacade.recordBotRequest`, `SaasLeadService.recordFromBot`) is deleted. `saas` now has no facade, only its runner and events, like `developer`.
3. **`ai` depends on `crm`, not `saas`.** `ai` injects the optional `CRM_FACADE` (tier 2 → tier 2, like `commerce`). `crm` depends on neither `ai` nor `saas`, so there is no cycle.
4. **Requests are history entries (ESV-R2).** A request is a `contact_history` entry `contact.request_recorded`, plus a note and a status move. The entry's `data` holds the kind, the details without phone or email, and the `dateLabel`. The same kind again within 24 h is `contact.request_updated`, with a `Cập nhật: …` note; an exact retry writes nothing. There is no requests table and no request status: the customer status is the queue. Education and spa move the status "unless at a confirmed status" (a `keep` list), so a returning customer re-enters the queue. Saas stays forward-only. Staff see the requests through `GET /crm/requests/summary` (counts per status and the open requests, `contacts.view_all`) and `GET /contacts/{id}/requests`. The assistant reads them through the SQL view `assistant_sql.customer_requests`, which has no names, phones or free text.
5. **Offerings.** A course or a service is a commerce product with a typed, nullable `offering` jsonb (migration 0064): `kind course | service`, duration, sessions, period, format, level, schedule, audience, outcomes and `priceNote`. A product has `offering` or `accommodation`, never both. Offerings have no stock. The bot sees `catalogKind` without stock fields, and a 0 price means "see `priceNote`". `prepareBotOrder` refuses them (`not_sold`), and request-industry bots never get order tools.
6. **`sales-agent@19`.** One prompt serves saas, education and spa: `@15` plus a "Recording a request" section, the offering catalog facts, and a phone rule that records a request instead of handing off. There is no per-industry prompt. Industry behaviour comes from the profile, the starter rules and the tool description. Saas moved to `@19` because its live eval passes there and hands off on `@15` (ESV-R6).

`education` and `spa` join `SELECTABLE_INDUSTRIES`.

## Options considered

1. **A tool and a writer per vertical** (copy the saas writer into an education and a spa writer): rejected. The three writers do the same upsert, status move and note. Only the data differs, and a profile in contracts carries it.
2. **Keep the writer in `saas` and let `ai` call it for every request industry**: rejected. `saas` is an industry module, and education and spa would depend on it for no saas reason. The writer only needs `crm`.
3. **A `customer_requests` table with its own status flow and a requests page**: rejected for now, as in ADR-020. It splits one person into a request and a customer, with two statuses. History entries can be backfilled into a table if staff need per-request assignment or reminders.
4. **Describe courses and services in product attributes or the description**: rejected. The bot needs typed facts to stop reporting stock and quoting 0 prices.

## Consequences

- The saas tool name in traces changes from `record_saas_request` to `record_request`; old traces still render.
- `CrmFacade` grows two use cases. `crm` stays industry-neutral apart from its seed sets and the request profiles it reads from contracts.
- A spa or school with real slot capacity still gets no availability engine (docs/17 §4 `appointments`): staff confirm every request, and the bot never says a slot is booked.
- A request-industry business that also sells retail products cannot take bot orders for them (ESV-R7).
- An imported course or service becomes a plain product until the owner adds its `offering`: the import executor does not know the industry.
- Follow-ups: an offering-aware product import, per-request assignment or reminders if staff ask for them (a table backfilled from history), and a per-industry prompt only if live evals show drift.
