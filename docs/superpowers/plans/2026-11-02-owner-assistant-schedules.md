# Owner assistant capability 3 (schedules and notifications): Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Owners can schedule code-computed reports and alerts:
- revenue summary;
- new orders;
- low stock;
- unanswered conversations;
- new customers.

The assistant drafts them as proposals the owner approves. A new `notification` module delivers them in-app (a bell in the dashboard header) and by email, with a seam for mobile push.

**Architecture:**
- **Data:** a schedule is a row in `assistant_schedules`. Its report is computed in code through a `ReportDataSource` port. The port's adapter calls new read methods on the `commerce`, `conversation` and `crm` facades.
- **Runner:** the schedule runner runs inside the 1c `ASSISTANT_RUNNER` worker tick. It uses a Postgres lease and a unique run slot, not BullMQ.
- **Delivery:** results go through `NOTIFICATION_FACADE.notify()`. The new tier-0 `notification` module stores the in-app row and queues email deliveries, which its own `NOTIFICATION_RUNNER` sends over SMTP (`nodemailer`).
- **Commentary:** an optional single tier-`basic` call per run, over the figures only.

**Tech Stack:** NestJS 12, Drizzle + PostgreSQL 16 (`withAccount`/`accountPolicies`, `app_system` in the worker), Zod 4, nodemailer, Vitest, React 19 + TanStack Query, shadcn/ui, i18next.

**Spec:** `docs/superpowers/specs/2026-11-02-owner-assistant-schedules-design.md` (rulings S3-R1…R18). Parent: core spec §12, §18, §19. 1c plan: `docs/superpowers/plans/2026-11-02-owner-assistant-1c.md`. ADR: `docs/adr/ADR-024-owner-assistant.md`.

**Prerequisite:** 1c is merged into the branch. This plan needs `assistant_jobs`, `ASSISTANT_RUNNER` in `entries/worker.ts`, `assistant_suggestions` and `assistant_settings`.

## Global Constraints

- Everything from the 1b and 1c Global Constraints still applies:
  - owners only (`resolveOwnerScope`: 403 for staff, billing and other accounts, 404 for another owner's rows);
  - every assistant and notification table has `account_id`, the account RLS policy and the `app_system` policy;
  - every repository method also filters on the owner/user column;
  - no prompt, memory, report text or e-mail address in logs (mask addresses);
  - `pnpm check` passes at the end of every task;
  - never skip or delete a test.
- Task id **T-172**. Commit messages: Conventional Commits, scope `assistant`, `notification`, `commerce`, `conversation`, `crm`, `db`, `contracts`, `i18n` or `web`, ending with `(T-172)`, then a blank line and `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Migration number: **`0061`** only (0059 is 1c, 0060 is capability 2). Additive only.
- Create the module only with `pnpm gen module notification`. Then fill in `MODULE.md`, add its row to `docs/ARCHITECTURE.md` §3 and wire it in `app.module.ts` and `entries/worker.ts`.
- **Schedules:**
  - code-only by default; a model call only for `commentary: true`, one tier-`basic` call per run, at most 600 output chars, safety-scanned;
  - no model call before the preflight passes;
  - at most 10 schedules per owner per account (active + paused + pending schedule proposals);
  - reports `every` ≥ 60 min; alerts `every` ∈ {15, 30, 60, 120, 180, 240, 360, 720} min;
  - 3 consecutive execution failures pause the job and notify the owner;
  - creating, editing or removing through the model is a proposal.
- **Delivery:**
  - no customer PII (names, phones, emails, message text) in reports, notifications or emails (S3-R9);
  - email only to the user's own login address, at most 20 per user per 24 h;
  - email is off when `SMTP_URL` is unset.
- **Time:** all schedule times are Asia/Ho_Chi_Minh (UTC+7, no DST). Use injected clocks in services and `vi.useFakeTimers` in tests.
- Every new endpoint gets a happy path, a validation error, staff 403 and cross-tenant 404 test.
- New runtime dependency: `nodemailer` (+ `@types/nodemailer`) in `apps/backend`. Justification for the PR: the standard SMTP client; no mail code exists yet.

## Rulings taken while planning

The design rulings are S3-R1…R18 in the spec. These come from planning:

- **3-P1:** The schedule runner is a `ScheduleRunner` service called from the 1c `AssistantRunner.tick()` after the jobs step, not a new timer. The notification runner gets its own timer in `entries/worker.ts` (5 s), like the others. Cost if wrong: one more timer later.
- **3-P2:** `identity`'s `profile(userId)` gains `locale` (the column already exists). The notification module reads the address and locale through it. Cost if wrong: none; the change is additive.
- **3-P3:** The report renderer lives in `apps/backend/src/modules/assistant/domain/report-render.ts`. It is pure, and the strings table is injected. The infrastructure layer loads the strings from `@agent-sales/i18n/notification`, because `domain` may not import packages with I/O. `@agent-sales/i18n` has no I/O, but injecting keeps the domain free of locale loading. Cost if wrong: none.
- **3-P4:** `safeAppPath` moves from `features/assistant/utils` to `apps/web/src/lib/safe-app-path.ts` (with its test), because the bell needs it and features may not import each other. Cost if wrong: none.
- **3-P5:** The notification HTTP routes are `@WorkspaceScoped()`, so the current business gives the account (`workspace.accountOf`). Any member may call them, and a user only ever sees their own rows. The bell is shown to owners only (S3-R16). Cost if wrong: none.

---

### Task 1: Migration 0061, Drizzle schema and repositories

**Files:**
- Create: `packages/db/migrations/0061_schedules_notifications.sql`, `packages/db/src/schema/notification.ts`
- Modify: `packages/db/src/schema/assistant.ts`, `packages/db/src/schema/index.ts`, the assistant repository port and both implementations (Drizzle and in-memory)
- Create the notification repository port, its Drizzle and in-memory implementations, and the integration test `packages/db/src/schedules-notifications.integration.test.ts` (next to `account.integration.test.ts`)

**SQL** (columns, checks and indexes exactly as in spec §4):
- `assistant_schedules`:
  - `CHECK` on `template`, `mode`, `status`, `paused_reason` and `created_by`;
  - `CHECK (channels <@ ARRAY['in_app','email','push'] AND 'in_app' = ANY(channels))`;
  - a mode/template check: `mode = 'report' OR template IN ('new_orders','low_stock','unanswered_conversations')`;
  - `char_length(name) <= 80`.
- `assistant_schedule_runs`: `UNIQUE (schedule_id, scheduled_for)`.
- `assistant_proposals`: `ADD COLUMN kind text NOT NULL DEFAULT 'route' CHECK (kind IN ('route','schedule'))`.
- `notifications`: `UNIQUE (user_id, dedup_key)`, partial on `dedup_key IS NOT NULL`.
- `notification_deliveries`: `UNIQUE (notification_id, channel)`.
- For all four new tables, the RLS loop of 0057/0058 (account policy + `app_system`), `FORCE ROW LEVEL SECURITY` and grants as in 0058.

**Repository methods (assistant):**
- Owner scope:
  - `listSchedules(scope)`, `getSchedule(scope, id)`, `countSchedules(scope)`;
  - `createSchedule(scope, row)`, `updateSchedule(scope, id, patch, expectedUpdatedAt?)`, `deleteSchedule(scope, id)`;
  - `listScheduleRuns(scope, scheduleId, limit)`, `getScheduleRun(scope, runId)`, `setRunThread(scope, runId, threadId)` (only when null; returns the stored id);
  - `countPendingScheduleProposals(scope)`.
- Worker (system):
  - `claimDueSchedules(now, limit, leaseMs)`: an `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)` setting `lease_until`, returning the rows with account and owner. Due means `status='active' AND (next_run_at <= now OR run_requested_at IS NOT NULL) AND (lease_until IS NULL OR lease_until < now)`.
  - `insertRun(row)`: `ON CONFLICT (schedule_id, scheduled_for) DO NOTHING`, returns null on conflict.
  - `finishRun(id, patch)`, `saveScheduleState(id, patch)` (it also clears `lease_until`), `purgeOldRuns(before)`.

**Repository methods (notification):**
- `insertNotification(row, channels)`: one transaction; `ON CONFLICT DO NOTHING` on `(user_id, dedup_key)`; returns `{ id, deduped }`, plus the deliveries.
- `list(accountId, userId, { before?, beforeId?, limit })`, `unreadCount(accountId, userId)`, `markRead(accountId, userId, id)`, `markAllRead(accountId, userId)`.
- `claimDeliveries(now, limit, leaseMs)` (system), `finishDelivery(id, patch)`, `countSentEmails(userId, since)`, `deliverySummary(accountId, userId, ids)`, `purgeOld(before)`.

**Tests:**
- isolation across two accounts for each of the four tables;
- a tenant query outside `withAccount` sees nothing;
- two concurrent `claimDueSchedules` calls get disjoint rows;
- the unique run slot;
- `notify` dedup;
- `claimDeliveries` skips leased rows;
- the in-memory implementations mirror these.

Commit `feat(db): add schedules, schedule runs and notifications tables (T-172)`.

### Task 2: The `notification` module (in-app, email, delivery runner, routes)

**Files:**
- `pnpm gen module notification`, then fill in:
  - `domain/notification.ts` (types, `DeliveryStatus`, retry schedule `[1, 5, 30]` minutes, `EMAIL_DAILY_CAP = 20`);
  - `domain/ports/notification-channel.port.ts`;
  - `application/notification.service.ts`, `application/delivery-runner.ts`;
  - `infrastructure/persistence/*`, `infrastructure/clients/smtp-email.channel.ts`;
  - `interface/http/notification.controller.ts`;
  - `api/notification.facade.ts`, `api/index.ts` (`NOTIFICATION_FACADE`, `NOTIFICATION_RUNNER`);
  - `MODULE.md`.
- Create: `packages/contracts/src/notification/notification.schema.ts`, `notification.routes.ts` (appended to `allRoutes`; all `auth: true`, `workspaceScoped: true`, `assistant: { use: 'never' }`)
- Modify:
  - `apps/backend/src/common/config.ts`: `SMTP_URL` (optional), `MAIL_FROM` (default `Rapiz <no-reply@rapiz.io>`), `APP_PUBLIC_URL` (optional https URL);
  - `.env.example` (`MAIL_FROM`, `APP_PUBLIC_URL` with placeholders);
  - `app.module.ts`, `entries/worker.ts` (import `NotificationModule`; a 5 s timer for `NOTIFICATION_RUNNER.tick()` with the busy flag and `clearInterval` on shutdown, like the others);
  - `identity` facade `profile()` + locale (3-P2);
  - `docs/ARCHITECTURE.md` §3 tier-0 row: "`notification` uses the `identity` (recipient address, locale) and `workspace` (`accountOf`) facades; producers call `NOTIFICATION_FACADE`".

**Interfaces (produced):**

```ts
// api/notification.facade.ts
export type NotificationChannelKind = 'email' | 'push';
export type NotificationTarget = { kind: 'path'; path: string } | { kind: 'assistant_report'; runId: string };
export interface NotifyInput {
  accountId: string; userId: string; workspaceId?: string | null;
  type: 'assistant.report' | 'assistant.alert' | 'assistant.schedule_paused';
  params: Record<string, string | number | null>;
  title: string;          // ≤ 160, already rendered in the recipient's locale
  body: string;           // ≤ 4 000, plain text
  target: NotificationTarget | null;
  channels: ('in_app' | NotificationChannelKind)[];
  dedupKey?: string;      // ≤ 160
}
export interface NotificationFacade {
  notify(i: NotifyInput): Promise<{ id: string; deduped: boolean }>;
  recipientLocale(userId: string): Promise<'vi' | 'en'>;
  emailAvailable(): boolean;
  deliverySummary(accountId: string, userId: string, ids: string[]): Promise<Map<string, Partial<Record<NotificationChannelKind, DeliveryStatus>>>>;
}
export const NOTIFICATION_FACADE = Symbol('NOTIFICATION_FACADE');
export interface NotificationRunner { tick(now?: Date): Promise<number> }
export const NOTIFICATION_RUNNER = Symbol('NOTIFICATION_RUNNER');

// domain/ports/notification-channel.port.ts
export interface OutgoingMessage { to: string; locale: 'vi' | 'en'; title: string; body: string; link: string | null }
export interface NotificationChannel { kind: NotificationChannelKind; available(): boolean; send(m: OutgoingMessage): Promise<{ providerMessageId: string | null }> }
export const NOTIFICATION_CHANNELS = Symbol('NOTIFICATION_CHANNELS'); // NotificationChannel[]
```

**Behaviour:**
- `notify`:
  - validates lengths;
  - a `path` target must pass the same rule as `safeAppPath` (`/app` or `/app/…`; port the check, or reuse the assistant's `ui_navigate` validator through a small shared helper in `packages/shared` if one exists);
  - always stores the in-app row;
  - queues one delivery per non-in-app channel;
  - an `email` delivery on an unavailable channel is stored as `skipped`/`email_disabled`.
- **Runner:**
  - claims at most 20 deliveries (2 min lease);
  - recipient from `identity.profile`; no address → `skipped`/`no_recipient`;
  - email cap → `skipped`/`daily_cap`;
  - no adapter for the channel → `skipped`/`channel_unavailable` (this is the push seam);
  - a send error → `attempts + 1`, `next_attempt_at` from the retry schedule, `failed` after the 3rd attempt with the error class as `error_code`;
  - once per day, purge notifications older than 90 days.
- **SMTP channel:**
  - `nodemailer.createTransport(SMTP_URL)`, built once and only when the URL is set;
  - text body plus a minimal escaped HTML version (an orange header bar from a constant, the body paragraphs, the footer link to `${APP_PUBLIC_URL}/app` when set);
  - never logs the address or the body.
- **Routes:**

  | Route | Answers |
  |---|---|
  | `GET /notifications` | `query {before?, beforeId?, limit≤50=20}` → `{ items: NotificationDto[], next: {before, beforeId} \| null }` |
  | `GET /notifications/unread-count` | `{ count }` |
  | `POST /notifications/{notificationId}/read` | 200 `NotificationDto`; another user's or account's id → 404 |
  | `POST /notifications/read-all` | `{ count }` |

  `NotificationDto` = `{ id, type, title, body, target, workspaceId, readAt, createdAt }`.

**Tests:**
- service: dedup, target validation, a disabled email is skipped;
- runner with a fake channel and fake timers: success; retry timings; failed after 3 attempts; daily cap at the 21st email; no adapter → `channel_unavailable`; no address;
- SMTP channel: nodemailer mocked; the HTML escapes `<script>`;
- facade contract test;
- HTTP: list keyset, unread count, read and read-all, another user's notification → 404, cross-account → 404.

Commit `feat(notification): add in-app notifications, email delivery and the delivery runner (T-172)`.

### Task 3: Report data on the commerce, conversation and crm facades

**Files:**
- Modify: `apps/backend/src/modules/commerce/api/commerce.facade.ts` and its implementation (reuse the overview logic in `application/order.service.ts`)
- Modify: `apps/backend/src/modules/conversation/api/conversation.facade.ts` and its implementation
- Modify: `apps/backend/src/modules/crm/api/crm.facade.ts` and its implementation
- Modify: the three stores (Drizzle + in-memory), their `MODULE.md` files, and the facade spec tests

**Interfaces (produced, spec §7):**

```ts
// CommerceFacade
orderOverview(ws: WorkspaceId, q: { from: string; to: string }): Promise<OrderOverviewResponse>;
ordersPlaced(ws: WorkspaceId, q: { since: Date; until: Date; limit: number /* ≤ 10 */ }):
  Promise<{ count: number; total: number; items: { id: string; code: string; total: number; status: string; source: string; placedAt: string }[] }>;
lowStock(ws: WorkspaceId, q: { threshold: number; limit: number /* ≤ 20 */ }):
  Promise<{ count: number; items: { productId: string; variantId: string; name: string; sku: string | null; available: number }[] }>;
// ConversationFacade
awaitingReply(ws: WorkspaceId, q: { olderThan: Date; limit: number /* ≤ 200 */ }):
  Promise<{ count: number; oldestSince: string | null; byChannel: { channel: string; count: number }[]; ids: string[] }>;
// CrmFacade
contactsCreated(ws: WorkspaceId, q: { since: Date; until: Date }):
  Promise<{ count: number; bySource: { source: string | null; count: number }[] }>;
```

**Rules:**
- `ordersPlaced` excludes deleted orders and orders in a cancelled status. Its items are ordered by `placed_at desc`, and `total` is the sum over all matched orders, not only the listed ones.
- `lowStock` counts active products' variants only, with `available = Σ(on_hand − reserved)` over warehouses, ordered by `available asc, name`. A business with no inventory rows gives `count 0`.
- `awaitingReply` uses `awaiting_since <= olderThan` on the existing partial index. `byChannel` is the channel kind (`facebook`, `zalo`, `webchat`…), not the page name.
- `contactsCreated` groups by the source name (`crm_sources.name`), NULL as `null`.
- Everything runs in the module's `withTenant`. These return no customer names or phones (S3-R9).

**Tests (per method, against seeded in-memory data plus one Drizzle integration case each):**
- the boundaries (`since` inclusive, `until` exclusive);
- cancelled and deleted orders excluded;
- the multi-warehouse sum;
- a conversation awaiting exactly the threshold;
- another workspace's rows are never counted.

Commit `feat(commerce): expose order, stock, conversation and contact figures for owner reports (T-172)`. One commit across the three modules is fine; use the scope `commerce` and list the others in the body.

### Task 4: Schedule domain, report rendering and owner routes

**Files:**
- Create (pure, `apps/backend/src/modules/assistant/domain/`):
  - `schedule.ts`: types, `validateDraft`, `MAX_SCHEDULES = 10`, the interval sets;
  - `cadence.ts`: `nextRunAt`, `nextRuns(n)`, `isMissed`;
  - `report-period.ts`;
  - `alert-decision.ts`;
  - `report-render.ts`.
- Create:
  - `apps/backend/src/modules/assistant/domain/ports/report-data-source.port.ts`;
  - `apps/backend/src/modules/assistant/infrastructure/reports/facade-report-data-source.ts`;
  - `apps/backend/src/modules/assistant/application/schedules.service.ts`;
  - `apps/backend/src/modules/assistant/application/report.service.ts` (compute + render, used by the runner and the preview).
- Create:
  - `packages/contracts/src/assistant/schedule.schema.ts` (`ScheduleDraft`, `SchedulePatch`, `Cadence`, the per-template params, `ScheduleDto`, `ScheduleList`, `ScheduleRunDto`, `SchedulePreview`);
  - `packages/i18n/src/messages/{vi,en}/notification.json`, `packages/i18n/src/notification.ts`;
  - an export `./notification` in `packages/i18n/package.json`.
- Modify:
  - `packages/contracts/src/assistant/assistant.routes.ts` (the routes of spec §5, all `assistant: { use: 'never' }`);
  - the assistant controller and facade;
  - `assistant.module.ts` (import `CommerceModule`, `ConversationModule`, `CrmModule` and `NotificationModule`; provide `REPORT_DATA_SOURCE`);
  - `apps/backend/package.json` (`@agent-sales/i18n` workspace dependency);
  - `docs/ARCHITECTURE.md` §3, the `assistant` row: it also uses the `commerce`, `conversation` and `crm` facades for scheduled reports (S3-R1), and `notification`.

**Interfaces (produced):**

```ts
// domain/cadence.ts — all times are UTC Dates; local time is UTC+7
export type Cadence =
  | { kind: 'daily'; at: string }                         // 'HH:mm'
  | { kind: 'weekly'; days: number[]; at: string }        // 1 = Monday … 7 = Sunday, non-empty, unique
  | { kind: 'monthly'; day: number; at: string }          // 1..28 or -1 (last day)
  | { kind: 'every'; minutes: number; activeFrom?: string; activeTo?: string };
export function nextRunAt(c: Cadence, after: Date): Date;          // strictly after `after`
export function nextRuns(c: Cadence, after: Date, n: number): Date[];
export const MISSED_AFTER_MS = 6 * 3_600_000;

// domain/report-period.ts
export function resolvePeriod(p: 'day' | 'week' | 'month', w: 'previous' | 'to_date', at: Date):
  { from: string; to: string; since: Date; until: Date };       // local dates + UTC instants (until exclusive)

// domain/alert-decision.ts
export function decideAlert(i: { hitIds: string[]; lastFingerprint: string | null; lastAlertedAt: Date | null; now: Date }):
  { fire: boolean; fingerprint: string | null };                 // fire on change, or same set ≥ 24 h later; empty → no fire, fingerprint null

// domain/ports/report-data-source.port.ts
export interface ReportDataSource {
  revenue(ws: string, from: string, to: string): Promise<RevenueFigures>;
  orders(ws: string, since: Date, until: Date): Promise<OrderFigures>;
  lowStock(ws: string, threshold: number): Promise<StockFigures>;
  awaiting(ws: string, olderThan: Date): Promise<AwaitingFigures>;
  newContacts(ws: string, since: Date, until: Date): Promise<ContactFigures>;
}
export const REPORT_DATA_SOURCE = Symbol('REPORT_DATA_SOURCE');

// domain/report-render.ts
export type ReportStrings = Record<string, string>;            // flat keys from notification.json, `{{var}}` placeholders
export function renderReport(r: ReportResult, strings: ReportStrings, businessName: string): { title: string; body: string };
export function formatVnd(n: number): string;                  // 1250000 → '1.250.000 ₫'
```

**`validateDraft(draft, ctx: { businessIds; existingCount; emailAvailable })`** returns problem codes:
- `invalid_mode` (the mode/template matrix);
- `interval_too_short`;
- `alert_needs_every`;
- `schedule_limit`;
- `unknown_business`;
- `unsafe_name` (`scanUntrustedText`);
- `email_unavailable`;
- `in_app_required`.

**`SchedulesService`** (owner scope via `resolveOwnerScope`):
- `list`, `create(draft, createdBy)`, `update(id, patch)`, `pause`, `resume`, `requestRun`, `remove`, `runs(id)`;
- `preview(draft)`: computes the report with `ReportService` and renders it, with no notify and no commentary;
- `threadForRun(runId)`: creates an `origin: 'schedule'` thread titled with the report title. It seeds it with one assistant message (the body, plus the commentary when present) and builds the thread prompt as for a new chat thread. It stores the id with `setRunThread`; a second call returns the same thread.
- **Rules:**
  - an edit that changes `template`, `mode` or `params` resets the alert state (`alert_fingerprint`, `last_alerted_at`, `alert_cursor = now`);
  - a new `new_orders` alert starts with `alert_cursor = now`;
  - `requestRun` answers 409 `run_too_soon` when the last manual run started less than 5 min ago.

**Tests:**
- `nextRunAt`: daily before and after `at`; a weekly wrap; monthly `-1` in February and in a leap year; monthly day 28; `every` with active hours across midnight; strictly-after;
- `resolvePeriod` for each combination, with the Monday boundary and the 1st of the month;
- `decideAlert`: change, the same set at 23 h and at 24 h, empty;
- `renderReport`: the money format; a snapshot per template in vi; no field named like a contact name or phone in `ReportResult` (type-level plus a test on the fixtures);
- `validateDraft`: each code;
- service: create, update, pause/resume, remove, preview, `threadForRun` idempotent;
- HTTP: each route's happy path, validation 400, staff 403, another owner's schedule 404, and a business outside the owner's scope → 400 `unknown_business`.

Commit `feat(assistant): schedule model, report templates and owner schedule routes (T-172)`.

### Task 5: Schedule runner (worker)

**Files:**
- Create: `apps/backend/src/modules/assistant/application/schedule-runner.ts`, `packages/ai-core/prompts/assistant-schedule-commentary@1.md`
- Modify: the 1c `assistant-runner.ts` (call `scheduleRunner.tick(now)` after the jobs step; a daily purge pass), `MODULE.md`

**`ScheduleRunner.tick(now)`**, spec §6 step by step:
- `claimDueSchedules(now, 10, 5 min)`, then for each schedule:
  1. **Slot.**
     - `trigger = run_requested_at ? 'manual' : 'cadence'`;
     - `scheduledFor = run_requested_at ?? next_run_at`;
     - for a cadence slot with `now − scheduledFor > MISSED_AFTER_MS`: `insertRun` with `status 'skipped'` and `error_code 'missed'`;
     - otherwise, for reports and manual runs, `insertRun` with `status 'running'` (alerts insert later, step 3);
     - advance `next_run_at = nextRunAt(cadence, now)` and clear `run_requested_at`;
     - a conflict on `insertRun` (another worker took this slot) → just save the state.
  2. **Preflight**, through the facades the module already has:
     - `account.listForUser(owner)`: an active `owner` of the schedule's account;
     - `workspace.accountOf(business)`: equals the account;
     - `workspace.findMembership(business, owner)`: active.

     A failure gives a `blocked` run with the reason as `error_code` and pauses the job (`paused_reason` = `owner_not_active` | `business_unavailable`, `next_run_at = null`). It also notifies (type `assistant.schedule_paused`, target `{path:'/app'}`, in-app only), except for `owner_not_active`. Email is dropped from this run's channels when `notification.emailAvailable()` is false.
  3. **Compute.** `ReportService.compute(schedule, now)`.
     - **Alerts:** `decideAlert`; `new_orders` uses `alert_cursor` (`since = alert_cursor`, `until = now`, fire when `count ≥ minCount`, then move the cursor to `now`).
     - Not firing → only `saveScheduleState({ last_checked_at: now })`. For alerts, `insertRun` happens **after** the decision to fire (step 1 inserts the run up front for reports and manual runs only), so a quiet check leaves no row (S3-R13). The slot is still protected by the lease, and the `dedupKey` makes a repeated notify harmless.
  4. **Commentary** (`commentary: true`):
     - the `AI_LLM_GATEWAY` tier `basic`, 30 s cap, the prompt with the report JSON;
     - `assistant_runs` kind `schedule`;
     - the output is cut at 600 chars and must pass `scanUntrustedText`, otherwise it is dropped;
     - errors are logged by class and the report goes on.
  5. **Render and notify.**
     - Render with `recipientLocale` strings, then `notify` with `dedupKey = 'sched:<id>:<scheduledFor ISO>'`.
     - The target is `{kind:'assistant_report', runId}` for reports, and the template's path (spec §6) for alerts.
     - The run becomes `done` with its `report`, `title`, `body` and `notification_id`.
     - The job state gets `last_run_at`, `consecutive_failures = 0`, and for alerts `alert_fingerprint` and `last_alerted_at`.
  6. **Failure.**
     - The run is `failed` with `compute_failed` (or the error class), `consecutive_failures + 1`.
     - At 3: pause (`failures`) and notify `assistant.schedule_paused` on the schedule's channels.
     - The lease is always released in a `finally`.

**Daily pass:** `purgeOldRuns(now − 90 d)`, guarded by a timestamp held in memory, like the 1c curator gate.

**Tests** (in-memory repository, fake `ReportDataSource`, fake notification facade, fake gateway, fake timers):
- a due daily report runs once and `next_run_at` moves to tomorrow;
- two runners on the same slot give one run;
- a 7 h late slot is `skipped`/`missed`, a 2 h late one runs;
- a manual run;
- each preflight block pauses, and `owner_not_active` sends no notification;
- 3 compute failures pause and notify, and a success in between resets the count;
- an alert with no hit leaves no run row;
- an alert fires once, not again at 23 h, again at 24 h;
- the `new_orders` alert cursor;
- commentary is appended, an unsafe commentary is dropped, a gateway error still delivers;
- email dropped when unavailable;
- the dedup key is stable across a retry after a crash (the second `notify` gives `deduped: true`).

Commit `feat(assistant): run scheduled reports and alerts in the worker (T-172)`.

### Task 6: The `schedule` tool, schedule proposals and suggestion acceptance

**Files:**
- Create: `apps/backend/src/modules/assistant/application/schedule-tools.ts`
- Create the prompt `packages/ai-core/prompts/assistant@3.md` (or the next version after 1c): a copy of the current prompt plus one tool-guidance line for `schedule`, and the rule "Scheduled reports are computed by Rapiz; propose a schedule, never promise to remember to send something yourself".
- Create a platform skill update `packages/ai-core/assistant-skills/set-up-schedules/SKILL.md`: how to turn a phrase into a cadence and a template; ask for email only if the owner mentions it.
- Modify:
  - `chat-turn.service.ts`: register the tool unless the thread's `origin` is `schedule` or the 1c settings disable the `schedule` toolset;
  - the 1c settings toolset list: add `schedule`;
  - `proposals.service.ts`: a `kind` branch;
  - the 1c suggestions accept handler;
  - contracts: `AssistantProposalDto` gains `kind`, and the suggestion accept response gains `scheduleDraft?`;
  - evals `evals/assistant/schedules.yaml`.

**Tool:**

```ts
schedule({
  action: 'create' | 'list' | 'edit' | 'pause' | 'resume' | 'run' | 'remove',
  scheduleId?: string,
  draft?: ScheduleDraft,          // create; businessId defaults to the current business
  patch?: SchedulePatch,          // edit
  summary?: string,               // ≤ 300, Vietnamese; required for create | edit | remove
})
```

- `list` → `{ items: [{ id, name, business, template, mode, cadence, channels, status, pausedReason, nextRunAt, lastRun }] }`, at most 10.
- `create`, `edit`, `remove`:
  - run `validateDraft` (counting pending schedule proposals, so `schedule_limit` holds before approval);
  - create a proposal with `kind 'schedule'`, `route_key 'SCHEDULE <op>'`, `path '/assistant/schedules[/<id>]'`, `body { op, scheduleId?, draft | patch }`, and `preview { draft, before?, nextRuns: nextRuns(cadence, now, 3) }`;
  - return `{ status: 'awaiting_owner_approval', proposalId }`;
  - the existing limits apply (20 pending per thread, 24 h expiry).
- `pause`, `resume`, `run` call `SchedulesService` at once and return the new state. `run` may answer `run_too_soon`.
- Errors return `{ ok: false, errorCode }` with the `validateDraft` codes, `unknown_schedule` or `summary_required`.

**Approval (`proposals.service.ts`):**
- `kind === 'schedule'` skips the route catalog lookup and the invoker.
- After the same `pending → executing` guard, it calls `SchedulesService.applyProposal(scope, body)`. That re-validates against the current limit, business scope and email availability, then creates (`created_by 'assistant'`), updates or removes.
- The outcome is `done` with `resultPreview` = the schedule id and name, or `failed` with the validation code.
- Event messages as in 1b (`Đã áp dụng: <summary>` …).

**Suggestion accept (S3-R12):**
- For kind `schedule`, parse `payload` with `ScheduleDraft` (filling `businessId` from the current business when absent).
- Valid → `accepted`, answering `{ scheduleDraft }`.
- Invalid → the suggestion is `dismissed`, answering 422 `invalid_schedule_draft`.
- The 1c review's `suggest` tool description gains the schedule payload shape.

**Tests:**
- each tool action;
- create, edit and remove never write a schedule before approval;
- approve applies; approve after the owner reached 10 schedules → `failed`/`schedule_limit`;
- the tool is absent in a `schedule` thread and when the toolset is disabled;
- suggestion accept with valid and invalid payloads;
- the prompt's byte-stability test is updated;
- the eval: "mỗi sáng thứ Hai 8h gửi doanh thu tuần trước qua email" gives a create proposal with `weekly {days:[1], at:'08:00'}`, `revenue_summary {period:'week', window:'previous'}` and channels `['in_app','email']`. A fake model in `pnpm test`; live with `--live`.

Commit `feat(assistant): schedule tool with owner-approved schedule proposals (T-172)`.

### Task 7: Web — bell, notifications, schedules view, proposal card

All strings go in i18n: the `notification` namespace (new, lazy where the bell is not shown) and the `assistant` namespace, vi + en. Build only from `components/ui` (shadcn); colours only through tokens.

**Files:**
- Create:
  - `apps/web/src/features/notification/api/notifications.ts` (`useUnreadCount`: refetch every 60 s and on window focus; `useNotifications`: infinite keyset; `useMarkRead`, `useMarkAllRead`);
  - `apps/web/src/features/notification/components/notification-bell.tsx` (+ test).
- Move: `apps/web/src/features/assistant/utils/safe-app-path.ts` (+ test) → `apps/web/src/lib/safe-app-path.ts`, updating the imports (3-P4).
- Modify:
  - `apps/web/src/lib/assistant-context.ts`: `requestAssistantOpen({ reportRunId } | { threadId })` and `useAssistantOpenRequests()`, a tiny store; no feature imports;
  - `apps/web/src/components/app-shell.tsx`: a `headerActions?: ReactNode` prop rendered before `AccountMenu`;
  - `apps/web/src/routes/app.tsx`: pass `<NotificationBell />` for account owners (S3-R16).
- Create in `features/assistant`:
  - `api/schedules.ts`;
  - `components/assistant-schedules.tsx` (list + runs);
  - `components/schedule-editor.tsx` (form + "Xem thử");
  - `components/schedule-proposal-card.tsx`;
  - `utils/cadence-text.ts` (cadence → words, through i18n keys).
- Modify in `features/assistant`: the panel (a new "Lịch báo cáo" view in the views menu), `assistant-proposals.tsx` (render `kind: 'schedule'` with the new card), the suggestions UI from 1c (a `schedule` accept opens the editor with `scheduleDraft`), and the bubble (consume open requests: `reportRunId` → `POST /assistant/schedule-runs/{runId}/thread` → open the thread).

**Bell behaviour:**
- The badge shows the unread count ("9+" above 9) and is hidden at 0.
- The popover lists the newest 20 with "Xem thêm", and "Đánh dấu tất cả đã đọc".
- An item shows the title, the body clamped to 3 lines with "Xem thêm", the relative time and an unread dot.
- Clicking marks it read, then:
  - a `path` target navigates through `safeAppPath` (dropped if unsafe);
  - an `assistant_report` target asks the assistant to open the report thread.
- Empty, loading and error states.

**Schedules view:**
- **List:** cards with name, business, template label, cadence in words, next run and last run (status + email delivery), a switch (active/paused, with the paused reason in words), and Chạy ngay / Sửa / Xoá (an `AlertDialog`); "Thêm lịch" disabled at 10/10.
- **Editor fields:** business `Select` (the owner's businesses), template, mode (only the allowed ones), the params by template, a cadence picker (`ToggleGroup` daily/weekly/monthly/every + time input + weekday toggles + day-of-month select including "Ngày cuối tháng" + minutes select limited by mode), channels (in-app locked on; email `Checkbox` disabled with the reason when `emailAvailable` is false; no push option), and the commentary `Switch` with a short cost note.
- **"Xem thử"** shows the preview title and body in a `Card`.
- **Validation:** client-side with the same Zod `ScheduleDraft`; server errors are mapped by code.

**Tests:**
- the bell badge and mark-read; a `path` click navigates, an unsafe path does not; a report click requests the assistant open;
- the AppShell renders `headerActions`;
- the editor: the mode options per template, the interval options per mode, email disabled when unavailable, preview;
- the schedule proposal card shows the cadence in words and the next runs;
- suggestion accept opens a prefilled editor;
- `cadenceText` for each kind;
- `e2e/responsive.spec.ts` stays green: the bell fits at 375 px.

Commit `feat(web): notification bell and scheduled reports in the assistant (T-172)`.

### Task 8: Docs

- **Spec:** move this capability's spec to `docs/superpowers/specs/2026-11-02-owner-assistant-schedules-design.md` (if not already there) and add a final section "Adjustments made while building", with anything the tasks changed. In the core spec's capability table, mark 3 shipped and link the spec.
- **ADR-024:** a consequences line for capability 3. It needs the maintainer's approval, because `docs/adr/**` is protected.
  - `assistant` reads report figures through the `commerce`, `conversation` and `crm` facades in the worker (S3-R1), because a scheduled run has no owner token;
  - the new `notification` module (tier 0, account-scoped, facade-called).
- **Module docs:**
  - `MODULE.md` of `assistant` (tables, routes, the tool, the runner, the proposal kind) and of `notification` (new);
  - `MODULE.md` of `commerce`, `conversation`, `crm` (new facade methods);
  - `identity` (`profile` locale).
- **Numbered docs:**
  - docs/04: the `notification` row (in-app, email, push later; tables `notifications`, `notification_deliveries`; no `notification_prefs` yet), the worker runners, the routes;
  - docs/05: the four tables and `assistant_proposals.kind`, replacing the old `notifications(workspace_id, …)` sketch;
  - docs/10: `SMTP_URL`, `MAIL_FROM`, `APP_PUBLIC_URL`; production email stays off until an SMTP provider is configured (S3-R7);
  - docs/16: the runner tick budgets and the unread-count budget (spec §11).
- **Team:** the team `MODULE.md` "No email is sent yet" stays true; add a pointer that invitation emails can reuse the notification email channel.
- Commit `docs(assistant): record schedules and the notification module (T-172)`.
