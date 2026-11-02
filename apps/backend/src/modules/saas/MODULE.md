# saas

**Purpose:** the SaaS vertical (ADR-020): each customer's subscription (plan, stage, MRR, history), the business's plan catalog, trial / renewal reminders and the bot's demo / trial / consultation capture, for businesses with industry `saas`. Everything lands on the customer record: there is no separate request list. Also the Rapiz HQ sync (ADR-021): the platform's own accounts mirrored as customers of the HQ business.

**Owned tables:** `saas_subscriptions` (migration 0052), `saas_plans`, `saas_subscription_history`, `saas_hq_links` (tenant, forced RLS) and `saas_hq_checkpoints`, `saas_hq_dead_letters` (system only) — migration 0054; schema in `packages/db/src/schema/saas.ts`. Subscriptions reference `contacts` and `saas_plans` by same-workspace composite keys.

**Public API (`api/`):**
- `SAAS_FACADE` → `SaasFacade.recordBotRequest(ws, { kind, details, preview })` — the bot's built-in `record_saas_request` tool (`ai/application/saas-tools.ts`). Finds or creates the customer by phone, moves it forward to the `requested` status (never back) and adds a note with the details; `preview` validates without writing; bad arguments return `invalid`, never throw.
- `SAAS_RUNNER` → `SaasRunner` for the worker and the CLIs: `tick()` (HQ outbox consumer), `daily(now)` (reminders and the nightly HQ reconcile, each claimed once per day), `reconcile({ dryRun })` (`hq-backfill`).
- HTTP: `/saas-subscriptions` (filters `stage`, `contactIds`, `endingSoon`), `/saas-subscriptions/summary`, `/contacts/{id}/saas-subscription` (get, put) and `/history` with `contacts.view_all` (put also needs `contacts.edit`); `/saas-plans` (get: `contacts.view_all`; post, patch: `settings.manage`).
- Events: none yet.

**Events consumed:** the platform's `account.account.created.v1`, `account.account.status_changed.v1`, `billing.subscription.changed.v1`, `billing.usage.snapshot.v1`, `billing.subscription.reminder.v1` (outbox, `workspace_id` null), by `application/event-handlers/hq-sync.handler.ts`, only when `RAPIZ_HQ_WORKSPACE_ID` is set. Projector pattern: one consumer under an advisory lock, `xid8` horizon window, checkpoint row, a failing event goes to the dead-letter table by id and code.

**Depends on:** `workspace` (industry, timezone, the HQ business), `crm` (customer exists, names, lead capture by phone, system status move, system note; `CONTACT_SYNC_FACADE` with source `rapiz` for HQ adoption).

**Invariants:**
- Every route and the bot tool answer 404 for a business whose industry is not `saas`.
- The subscription stage is the single writer of the customer statuses `trial`, `free_plan`, `paying`, `past_due`, `churned` (`STAGE_STATUS`); a bot request only moves a customer forward to `requested`.
- One subscription per customer; a trial has its end date, a cancellation its date (and a churn reason when staff cancel). MRR is integer VND per month; with a catalog plan it is the plan's period price / months, never typed. The summary counts active and past-due MRR.
- A plan / stage / MRR change appends one history row in the same transaction (source `staff | sync | system`).
- Plans are archived, never deleted; an archived plan stays on its subscriptions and cannot be newly chosen. Active plan names are unique per business.
- A subscription with `external_source = 'rapiz'` is owned by the platform: staff can change seats, note and churn reason only (`LINKED_READ_ONLY` otherwise).
- HQ sync: one customer per platform account (`saas_hq_links`), adopted by phone, then email, else created. Events of one account and kind apply in order (`applied` timestamps): stale and replayed events change nothing. Reminders, suspensions and the 80% usage crossing become notes, each once.
- Writes use optimistic `version` and leave an audit event (`saas.subscription.*`, `saas.plan.*`) with ids only. Logs carry codes and counts, never names, phones or emails.

**Boundary exception (ADR-021, temporary):** `infrastructure/platform-directory.drizzle.ts` (`PlatformDirectory` port) reads the account and billing tables read-only with the system role, for the backfill and the nightly reconcile only. Replace it with account / billing list facades when they exist. The live sync reads events only.

**Not yet:** several contacts per customer company (spec §6.7); a task object for follow-ups (they are notes).

**Do not:** read other modules' tables (beyond the exception above); write platform data; put HTTP/Drizzle types in `domain/`; call LLMs outside `ai-core`.

**Test:** `pnpm --filter @agent-sales/backend test -- saas`; integration: `test/saas.integration.spec.ts`, `test/saas-hq.integration.spec.ts`.
