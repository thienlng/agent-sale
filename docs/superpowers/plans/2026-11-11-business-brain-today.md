# Business Brain v1 and Today Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship per-conversation AI signals (evaluated only when a conversation goes idle, under a daily cap), a Task object, the "Hôm nay" screen, a morning briefing and a complaint alert.

**Architecture:**
- A new tier-3 backend module `brain` owns:
  - signals, evaluation jobs and runs, and the daily usage counter;
  - the Today query API;
  - the briefing tick.
- `crm` gains `tasks`.
- Both modules run worker `setInterval` ticks over Postgres-leased job tables, the same way `assistant_jobs` and the analytics outbox projector do. There is no BullMQ.
- The web gets a new `features/brain` folder with a `/app/today` route.

**Tech Stack:**
- Backend: NestJS on Fastify, Drizzle and SQL migrations, Zod contracts (`packages/contracts`).
- AI: `AI_LLM_GATEWAY` (`packages/ai-core`, tier `basic`).
- Web: Vite, React, TanStack Router and Query, shadcn, i18n in `packages/i18n`.
- Tests: Vitest.

**Spec:** `docs/superpowers/specs/2026-11-11-business-brain-today-design.md` (approved 2026-11-11). Read it before any task.

## Global Constraints

- **Language:** English for code, comments, docs and commits. Vietnamese only in `packages/i18n/src/messages/vi/*.json`.
- **Architecture:**
  - Module shape follows `docs/ARCHITECTURE.md`. Create the module with `pnpm gen module brain`, never by hand.
  - Cross-module calls go through facades only.
  - Every tenant table has RLS (`app_tenant` and `app_system` policies), copied from `0037_conversation_summaries.sql`.
- **Migrations:** a single migration, `0072_business_brain.sql`, additive only.
- **Signals:**
  - LLM calls only on idle, manual or refresh triggers. Never per turn, and no keyword rules.
  - Tier `basic`, `maxOutputTokens` 600, timeout 20 s, one retry on invalid JSON.
  - Default idle wait 45 min, settable 30–120.
  - Cap entitlement key `brain.evaluations.daily`, default 200 per business per day in Asia/Ho_Chi_Minh; `null` means unlimited.
- **Stage enum:** `new|exploring|price_asked|ready|won|after_sale|lost|spam`.
- **Mood enum:** `positive|neutral|negative|complaint`.
- **Notification types:** `today.briefing`, `brain.complaint`, `task.due`.
- **Briefing:** at 08:00 by default, counts only, no LLM call, skipped when every count is zero.
- **Reply drafts:** one LLM call only when the user clicks, and never sent automatically.
- **Visibility:** sales and care roles see only their own and unassigned customers. This is the existing `contacts.view_all` rule.
- **Done means:** `pnpm check` is green, and UI screenshots are taken at desktop (1440) and phone (390) widths.
- **Commits:** Conventional Commits; the scope must be in the commitlint enum (use `backend`, `web`, `db`, `crm`, `docs`). End each message with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

### Task 1: Migration and Drizzle schema

**Files:**
- Create: `packages/db/migrations/0072_business_brain.sql`.
- Create: `packages/db/src/schema/brain.ts`, exported from the schema index the way the other schema files are.
- Modify: `packages/db/src/schema/crm.ts`, adding the `tasks` table.
- Test: the existing RLS and tenant-isolation test pattern in `packages/db` (find it with `grep -rl "force row level security" packages/db/src`). Add the new tables to it.

**Interfaces (Produces):**

Signals table:
```
conversation_signals(workspace_id uuid, conversation_id uuid PK(ws,conv), contact_id uuid null,
  stage text not null default 'new', intent text null, mood text not null default 'neutral',
  needs_human boolean not null default false, needs_human_reason text null,
  follow_up_at timestamptz null, follow_up_reason text null, note text null,
  evaluated_until timestamptz null, evaluated_at timestamptz null, stage_locked boolean not null default false,
  dismissed_until_message_after timestamptz null, version int not null default 1, updated_at timestamptz)
```

Job, run and usage tables:
```
signal_jobs(workspace_id, conversation_id PK(ws,conv), trigger text, run_after timestamptz, status text
  ('pending'|'capped'), lease_until timestamptz null, attempts int default 0)
signal_runs(id uuid pk, workspace_id, conversation_id, trigger text, tier text, model text null,
  input_tokens int, output_tokens int, outcome text ('ok'|'invalid'|'error'|'timeout'), created_at)
signal_usage(workspace_id, day date, count int, PK(ws,day))
brain_settings(workspace_id pk, mode text default 'auto' ('auto'|'manual'), idle_minutes int default 45,
  briefing_enabled boolean default true, briefing_hour int default 8, last_briefing_day date null)
```

Tasks table:
```
tasks(id uuid pk, workspace_id, title text, note text null, due_at timestamptz null,
  assignee_kind text default 'member', assignee_user_id uuid null, status text default 'open',
  done_at, done_by, contact_id null, conversation_id null, subject_type text null, subject_id uuid null,
  source text ('manual'|'today'|'assistant'), created_by uuid null, created_at, updated_at, version int,
  reminded_at timestamptz null)
```

Indexes:
- `tasks (workspace_id, status, due_at)`.
- `tasks (workspace_id, assignee_user_id) where status='open'`.
- `signal_jobs (run_after) where status='pending'`.
- `conversation_signals (workspace_id, stage)`.
- `conversation_signals (workspace_id, follow_up_at)`.

**Steps:**

- [ ] Write the SQL (check constraints on the enums and the length limits from the spec), RLS for every table, and the Drizzle mirrors.
- [ ] Add the tables to the RLS test, then run `pnpm --filter @agent-sales/db test`. Expect a fail before the migration exists and a pass after.
- [ ] Apply the migration to dev: back up first with `pg_dump` to `~/Workspace/rapiz-backups`, then run `pnpm db:migrate`.
- [ ] Commit with `feat(db): add business brain and task tables`.

### Task 2: Tasks in crm

**Files:**
- Create: `packages/contracts/src/crm/task.schema.ts`.
- Modify: `packages/contracts/src/crm/crm.routes.ts`.
- Create, following the existing crm layout: domain `task.ts` (rules), application service, Drizzle repository, HTTP controller.
- Create: a `CRM_TASK_RUNNER.tick()` for due reminders, registered in `apps/backend/src/entries/worker.ts` every 30 s.
- Modify: the notification module's closed type union (`domain/notification.ts` and the contracts mirror) to add `task.due`.

**Interfaces (Produces):**

DTOs:
```ts
TaskDto { id, title, note, dueAt: string|null, assigneeUserId: string|null, assigneeName: string|null,
  status: 'open'|'done'|'cancelled', contactId, conversationId, subjectType, subjectId,
  source: 'manual'|'today'|'assistant', createdAt, doneAt, version }
CreateTaskRequest { title (1..200), note? (≤2000), dueAt?, assigneeUserId?, contactId?, conversationId?, subjectType?, subjectId?, source? }
UpdateTaskRequest { title?, note?, dueAt?, assigneeUserId?, version }
TaskListQuery { scope: 'mine'|'all', status?: 'open'|'done'|'overdue', contactId?, conversationId?, limit, cursor }
```

Routes:
- `GET /tasks`, `POST /tasks`, `PATCH /tasks/{id}`, `POST /tasks/{id}/complete`, `POST /tasks/{id}/cancel`.
- Every route declares `assistant: { use: 'read'|'write', when }`.
- Capability rules:
  - Reading or editing someone else's task needs `contacts.view_all`.
  - Without it, the user only sees their own tasks and unassigned tasks.
  - Any member may create a task.

Facade additions on `CRM_FACADE`:
- `countOpenTasks(ws, {userId?, dueBefore})`
- `listOpenTasks(ws, {userId?, limit})`

These are used by Task 4.

**Steps:**

- [ ] Write domain tests:
  - Completing a task twice is idempotent.
  - A version mismatch gives a conflict.
  - Visibility rules hold.
- [ ] Write HTTP tests in the style of the existing crm controller tests:
  - Create, list `mine` against `all`, complete.
  - A sales user cannot see another user's task.
- [ ] Write a reminder tick test: a due open task notifies the assignee once (`dedupKey task:<id>:due`, channels in-app and push, target path `/app/today`), then sets `reminded_at`.
- [ ] Implement until green: `pnpm --filter @agent-sales/backend test -- crm`.
- [ ] Commit with `feat(crm): add tasks with due reminders`.

### Task 3: The `brain` module — scheduling, evaluation, cap, settings, alert

**Files:**
- Run `pnpm gen module brain`, then add the module to the `docs/ARCHITECTURE.md §3` table as tier 3. Domain files:
  - `schedule.ts`: `nextRunAfter`, `shouldSkip`.
  - `signal.ts`: types, merge rules, stage lock.
  - `evaluation-prompt.ts`: the prompt builder and the output Zod schema.
- Application files:
  - `signal-scheduler.ts`: the outbox consumer.
  - `signal-evaluator.ts`
  - `signal-runner.ts`: `BRAIN_RUNNER.tick()`.
  - `usage.service.ts`
  - `settings.service.ts`
- Infrastructure: Drizzle repositories.
- HTTP:
  - `POST /conversations/{id}/signals/evaluate`
  - `GET /conversations/{id}/signals`
  - `PATCH /conversations/{id}/signals` (stage override; sets `stage_locked`)
  - `GET /brain/settings`, `PUT /brain/settings`
  - `GET /brain/usage`
- Contracts: `packages/contracts/src/brain/`.
- Billing: add the entitlement key `brain.evaluations.daily` to plan defaults (200 on every plan; internal plans `null`). Find where `members.max` is defined.
- Register in `entries/worker.ts`: `BRAIN_RUNNER.tick` every 15 s, which also runs the outbox consumer pass.
- Notification type `brain.complaint`.

**Interfaces:**

Consumes:
- `conversation.message.received.v1` from `outbox_events`, read the way analytics' projector reads it, with its own checkpoint row.
- `CONVERSATION_FACADE`: messages after a time, facts. Add a narrow facade method if needed, such as `signalContext(ws, convId, after)` returning `{ messages: {sender, text, at}[] (last 40, ≤8000 chars), facts: {status, contactId, assigneeId, awaitingSince, lastInboundAt, isTest} }`.
- `CRM_FACADE.getContact` for the contact status.
- Commerce or lodging "has order or booking since": only when a facade method already exists; otherwise leave it out.
- `AI_LLM_GATEWAY.generate`, `BillingFacade.limit`, `NOTIFICATION_FACADE.notify`.
- The `conversation_summaries` note: through a small `ai` facade getter. Add one if it is missing.

Produces, used by Task 4:
- `BRAIN_FACADE.signalsFor(ws, convIds)`
- `BRAIN_FACADE.evaluateNow(ws, convId, trigger)` returning `{status:'ok'|'capped'|'nothing_new'|'disabled'}`
- `BRAIN_FACADE.usage(ws)` returning `{used, limit}`
- `BRAIN_FACADE.settings(ws)`

Rules, each needing a test:
1. Every customer message upserts the job with `run_after = max(existing, at + idle)`. Bot and human messages do not schedule.
2. The tick claims due `pending` jobs with `FOR UPDATE SKIP LOCKED` and a 2-minute lease. It skips when:
   - the mode is `manual` (the job is deleted);
   - the conversation is a test or closed;
   - there is no customer message after `evaluated_until` (the job is deleted).
3. Cap:
   - Reserve atomically: `insert … on conflict do update set count = count + 1 where count < limit returning`.
   - A failed call releases the reservation.
   - When the cap is reached, the job becomes `capped` and the next day's first tick resets capped jobs back to `pending`.
4. The evaluator input is the previous note (or the stored summary on the first run), plus the new messages, plus one fact line.
   - Output Zod: `{stage, intent≤160, mood, needsHuman, needsHumanReason?, followUpAt? (ISO, must be in the future, ≤60 days), followUpReason?, note≤1500}`.
   - Invalid output is retried once, then recorded as outcome `invalid`, and the signals stay unchanged.
5. Write rules:
   - `stage_locked` keeps the stored stage.
   - `evaluated_until` becomes the time of the last covered message.
   - Clear `dismissed_until_message_after` only when a newer customer message exists.
6. Alert: on a transition to `mood = complaint`, notify the owner (via `workspace.accountOf` and account ownership, as the assistant schedule runner preflight does) and the assignee. Use `dedupKey brain.complaint:<conv>:<day>` and target `conversation`.
7. Each call writes one `signal_runs` row.

**Steps:**

- [ ] Generate the module and write domain unit tests for rules 1–5 (fail first).
- [ ] Implement domain, application and infrastructure code, with evaluator tests that use a fake gateway (incremental input, retry, metering, cap release).
- [ ] Write HTTP tests:
  - Evaluate when under the cap, and get `capped` when over it.
  - Stage override locks the stage.
  - Settings validation (idle 30–120, hour 0–23).
  - Tenant isolation.
- [ ] Run `pnpm --filter @agent-sales/backend test -- brain`, then `pnpm arch`.
- [ ] Commit with `feat(backend): add brain signals evaluated when conversations go idle`.

### Task 4: Today API, reply draft, morning briefing

**Files:** in the `brain` module:
- `application/today.query.ts`
- `application/reply-draft.service.ts`
- `application/briefing.ts`, run from `BRAIN_RUNNER.tick` once per minute
- HTTP routes:
  - `GET /today`
  - `POST /today/items/{conversationId}/dismiss`
  - `POST /today/refresh`, which evaluates conversations with unevaluated customer messages, highest priority first, within the remaining cap, at most 20 per call
  - `POST /conversations/{id}/reply-draft`
- Notification type `today.briefing`.

**Interfaces (Produces):**
```ts
TodayResponse { queues: { key: 'attention'|'unanswered'|'ready'|'price_silent'|'follow_up'|'tasks', count: number,
  items: TodayItem[] /* ≤ 20 each */ }[], usage: {used, limit}, mode: 'auto'|'manual', generatedAt }
TodayItem { conversationId, contactId, customerName, channel, reason: string /* intent / needsHumanReason / followUpReason */,
  stage, mood, at: string, assigneeName: string|null, stageLocked: boolean }
// tasks queue items: TaskDto
ReplyDraftResponse { text: string }
```

Queue rules (spec §5), each needing a test:
- **attention:** `mood=complaint` or `needs_human`, and no human outbound since the evaluation.
- **unanswered:** `awaiting_since` older than 15 min. No signal is needed.
- **ready:** `stage=ready`.
- **price_silent:** `stage=price_asked` and last inbound older than 24 h.
- **follow_up:** `follow_up_at ≤ now`, or the conversation's `followUpAt ≤ end of today`.
- **tasks:** open tasks due by the end of today or overdue (mine only, or all with `contacts.view_all`).
- Exclusions:
  - Dismissed items are excluded until a newer customer message arrives.
  - Sales and care users only get conversations assigned to them or unassigned.
  - A conversation appears in the first matching queue only.

Reply draft: one `basic`-tier call that uses the signals note, the last 20 messages and the bot's persona if one is available. Each draft counts toward the cap.

Briefing:
- For each business with `briefing_enabled`, at local `briefing_hour`, and when `last_briefing_day` is before today, compute the counts.
- When the sum is greater than 0, notify the owner and admins with `today.briefing`. The title is "Hôm nay: 3 cần chú ý, 8 sắp chốt…", built from i18n keys via `recipientLocale`; the target path is `/app/today`; channels are in-app and push.
- Set `last_briefing_day`.

**Steps:**

- [ ] Write query tests over seeded rows for each queue rule, the exclusions and role visibility (fail first).
- [ ] Implement the query, endpoints, draft and briefing.
- [ ] Write briefing tests: it fires once per day, is skipped at zero, and respects the hour in Asia/Ho_Chi_Minh.
- [ ] Commit with `feat(backend): add the Today queues, reply drafts and morning briefing`.

### Task 5: Web — Today page, tasks, settings

**Files:**
- `apps/web/src/features/brain/`: api hooks, `today-page.tsx`, `today-queue.tsx`, `today-item.tsx`, `task-dialog.tsx`, `stage-menu.tsx`, `brain-settings-card.tsx`.
- `apps/web/src/routes/app/today.tsx`.
- `components/layout/app-sidebar.tsx`: "Hôm nay" first in `HOME`, with a badge from `NavCounts`.
- The inbox customer panel: a tasks block and a "Đánh giá lại" button with the signal summary.
- The inbox composer: accept a prefilled draft (look for how a draft or prefill is passed; add a search param `draft` or a store field).
- The settings page section: under the bot or assistant settings, wherever settings cards live.
- i18n: new `brain` namespace in `packages/i18n/src/messages/{vi,en}/brain.json`, plus `nav.today`.
- `assistant/domain/dashboard-map.ts`: add `/app/today`.
- `e2e/responsive.spec.ts`: add `/app/today`.

**Page layout:**
- The header shows the title "Hôm nay" and the date.
- "Làm mới (còn N lượt)" sits in the header. When the cap is used up, a banner reads "Đã hết lượt đánh giá hôm nay — các mục chỉ dựa trên dữ liệu có sẵn". In manual mode, a hint explains the mode.
- Six queue sections, each a card with a count and its items. Each queue has an empty state.
- Each item shows:
  - Avatar or initials, name, channel icon, reason line, relative time, a stage badge, and the assignee.
  - Actions: **Mở hội thoại** (to `/app/inbox/<conversationId>`), **Soạn trả lời** (calls the draft API, then opens the inbox with the draft prefilled), **Thêm việc** (task dialog prefilled with the conversation and contact), **Bỏ qua**, **Đánh giá lại**, and a stage menu that locks the stage.
- The tasks section lists tasks with a checkbox to complete, the due date and the assignee.
- Phone width shows a single column with actions in an overflow menu.

**Steps:**

- [ ] Write component tests with `renderWithProviders` and `stubFetch` (see `features/assistant/components/assistant-page.test.tsx`):
  - Queues render.
  - Dismiss removes the item.
  - Draft navigates with the draft.
  - The cap banner shows.
  - A task is created and completed.
  - The sidebar item comes first and shows its count.
- [ ] Implement; build i18n with `pnpm --filter @agent-sales/i18n build`.
- [ ] Restart Vite on dev (clear `apps/web/node_modules/.vite`) and take screenshots at desktop 1440 and phone 390 through `localhost:4000`. Fix any ragged alignment.
- [ ] Commit with `feat(web): add the Today screen, tasks and brain settings`.

### Task 6: Docs, ADR, export, check, PR

**Files:**
- `docs/adr/030-business-brain-signals.md`, plus a row in the `docs/adr/README.md` index.
- `docs/02-functional-requirements.md`: new `BRN-01..06` rows; mark CRM-04 as partly done.
- `docs/03-screens-and-routes.md`: the Today screen.
- `docs/05-data-model.md`: the new tables.
- `apps/backend/src/modules/brain/MODULE.md` and `crm/MODULE.md`.
- `dataexport`: include `tasks` and `conversation_signals` in the export, following its existing table list, with a test.

**Steps:**

- [ ] Write the docs and the ADR. The ADR covers four decisions and their reasons:
  - idle-only evaluation with a cap, rather than per turn or keyword rules;
  - signals per conversation;
  - tasks in crm;
  - autonomy deferred.
- [ ] Add the export change and its test.
- [ ] Run `pnpm check`. Move `.playwright-mcp` and other scratch files out of the repo first.
- [ ] Have a fresh-context opus agent review the branch (`review-pr` skill), then fix what it finds.
- [ ] Measure tokens on dev: trigger about 20 evaluations and read `signal_runs`.
- [ ] Open the PR via REST, wait for CI, and squash-merge.
