# saas

**Purpose:** the SaaS vertical (ADR-020): each customer's subscription (plan, stage, MRR, history), the business's plan catalog, and trial / renewal reminders, for businesses with industry `saas`. Everything lands on the customer record: there is no separate request list. The bot's demo / trial / consultation requests are recorded by `crm` (`CrmFacade.recordBotRequest`, the `record_request` tool, ADR-025), not here. Also the Rapiz HQ sync (ADR-021): the platform's own accounts mirrored as customers of the HQ business.

**Owned tables:** `saas_subscriptions` (migration 0052), `saas_plans`, `saas_subscription_history`, `saas_hq_links` (tenant, forced RLS) and `saas_hq_checkpoints`, `saas_hq_dead_letters` (system only) — migration 0054; schema in `packages/db/src/schema/saas.ts`. Subscriptions reference `contacts` and `saas_plans` by same-workspace composite keys.

**Public API (`api/`):** no facade since the bot's request writer moved to `crm` (ADR-025).

- `SAAS_RUNNER` → `SaasRunner` for the worker and the CLIs: `tick()` (HQ outbox consumer), `daily(now)` (reminders and the nightly HQ reconcile, each claimed once per day), `reconcile({ dryRun })` (`hq-backfill`).
- HTTP: `/saas-subscriptions` (filters `stage`, `contactIds`, `endingSoon`), `/saas-subscriptions/summary`, `/contacts/{id}/saas-subscription` (get, put) and `/history` with `contacts.view_all` (put also needs `contacts.edit`); `/saas-plans` (get: `contacts.view_all`; post, patch: `settings.manage`).
- Events: `saas.subscription.changed.v1` (outbox, aggregate `saas_subscription`, same transaction) when a subscription is created or its plan, stage, period, MRR or trial/renewal/cancellation date changes, by staff or by the HQ sync; a change of note, seats, usage or reminders is quiet (`application/subscription-events.ts`, ADR-022 §7).

**Events consumed:** the platform's `account.account.created.v1`, `account.account.status_changed.v1`, `billing.subscription.changed.v1`, `billing.usage.snapshot.v1`, `billing.subscription.reminder.v1` (outbox, `workspace_id` null), by `application/event-handlers/hq-sync.handler.ts`, only when `RAPIZ_HQ_WORKSPACE_ID` is set. Projector pattern: one consumer under an advisory lock, `xid8` horizon window, checkpoint row, a failing event goes to the dead-letter table by id and code.

**Depends on:** `workspace` (industry, timezone, the HQ business), the platform admin facades `account` (`listForAdmin`), `billing` (`BILLING_ADMIN_FACADE`: `subscriptionsOf`, `listPlans`) and `identity` (`IDENTITY_ADMIN_FACADE`: `usersByIds`) for the HQ backfill and reconcile only (`application/platform-directory.ts`, read only), `crm` (customer exists, names, lead capture by phone for HQ, system status move, system note; `CONTACT_SYNC_FACADE` with source `rapiz` for HQ adoption).

**Invariants:**

- Every route answers 404 for a business whose industry is not `saas` (`SaasLeadService.assertSaas`).
- The subscription stage is the single writer of the customer statuses `trial`, `free_plan`, `paying`, `past_due`, `churned` (`STAGE_STATUS`); a bot request only moves a customer forward to `requested`.
- One subscription per customer; a trial has its end date, a cancellation its date (and a churn reason when staff cancel). MRR is integer VND per month; with a catalog plan it is the plan's period price / months, never typed. The summary counts active and past-due MRR.
- A plan / stage / MRR change appends one history row in the same transaction (source `staff | sync | system`).
- Plans are archived, never deleted; an archived plan stays on its subscriptions and cannot be newly chosen. Active plan names are unique per business.
- A subscription with `external_source = 'rapiz'` is owned by the platform: staff can change seats, note and churn reason only (`LINKED_READ_ONLY` otherwise).
- HQ sync: one customer per platform account (`saas_hq_links`), adopted by phone, then email, else created. Events of one account and kind apply in order (`applied` timestamps): stale and replayed events change nothing. Reminders, suspensions and the 80% usage crossing become notes, each once.
- Writes use optimistic `version` and leave an audit event (`saas.subscription.*`, `saas.plan.*`) with ids only. Logs carry codes and counts, never names, phones or emails.

**Not yet:** several contacts per customer company (spec §6.7); a task object for follow-ups (they are notes).

**Do not:** read other modules' tables; write platform data (the admin facades are read here, never their operator writes); put HTTP/Drizzle types in `domain/`; call LLMs outside `ai-core`.

**Test:** `pnpm --filter @agent-sales/backend test -- saas`; integration: `test/saas.integration.spec.ts`, `test/saas-hq.integration.spec.ts`.
