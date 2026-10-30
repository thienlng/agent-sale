# saas

**Purpose:** the SaaS vertical (ADR-014): demo / trial / consultation requests and each customer's subscription (plan, stage, MRR) for businesses with industry `saas`.

**Owned tables:** `saas_requests`, `saas_subscriptions` (migration 0036; schema in `packages/db/src/schema/saas.ts`). Both reference `contacts` by a same-workspace composite key.

**Public API (`api/`):**
- `SAAS_FACADE` → `SaasFacade.recordBotRequest(ws, { conversationId, contactId, kind, details, preview })` — the bot's built-in `builtin.saas.request` tool. One request per conversation and kind; a repeat fills in details while the request is `new`; `preview` validates without writing; bad arguments return `invalid`, never throw.
- HTTP: `/saas-requests` (list, create, get, patch) with `contacts.view` / `contacts.edit`; `/saas-subscriptions`, `/saas-subscriptions/summary`, `/contacts/{id}/saas-subscription` (get, put) with `contacts.view_all` (put also needs `contacts.edit`).
- Events: none yet.

**Depends on:** `workspace` (industry, timezone), `crm` (customer exists, names, find by phone).

**Invariants:**
- Every route and the bot tool answer 404 for a business whose industry is not `saas`.
- Request status: `new → contacted | scheduled | converted | closed`, `contacted ↔ scheduled`; `converted` and `closed` are final. A request needs a phone or an email.
- One subscription per customer; a trial has its end date, a cancellation its date. MRR is integer VND; the summary counts active and past-due subscriptions.
- Writes use optimistic `version` and leave an audit event (`saas.request.*`, `saas.subscription.*`) with ids only.

**Do not:** read other modules' tables; put HTTP/Drizzle types in `domain/`; call LLMs outside `ai-core`.

**Test:** `pnpm --filter @agent-sales/backend test -- saas`; integration: `test/saas.integration.spec.ts`.
