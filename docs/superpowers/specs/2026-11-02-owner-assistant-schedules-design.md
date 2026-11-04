# Owner assistant capability 3: schedules (reports, alerts) and the `notification` module

- Task: T-172 · Date: 2026-11-02 · Status: draft. The owner was unavailable, so the rulings in §3 were taken while designing. Each one lists its cost if it turns out wrong.
- Parent design: [`2026-11-02-owner-assistant-core-design.md`](2026-11-02-owner-assistant-core-design.md). §12 fixes the shape; §18 and §19 record what 1a and 1b shipped. 1c (`docs/superpowers/plans/2026-11-02-owner-assistant-1c.md`) adds the worker runner `assistant_jobs` and the suggestions table.
- ADR: [ADR-024](../../adr/ADR-024-owner-assistant.md). This capability adds a consequence line there (ruling S3-R1 changes which facades `assistant` uses).
- Plan: [`../plans/2026-11-02-owner-assistant-schedules.md`](../plans/2026-11-02-owner-assistant-schedules.md)

## 1. Goal

An owner can say "mỗi sáng 8h gửi em doanh thu hôm qua" or "báo em khi có khách chờ quá 30 phút". The assistant drafts a schedule and the owner approves it with one tap. From then on, Rapiz computes the report or checks the alert **in code**, with no model call by default. It delivers the result as an in-app notification (a bell in the dashboard header) and, if the owner chose it, by email. Mobile push comes later. The `notification` module gets a channel seam so push only needs an adapter.

What the owner gets in v1:

| Template | Report (on a cadence) | Alert (checked every 15–60 min) |
|---|---|---|
| `revenue_summary` | Sales, revenue, closed orders, average order value and profit for a period (day, week or month; the previous period or the period so far) | — |
| `new_orders` | Orders placed in the period: count, total, the latest 5 by code | New orders since the last check |
| `low_stock` | Variants whose available stock is at or below a threshold | The set of low-stock variants changed, or has not been fixed after 24 h |
| `unanswered_conversations` | Conversations waiting longer than N minutes: count, oldest wait, split by channel | Same condition, fired when the set of waiting conversations changes |
| `new_customers` | Contacts created in the period, split by source | — |

## 2. Scope

**In:**
- the `assistant_schedules` and `assistant_schedule_runs` tables;
- a schedule runner in the worker;
- the `schedule` tool and schedule proposals;
- owner routes and a "Lịch báo cáo" view in the assistant panel;
- a new tier-0 module `notification`: the `notifications` and `notification_deliveries` tables, in-app delivery, email over SMTP, a delivery runner, the bell and the notification list;
- read methods on the `commerce`, `conversation` and `crm` facades;
- handling for accepting a 1c `schedule` suggestion.

**Out (later):**
- free-form prompt jobs that run a full agent turn with tools;
- attached skills and a pinned tier per job;
- mobile push and device tokens;
- per-user notification preferences;
- SSE for the bell;
- notifications for staff (assignments, handoffs);
- invitation and password emails (they can reuse the email channel later);
- an owner monthly allowance (core §14).

## 3. Rulings (taken while designing)

| # | Ruling | Why | Cost if wrong |
|---|---|---|---|
| S3-R1 | **Report data comes from facades.** New narrow read methods on `commerce`, `conversation` and `crm`, reached through an assistant port `ReportDataSource`. Reports use neither declared routes nor the capability-2 SQL views. | A scheduled run happens in the worker. There is no HTTP pipeline there, and no owner bearer token to send (1b-R2: an asynchronous run would need a minted token, which does not exist). Capability 2 is being designed in parallel, so depending on its views would couple two PRs that are not merged. Facades run under `withTenant` with forced RLS, and they are typed and unit-testable. | ADR-024 and ARCHITECTURE §3 gain three dependencies for `assistant`. Moving to the views later changes only the adapter behind `ReportDataSource`. |
| S3-R2 | **v1 jobs are templates computed in code.** A job is a template, its params, a business, a cadence, channels and an optional `commentary` flag. Commentary is **one** tier-`basic` model call over the computed figures only, with no tools, at most 600 chars, and safety-scanned. Free-form prompts, attached skills and a pinned tier (core §12) are deferred. | Code-only reports are the default in §12. A free-form job needs a full agent turn with route tools, and that needs the minted-token design. | The owner cannot schedule an arbitrary question yet. The schema leaves room: `template` can later take the value `prompt`. |
| S3-R3 | **Structured cadence, not cron.** The cadence is `daily {at}`, `weekly {days, at}`, `monthly {day (1–28 or -1 for the last day), at}` or `every {minutes, activeFrom?, activeTo?}`, always in Asia/Ho_Chi_Minh (UTC+7, no DST). The model fills the structure, and pure code computes `next_run_at`. | No cron dependency and no parsing errors. The structure covers every phrasing an SME owner uses. Rendering it back to Vietnamese is trivial. | Exotic schedules (for example "the 2nd Tuesday") are not possible. Adding cron later means adding a cadence kind. |
| S3-R4 | **No BullMQ.** Schedules run from the 1c `ASSISTANT_RUNNER` tick, which leases `assistant_schedules` rows (`FOR UPDATE SKIP LOCKED` + `lease_until`); a unique `(schedule_id, scheduled_for)` makes each run happen once. Notification deliveries have their own `NOTIFICATION_RUNNER` tick. | This is the same pattern as the integration runner and 1c (1c-R1). | A later move to BullMQ. |
| S3-R5 | **`notification` is a tier-0 module, account-scoped, called through its facade.** Its tables carry `account_id` + `user_id` and use `accountPolicies` and `withAccount` (the ADR-024 amendment of ADR-004). Every query also filters on `user_id`. Producers call `NOTIFICATION_FACADE.notify()`; they do not publish an outbox event. The module depends on `identity` (the recipient's address and locale) and `workspace` (`accountOf`). | The outbox is per workspace, but some notices are about the account (a paused schedule whose business is gone). A direct call is synchronous and idempotent through its `dedup_key`. Tier 0 still holds: nothing below it depends on it, and it never calls a producer back. | When a broker arrives, `notify` becomes an event consumer, behind the same facade signature. |
| S3-R6 | **A notification stores its rendered `title` and `body`**, in the recipient's locale (default `vi`), next to `type` + `params`. The producer (the assistant's report renderer) renders them in the backend from a new `@agent-sales/i18n/notification` catalog, so the bell and the email show the same text. This is the backend's first import of `@agent-sales/i18n`. | One renderer per report, not one in the web and another for email. Strings stay in i18n files (rule 01). | An old notification does not re-render after the owner switches language. |
| S3-R7 | **Email over SMTP (`nodemailer`, `SMTP_URL`, `MAIL_FROM`).** When `SMTP_URL` is unset, the email channel is off: deliveries are `skipped` (`email_disabled`) and the UI says email is unavailable. Email goes **only** to the recipient's own login address, never to a free-form address, at most 20 emails per user per 24 h. An unverified login email is allowed until T-045 (email verification) lands; from then on the preflight requires it to be verified. | `.env.example` and the local compose already have `SMTP_URL` and mailpit. No mail code exists yet. SMTP keeps the provider (SES, Resend, Postmark) a configuration choice. | Production sends no email until operations sets `SMTP_URL`. Until T-045, someone who signed up with another person's address can send that person at most 20 report emails a day. |
| S3-R8 | **Push seam.** A `NotificationChannel` port (`kind`, `send`) and a channel registry. The `channels` columns already accept `push`. With no push adapter registered, a push delivery is `skipped` (`channel_unavailable`). There is no device-token table yet. | Push then needs one adapter and a device table, with no schema change to existing rows. | None. |
| S3-R9 | **No customer PII in reports, notifications or emails.** They carry counts, money, order codes, product names and SKUs, waiting times and channel names. They never carry customer names, phones, emails or message text. | Email leaves our systems. Notifications are stored for 90 days. The owner can open the app to see who. | The owner has one more click to see which customer. |
| S3-R10 | **A report run does not create a thread.** The run stores the rendered report. "Hỏi trợ lý về báo cáo này" creates (once per run) an `origin: schedule` thread seeded with the report as its first assistant message. | Core §12 says "each run is a fresh thread". With hourly reports that would bury the owner's chats under 24 threads a day. Threads are created only when the owner wants to talk. | One more endpoint. If threads per run are wanted after all, the runner calls the same seeding function. |
| S3-R11 | **The `schedule` tool:** `create`, `edit` and `remove` become **proposals** (new `assistant_proposals.kind = 'schedule'`). `pause`, `resume`, `run` and `list` act at once. Approving a schedule proposal applies it in-process through the schedule service, not through the route invoker: `/assistant` routes are `never` by the architecture test. The owner's own UI actions apply directly. The tool is absent from `origin: schedule` threads (no recursion, core §12). | Core §12 makes creation a proposal. Edit and remove change what the owner receives, so they get the same gate. Pause and resume are reversible. | One more tap for edits. |
| S3-R12 | **Accepting a 1c `schedule` suggestion** validates its payload as a `ScheduleDraft`, marks it `accepted` and returns the draft. The web opens the schedule editor prefilled with it, and **Save is the approval**. It does not create a second proposal. A payload that does not validate answers 422 `invalid_schedule_draft`, and the suggestion is dismissed. | The accept tap is already an owner action. An editor shows every field before anything runs. A proposal would also need a thread, and a suggestion has none. | If card-style approval is wanted, accept creates a `schedule` proposal in the suggestion's source thread instead (1c would have to store the thread id). |
| S3-R13 | **Alerts fire on change.** A check that finds nothing writes no run row; it only moves `last_checked_at`. A hit fires when its fingerprint (sha256 of the sorted ids) differs from the last alert's, or when the same fingerprint is still true 24 h after the last alert. `new_orders` alerts use a time cursor instead of a fingerprint. Alerts run on `every` cadences of at least 15 minutes. Reports run on any cadence, with `every` at least 60 minutes. | Without this, a 15-minute check would send the same "3 khách đang chờ" 96 times a day. | Owners who want every check repeated cannot have it. That would be a flag later. |
| S3-R14 | **Failure policy.** A preflight block (business gone, owner no longer a member of it, owner no longer an active account owner) **pauses the job at once** with `paused_reason`. It sends one notification, except when the user is no longer an owner. An execution failure (an exception while computing) counts. After 3 consecutive failures the job pauses (`failures`) and the owner is notified. A success resets the count. Delivery failures (SMTP) are retried by the notification runner and never pause a job. | Core §12: blocked → one alert and no LLM spend; 3 failures → pause and notify. Execution and delivery statuses are kept apart. | None. |
| S3-R15 | **Missed slots.** A slot less than 6 h late (the worker was down) runs once, late. Older slots are recorded as `skipped` (`missed`), and `next_run_at` moves to the next future slot. There is no backfill. | A morning report at 14:00 is still useful. Ten stale reports are not. | None. |
| S3-R16 | **The bell is for owners only in v1.** The route composes it into `AppShell` next to the account menu, like the assistant launcher. It polls the unread count every 60 s and on window focus. There is no SSE. | Only owners receive notifications in v1, and the inbox UX rule is that every element must earn its space. The `notification.new` event over `realtime` is listed in docs/04 but not built. | Staff get the bell when the first staff notification ships. |
| S3-R17 | **One migration, `0061`**, for both modules (0059 is 1c, 0060 is capability 2). | One PR, ordered numbers. | None. |
| S3-R18 | **No allowance check yet.** The "quota left" preflight is a no-op hook until the owner allowance (core §14) exists. Commentary is bounded instead: one `basic` call per run, at most 600 output chars, recorded as `assistant_runs.kind = 'schedule'`. If the call fails, the report goes out without commentary, and the run is still `done`. | 1a has no quota. | Commentary spend is not capped per month until §14. At most 10 jobs and 24 runs a day each bound it. |

## 4. Data model (migration 0061, additive)

**`assistant_schedules`** (account-scoped, `accountPolicies` + `app_system`):

| Column | Notes |
|---|---|
| `id`, `account_id`, `owner_user_id`, `business_id` → `workspaces(id)` | Every query filters on `account_id` and `owner_user_id` |
| `name` text ≤ 80 | Safety-scanned (`scanUntrustedText`, no URLs, phones or injection), because it goes into emails |
| `template` | `revenue_summary` \| `new_orders` \| `low_stock` \| `unanswered_conversations` \| `new_customers` |
| `mode` | `report` \| `alert`. Allowed pairs as in §1 (CHECK constraint plus Zod) |
| `params` jsonb | Validated per template (§5) |
| `cadence` jsonb | §5. Alerts only `every` |
| `channels` text[] | ⊆ {`in_app`, `email`, `push`}; always contains `in_app` |
| `commentary` bool | Default false |
| `status` | `active` \| `paused` |
| `paused_reason` | NULL \| `owner` \| `failures` \| `business_unavailable` \| `owner_not_active` |
| `next_run_at` | NULL when paused |
| `run_requested_at` | Set by "Chạy ngay" |
| `lease_until` | Runner lease |
| `consecutive_failures` | int, default 0 |
| `last_run_at`, `last_checked_at`, `alert_fingerprint`, `last_alerted_at`, `alert_cursor` | Alert state |
| `created_by` | `owner` \| `assistant` \| `suggestion` |
| `created_at`, `updated_at` | — |

Indexes: `(status, next_run_at)` and `(status, run_requested_at)` (partial, non-null), `(account_id, owner_user_id)`.

**`assistant_schedule_runs`** (account-scoped):

| Column | Notes |
|---|---|
| `id`, `account_id`, `owner_user_id`, `schedule_id` (cascade) | — |
| `trigger`, `scheduled_for` | `trigger` is `cadence` \| `manual`; unique `(schedule_id, scheduled_for)` |
| `status` | `running` \| `done` \| `failed` \| `blocked` \| `skipped` (execution status) |
| `error_code` | `missed`, `business_unavailable`, `compute_failed`… |
| `report` jsonb | Template id, period, figures (no PII), ≤ 16 KB |
| `title`, `body` | The rendered text (§6) |
| `commentary_run_id`, `notification_id`, `thread_id` | Nullable. `thread_id` is set by "Hỏi trợ lý" (S3-R10) |
| `started_at`, `finished_at` | — |

Purged after 90 days by the runner's daily pass. The delivery status is read from `notification` (S3-R5), not copied here.

**`assistant_proposals`:** add `kind text NOT NULL DEFAULT 'route' CHECK (kind IN ('route','schedule','product_import'))` (the shared rule: the import capability adds `product_import`, and either migration may land first). A schedule proposal stores `route_key` = `SCHEDULE create|edit|remove` and `path` = `/assistant/schedules[/<id>]`. Its `body` is `{ op, scheduleId?, draft | patch }`, and its `preview` is `{ draft, before?, cadenceText, nextRuns: [3 ISO times] }`.

**`notifications`** (account-scoped, owned by `notification`):
- `id`, `account_id`, `user_id` → `users`, `workspace_id` (nullable);
- `type` (`assistant.report` \| `assistant.alert` \| `assistant.schedule_paused`), `params` jsonb;
- `title` ≤ 160, `body` ≤ 4 000 (plain text, line breaks);
- `target` jsonb: `{kind:'path', path}` \| `{kind:'assistant_report', runId}`;
- `dedup_key` ≤ 160 (unique per user when set), `read_at`, `created_at`.

Indexes:
- `(account_id, user_id, created_at desc, id desc)`;
- a partial index on `(account_id, user_id)` where `read_at IS NULL`.

Purged after 90 days.

**`notification_deliveries`** (account-scoped):
- `id`, `account_id`, `user_id`, `notification_id` (cascade);
- `channel` (`email` \| `push`);
- `status` (`queued` \| `sending` \| `sent` \| `failed` \| `skipped`), `attempts`, `next_attempt_at`, `lease_until`;
- `error_code`, `provider_message_id`, `sent_at`, `created_at`.

Unique `(notification_id, channel)`; index `(status, next_attempt_at)`. In-app delivery is the `notifications` row itself.

## 5. Schedules

**Draft (shared Zod schema `ScheduleDraft` in `packages/contracts/src/assistant/schedule.schema.ts`):**

```ts
{ name: string ≤ 80, businessId: uuid, template, mode, params, cadence, channels: ('in_app'|'email'|'push')[], commentary: boolean }
```

**Params by template:**

| Template | Params (defaults) |
|---|---|
| `revenue_summary`, `new_customers` | `{ period: 'day'|'week'|'month' = 'day', window: 'previous'|'to_date' = 'previous' }` |
| `new_orders` | Report: `{ period, window }`. Alert: `{ minCount: 1..1000 = 1 }` |
| `low_stock` | `{ threshold: 0..100000 = 5 }` (available = Σ on_hand − reserved over warehouses) |
| `unanswered_conversations` | `{ minutes: 5..1440 = 30, minCount: 1..1000 = 1 }` |

**Rules:**
- **Interval floor:** reports take `every.minutes ≥ 60`; alerts take `every.minutes ∈ {15, 30, 60, 120, 180, 240, 360, 720}`.
- **Active hours:** `activeFrom`/`activeTo` (`HH:mm`) limit when an `every` cadence runs.
- **Limit:** at most 10 schedules per owner per account, active and paused alike, plus pending schedule proposals (`schedule_limit`).
- **Business scope:** the business must be one the owner is an active member of (`scope.businessIds`).
- **Name:** must pass the safety scan (`unsafe_name`).
- **Email:** `email` needs the email channel to be on (`email_unavailable`).

**Periods (pure, Asia/Ho_Chi_Minh):**
- `day` + `previous` is yesterday; `day` + `to_date` is today up to now;
- `week` is Monday to Sunday;
- `month` is the calendar month.

The resolved `{from, to}` local dates go into the run's `report`.

**Routes (owner guard, `@WorkspaceScoped()`, `assistant: never`):**

| Route | Does |
|---|---|
| `GET /assistant/schedules` | `{ items, limit: 10, used, emailAvailable }`. Each item has `cadenceText` inputs, `nextRunAt`, `lastRun {status, finishedAt, delivery}` |
| `POST /assistant/schedules` | Create from a `ScheduleDraft` (owner action, applied directly) |
| `PATCH /assistant/schedules/{scheduleId}` | Edit. Recomputes `next_run_at`. Resets the alert state when params change |
| `POST /assistant/schedules/{scheduleId}/pause`, `…/resume` | `paused_reason = owner`; resume clears it, resets failures and recomputes `next_run_at` |
| `POST /assistant/schedules/{scheduleId}/run` | Sets `run_requested_at`. 409 `run_too_soon` within 5 min of the last manual run |
| `DELETE /assistant/schedules/{scheduleId}` | Hard delete (runs cascade; notifications stay) |
| `GET /assistant/schedules/{scheduleId}/runs?limit≤50` | Runs, newest first, with their delivery summary from `notification` |
| `POST /assistant/schedules/preview` | Computes a draft's report now (no delivery, no commentary): `{ title, body, nextRuns }` |
| `POST /assistant/schedule-runs/{runId}/thread` | Returns the run's thread, creating it once (S3-R10) |

## 6. Runner and preflight

`ScheduleRunner.tick(now)` runs inside the 1c `ASSISTANT_RUNNER` tick (every 15 s):

1. **Claim.** As `app_system`, claim up to 10 schedules where `status = 'active'` and either `next_run_at ≤ now` or `run_requested_at` is set, with no live lease (`FOR UPDATE SKIP LOCKED`, lease 5 min).
2. **Slot.** `scheduled_for` = `run_requested_at` (manual) or `next_run_at`. A cadence slot more than 6 h late becomes a `skipped`/`missed` run (S3-R15). Advance `next_run_at` to the next slot after `now`, and clear `run_requested_at`.
3. **Preflight** (no model call, no data read):
   - the user is still an active owner of the account (`account.listForUser`);
   - the business exists and belongs to the account (`workspace.accountOf`);
   - the owner is an active member of the business (`workspace.findMembership`);
   - the email channel is on and the user has an address, if `email` is chosen. If not, that channel is dropped for this run and the body says so; this is not a block.

   A failure gives a `blocked` run, a pause with the reason, and one notification (S3-R14).
4. **Compute** through `ReportDataSource` (§7) and render the title and body with `@agent-sales/i18n/notification` in the user's locale. Every number is formatted in Vietnamese style (`1.250.000 ₫`).
   - **Alerts:** apply S3-R13. No hit means only `last_checked_at` is set; there is no run row and no notification.
5. **Commentary** (only if `commentary`): one `basic` call with prompt `assistant-schedule-commentary@1.md`.
   - Input: the report JSON only (no PII by S3-R9).
   - Output: at most 600 chars, Vietnamese.
   - The output must pass `scanUntrustedText`; if not, it is dropped.
   - The call is recorded in `assistant_runs` (kind `schedule`).
6. **Deliver.** `notification.notify({ dedupKey: 'sched:<scheduleId>:<scheduledFor>', channels, target: report ? {assistant_report, runId} : {path} })`. The run becomes `done` with its `notification_id`.
   - Alert target paths: `low_stock` → `/app/products`; `unanswered_conversations` → `/app/inbox`; `new_orders` → `/app/orders`.
7. **Failures.** On an exception, the run is `failed` (`compute_failed`) and `consecutive_failures` +1. At 3, the job is paused (`failures`) and the owner gets a `schedule_paused` notification. Logs carry ids and error classes only.

Once a day the runner purges runs and notifications older than 90 days.

## 7. Report data (`ReportDataSource`, S3-R1)

New facade methods, each running in the owning module's `withTenant`:

```ts
// commerce
orderOverview(ws, { from, to }): Promise<OrderOverviewResponse>;                // existing service, now on the facade
ordersPlaced(ws, { since, until, limit ≤ 10 }): Promise<{ count; total; items: { id; code; total; status; source; placedAt }[] }>;
lowStock(ws, { threshold, limit ≤ 20 }): Promise<{ count; items: { productId; variantId; name; sku; available }[] }>;
// conversation
awaitingReply(ws, { olderThan: Date, limit ≤ 200 }): Promise<{ count; oldestSince: string | null; byChannel: { channel; count }[]; ids: string[] }>;
// crm
contactsCreated(ws, { since, until }): Promise<{ count; bySource: { source: string | null; count }[] }>;
```

`ids` from `awaitingReply` and `lowStock` only feed the alert fingerprint. They are never stored or delivered.

## 8. `notification` module

**Facade (`NOTIFICATION_FACADE`):**

```ts
notify(i: { accountId; userId; workspaceId?; type; params; title; body; target; channels: ('in_app'|'email'|'push')[]; dedupKey? }): Promise<{ id: string; deduped: boolean }>;
recipientLocale(userId): Promise<'vi' | 'en'>;   // so the producer renders in the right language
emailAvailable(): boolean;
deliverySummary(accountId, userId, ids: string[]): Promise<Map<string, { email?: DeliveryStatus; push?: DeliveryStatus }>>;
```

`notify`:
- inserts the row (`ON CONFLICT (user_id, dedup_key) DO NOTHING`);
- inserts one `queued` delivery per non-in-app channel, in the same transaction.

**Runner (`NOTIFICATION_RUNNER.tick`, worker, every 5 s):**
- Claims up to 20 due deliveries (lease 2 min).
- Resolves the address and locale through `identity.profile`.
- Applies the 24 h cap of 20 emails per user (`daily_cap`).
- Sends through the registered `NotificationChannel` for the channel; no adapter → `channel_unavailable`.
- Retries 3 times (1, 5, 30 min) before `failed`.
- Delivery is at-least-once: a crash between a send and the status write can resend once.

**Email channel (`infrastructure/clients/smtp-email.channel.ts`, `nodemailer`):**
- The subject is the title.
- The body is the plain text plus a minimal HTML version, escaped, with a Rapiz orange header and the footer "Quản lý lịch báo cáo trong Rapiz" linking to `APP_PUBLIC_URL/app` (no link when that is unset).
- Logs mask the address.

**HTTP (`@WorkspaceScoped()`; the account comes from the current business; the user's own rows only, another user's id → 404; `assistant: never`):**
- `GET /notifications?before&beforeId&limit≤50` (keyset);
- `GET /notifications/unread-count`;
- `POST /notifications/{notificationId}/read`;
- `POST /notifications/read-all`.

## 9. Web

- **`features/notification`:**
  - the bell (shadcn `Popover`, unread badge capped at "9+");
  - a list with title, body (3 lines, expandable), relative time and an unread dot;
  - "Đánh dấu đã đọc";
  - empty, loading and error states.

  `AppShell` gains a `headerActions` prop; `routes/app.tsx` passes the bell for owners (S3-R16).
- **Clicks:**
  - A `path` target navigates through `safeAppPath`, which moves to `apps/web/src/lib/safe-app-path.ts` because two features need it.
  - An `assistant_report` target calls `requestAssistantOpen({ reportRunId })` from `lib/assistant-context.ts`. The assistant feature listens, calls `POST /assistant/schedule-runs/{runId}/thread` and opens that thread.
- **Assistant panel, "Lịch báo cáo" view:**
  - a list (name, business, template, cadence in words, next run, last run status with delivery, a pause/resume switch, "Chạy ngay", edit, delete), with `used/10`;
  - an editor (business, template, mode, the params fields, a cadence picker, channels with email disabled and explained when `emailAvailable` is false, the commentary switch, "Xem thử" showing the preview);
  - the runs list.
- **Proposal card:** `kind: 'schedule'` renders a schedule card (name, template, cadence in words, channels, the next 3 runs; for edit, before → after) instead of the route verb line.
- **1c suggestion of kind `schedule`:** "Đồng ý" opens the editor prefilled (S3-R12).
- **i18n:** all strings in the `notification` namespace (bell and templates, shared with the backend renderer) and the `assistant` namespace (schedules view), vi and en.

## 10. Security and tenancy

- Owner guard on every schedule route, on the tool and in the runner preflight.
- `withAccount` plus explicit `account_id` and `owner_user_id`/`user_id` filters on every query.
- The business is re-checked at approval and at every run.
- Report data is read under the business's `withTenant` RLS.
- No customer PII leaves in reports (S3-R9).
- Model-written text (the schedule name, commentary) is safety-scanned before it reaches an email.
- Email goes only to the user's own address, with a daily cap (S3-R7).
- `SMTP_URL` is a secret env var and is never logged.
- Cross-tenant tests: another owner's schedule, run or notification → 404; staff → 403 on every assistant schedule route.

## 11. Performance

- A runner pass handles at most 10 schedules and 20 deliveries. Each report makes at most 3 facade reads.
- The 15 s tick and the 5 s delivery tick run one at a time per process, as the other runners do.
- Polling the bell's unread count is an index-only count on the partial index, ≤ 5 ms at p95.
- docs/16 gets these budgets.

## 12. Testing

- **Pure:**
  - `nextRunAt` for every cadence kind (month-end, `-1`, active hours, the 6 h missed rule);
  - period resolution (week boundaries, month to date);
  - draft validation (mode/template matrix, interval floor, limit);
  - the alert decision (fingerprint change, the 24 h repeat, the cursor);
  - renderers (Vietnamese money format, no PII fields).
- **Integration:**
  - RLS isolation of schedules, runs, notifications and deliveries across two accounts;
  - two claimers get disjoint schedules;
  - the unique run slot;
  - `notify` dedup;
  - delivery claim and retry.
- **Facades:** each new read method against seeded data, including a cross-workspace check.
- **Runner:**
  - a fake data source and a fake mailer;
  - preflight blocks and pauses;
  - 3 failures pause and notify;
  - an alert does not repeat, then repeats after 24 h;
  - commentary failure still delivers;
  - a manual run;
  - email skipped when SMTP is off and capped at 20.
- **Tool and proposals:**
  - create, edit and remove give a pending `schedule` proposal;
  - approve applies and re-validates (limit, business);
  - pause/resume/run act at once;
  - the tool is absent in a schedule thread.
- **HTTP:** each route's happy path, validation, staff 403 and cross-tenant 404.
- **Web:** bell badge and mark-read, report click opens the assistant thread, schedule editor validation and preview, schedule proposal card, suggestion prefill.
- **Assistant eval:** "mỗi sáng thứ Hai 8h gửi doanh thu tuần trước qua email" gives a `schedule` create proposal with `weekly {days:[1], at:'08:00'}`, `revenue_summary {period:'week', window:'previous'}` and channels `in_app` + `email`.

## 13. Adjustments made while building

Status: shipped on `feat/T-172-assistant-schedules` (migration 0061). What changed from the sections above:

- **Repository names.** `insertRun`, `finishRun` and `purgeOldRuns` became `insertScheduleRun`, `finishScheduleRun` and `purgeOldScheduleRuns` (the assistant runs already had a `finishRun`). `countPendingScheduleProposals` counts only pending `SCHEDULE create` proposals: an edit or a removal does not add a schedule.
- **Delivery retries.** "Retries 3 times (1, 5, 30 min)" is 4 attempts in all (`MAX_DELIVERY_ATTEMPTS = RETRY_MINUTES.length + 1`).
- **Safe paths.** `notification` has its own `isSafeAppPath`, stricter than the web's (the path must already be normalised). The web `safeAppPath` moved to `apps/web/src/lib/safe-app-path.ts` (3-P4).
- **Staff on notification routes.** Any user may call the notification routes and sees only their own rows (no 403); schedules stay owner-only.
- **Report figures.** `lowStock` counts only variants with inventory rows; `contactsCreated` groups by the first source and leaves archived customers out; the low-stock fingerprint covers the first 20 variants (the facade cap).
- **Schedule routes** live in their own `SchedulesController` on `SchedulesService`, not on `AssistantFacade`. Validation answers 400 `VALIDATION_FAILED` with `details.reason` (the first problem) and `details.problems`; params that do not fit the template give `invalid_params`. An edit keeps email that is already on the schedule while email is off (only adding it needs email on) and does not re-check the limit; `expectedUpdatedAt` mismatch is 409 `stale_schedule`. A run of a paused schedule is 409 `schedule_paused`.
- **Report threads.** `threadForRun` seeds one assistant message `"<title>\n\n<body>"` (the commentary is part of the body); a run without a report is 409 `run_has_no_report`.
- **Runner.** Assistant-specific `ASSISTANT_SCHEDULE_RUNNER`, ticked by the worker every 15 s; the 1c `ASSISTANT_RUNNER` is not on this branch and can call it when it lands.
- **`schedule` tool.** Extra error codes `draft_required`, `patch_required` and `too_many_pending`. Contracts export `ScheduleDraftFields` and `SchedulePatchFields` (the shapes without their refinements, used as the tool input) and `ScheduleSuggestionAccept`.
- **1c pieces not on this branch.** The suggestions accept route and the review's `suggest` tool are built on the 1c branch: here, `SchedulesService.acceptSuggestion` implements S3-R12 (valid → `accepted` with `scheduleDraft`; invalid → `dismissed`, `invalid_schedule_draft`) for that route to call, and the web exposes `useAssistantUi().openScheduleEditor(draft)`, which opens the panel on a prefilled editor, for the 1c suggestions UI. There is no settings UI here; the tool reads `assistant_settings.disabled_toolsets` for the `schedule` toolset.
- **Evals.** Owner assistant evals have their own format and runner (`apps/backend/src/modules/assistant/evals/`, cases in `apps/backend/evals/assistant/`), run by `pnpm test` with a scripted model and by `pnpm --filter @agent-sales/backend eval:assistant [--live]`; the shop-bot eval loader skips that folder.
- **Web.** The panel's views are icon buttons in its header (no menu), so "Lịch báo cáo" is one more button. The bell's badge is eager; its list and the `notification` namespace load on the first open; its labels live in `common` (`app.notifications*`). Report notifications open the thread through `requestAssistantOpen` (in `lib/assistant-context.ts`), which the bubble consumes (`api/report-thread.ts`, so the eager bubble does not load the panel's API). The editor keeps a cadence's active hours but does not edit them. Times are shown in the browser's time zone.
- **Proposal kinds.** §4 first said `CHECK (kind IN ('route','schedule'))`; the code uses the shared three-value rule (`'route' | 'schedule' | 'product_import'`, contracts `AssistantProposalKind`), as `docs/05` does.
- **Runner state write (final review).** The final write (`saveScheduleState(id, outcome, claim)`) writes the run outcome (failure count, last run/check, alert state) as is, and applies the status, `next_run_at` and `run_requested_at` to the row as locked at write time: `run_requested_at` is cleared only while it still holds the claimed request, `next_run_at` is computed from the stored cadence and only when a cadence slot was taken, and a pause applies only while the schedule is still active. So a "run now" or a cadence edit made during the lease is kept, and a manual run claimed with a due cadence slot leaves that slot for the next tick. A quiet alert check is a success and resets `consecutive_failures`. A cadence report resolves its period from `scheduled_for`, not the tick time (alerts and manual runs use the tick time).
- **Delivery attempts.** The delivery runner stores the attempt count before it sends; a reclaimed `sending` delivery whose attempts are used up becomes `failed` (`send_interrupted`) without another send.
- **Email provider (main sync, 2026-11-03).** S3-R7's SMTP channel (`nodemailer`, `SMTP_URL`, `MAIL_FROM`) was replaced by the backend `Mailer` port that main added for signup codes (ADR-023, Resend): the `notification` email channel (`MailerEmailChannel`) is on when `RESEND_API_KEY` is set and sends from `EMAIL_FROM`; unset, deliveries are `skipped` (`email_disabled`) as before.
- **E2E.** The mocked session of `e2e/responsive.spec.ts` is not an account owner, so the bell is not rendered there.
