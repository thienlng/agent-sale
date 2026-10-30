# saas

**Purpose:** the SaaS vertical (ADR-014): each customer's subscription (plan, stage, MRR) and the bot's demo / trial / consultation capture, for businesses with industry `saas`. Everything lands on the customer record: there is no separate request list.

**Owned tables:** `saas_subscriptions` (migration 0036; schema in `packages/db/src/schema/saas.ts`), referencing `contacts` by a same-workspace composite key.

**Public API (`api/`):**
- `SAAS_FACADE` → `SaasFacade.recordBotRequest(ws, { kind, details, preview })` — the bot's built-in `builtin.saas.request` tool. Finds or creates the customer by phone, moves it forward to the `requested` status (never back) and adds a note with the details; `preview` validates without writing; bad arguments return `invalid`, never throw.
- HTTP: `/saas-subscriptions` (filters `stage`, `contactIds`, `endingSoon`), `/saas-subscriptions/summary`, `/contacts/{id}/saas-subscription` (get, put) with `contacts.view_all` (put also needs `contacts.edit`).
- Events: none yet.

**Depends on:** `workspace` (industry, timezone), `crm` (customer exists, names, lead capture by phone, system status move, system note).

**Invariants:**
- Every route and the bot tool answer 404 for a business whose industry is not `saas`.
- The subscription stage is the single writer of the customer statuses `trial`, `paying`, `past_due`, `churned` (`STAGE_STATUS`); a bot request only moves a customer forward to `requested`.
- One subscription per customer; a trial has its end date, a cancellation its date. MRR is integer VND; the summary counts active and past-due subscriptions.
- Writes use optimistic `version` and leave an audit event (`saas.subscription.*`) with ids only.

**Do not:** read other modules' tables; put HTTP/Drizzle types in `domain/`; call LLMs outside `ai-core`.

**Test:** `pnpm --filter @agent-sales/backend test -- saas`; integration: `test/saas.integration.spec.ts`.
