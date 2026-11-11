# Business Brain v1 and the "Hôm nay" screen — design

Date: 2026-11-11 · Status: draft for owner review · Phase 0+1 of the Agentic Business OS roadmap

## 1. Goal

Give the owner one screen they open first every morning: **what needs doing today, and why**,
across every conversation of the business. To get there, add the first two primitives of the
"Agentic Business OS":

1. **Signals** — what Rapiz understands about each conversation (stage, intent, mood, whether a
   person is needed, when to follow up), produced by an LLM **only when the conversation goes
   idle**, under a daily cap.
2. **Tasks** — one object for "something someone must do", linked to a customer, conversation or
   order, with an assignee and a due time.

Then build on them: the **"Hôm nay" (Today)** screen, a **morning briefing** push and an instant
**complaint alert**.

Out of scope here (later phases): autonomy levels and any action the AI performs on its own
(phase 2, with the first consumer — the follow-up agent), workflows/WFL, Zalo OA/ZNS, payments,
assistant goal delegation.

## 2. Owner decisions this design follows

- Signals come **only** from an LLM evaluation run when a conversation has gone quiet. No keyword
  rules, no labels piggybacked on bot turns.
- Plain facts already in the database (waiting since, last message sender, has an order, contact
  status, follow-up date) are read directly; they are data, not evaluation.
- Token spend is bounded: cheapest tier, incremental input, a per-business daily cap, a
  **"Chỉ khi tôi bấm" (manual only)** mode, and a **"Đánh giá lại"** button.
- An owner's manual correction of the stage wins over the AI and is kept.

## 3. Signals

### 3.1 What is stored (per conversation)

`conversation_signals` (one row per conversation, new module `brain`):

| Field | Meaning |
|---|---|
| `stage` | `new` · `exploring` · `price_asked` · `ready` (ready to buy/book) · `won` · `after_sale` · `lost` · `spam` |
| `intent` | one short line: what the customer wants (≤ 160 chars) |
| `mood` | `positive` · `neutral` · `negative` · `complaint` |
| `needs_human` | true when the AI judges a person must step in (with `reason`) |
| `follow_up_at`, `follow_up_reason` | when and why to get back in touch (nullable) |
| `note` | rolling memory note of the conversation (≤ 1 500 chars, Vietnamese) — the incremental input of the next run |
| `evaluated_until` | channel time of the last message covered, never moved back; covered messages are never re-evaluated (a webhook stored late behind a covered message is not sent to the model) |
| `stage_locked` | set when a member changes the stage by hand; the AI stops writing `stage` |
| `evaluated_at`, `version` | bookkeeping |

The stage labels are generic; the dashboard group (shop/hotel/saas/service) only changes wording
("chốt đơn" vs "đặt phòng"), per the minimal-industry-UI rule. Signals do **not** move the CRM
status in v1 — changing customer data is an action and waits for autonomy levels (phase 2).

### 3.2 When an evaluation runs

- The module consumes `conversation.message.received.v1` from the outbox (same mechanism as
  analytics). A customer message upserts one `signal_jobs` row per conversation with
  `run_after = now + idle` (default 45 min, settable 30–120). Every newer customer message pushes
  `run_after` back — the pattern `assistant_jobs` already uses.
- A worker tick (every 15 s) claims due jobs with `FOR UPDATE SKIP LOCKED` and a lease. It skips
  a job when: the business is in manual mode, the conversation is closed/spam-blocked, nothing new
  arrived since `evaluated_until`, or the daily cap is used up (job kept as `capped`, retried the
  next day only if still relevant).
- **Manual:** `POST /conversations/{id}/signals/evaluate` runs it now (counts toward the cap).
  "Làm mới" on Today evaluates only conversations with unevaluated customer messages, highest
  priority first, within the remaining cap.

### 3.3 One evaluation

- Input: previous `note` + the messages after `evaluated_until` (at most the last 40 messages /
  8 000 chars; older ones are only in the note) + a short fact line (contact status, has order,
  last order date, who spoke last). First run of a long conversation starts from the stored
  `conversation_summaries` note when one exists.
- One call on the **`basic`** tier with a JSON schema output (all fields above + new `note`).
  `maxOutputTokens` 600, timeout 20 s, one retry on invalid JSON.
- Expected size (estimate, to be measured on dev): 1–2 k input tokens, 150–300 output tokens.
- Each run writes a `signal_runs` row (tokens, tier, model, outcome, trigger `idle|manual|refresh`;
  a reply draft records `draft`) for cost reporting; `ai_runs` stays bot-only.
- Unknown enums or booleans make an answer invalid; over-long text is cut to the column limits and
  an unusable `followUpAt` (past, > 60 days, unreadable) becomes none.
- Never runs on test/playground conversations.

### 3.4 Cap

- Entitlement key `brain.evaluations.daily` read through `BillingFacade.limit` (per business, per
  day in Asia/Ho_Chi_Minh). Default plans: 200; `null` = unlimited for internal shops.
- Counter `signal_usage(workspace_id, day, count)` reserved atomically before the call, released on
  failure.
- Settings → Trợ lý / Bot page shows "Đã dùng 37/200 lượt đánh giá hôm nay" and the mode switch
  (Tự động khi hội thoại lắng / Chỉ khi tôi bấm) and idle minutes.

## 4. Tasks

`tasks` table, owned by **crm** (as `docs/04` and `docs/05` already plan; CRM-04):

| Field | Note |
|---|---|
| `title`, `note` | ≤ 200 / ≤ 2 000 chars |
| `due_at` | nullable |
| `assignee_user_id` | member; null = unassigned. (`assignee_kind` `member|ai` column added now, `ai` unused until phase 2) |
| `status` | `open` · `done` · `cancelled`, with `done_at`, `done_by` |
| `contact_id`, `conversation_id`, `subject_type` + `subject_id` | links (order, booking…) as opaque ids |
| `source` | `manual` · `today` · `assistant` |
| `created_by`, `created_at`, `version` | |

- API: list (mine / all with `contacts.view_all`, open/overdue/done), create, update, complete,
  cancel. Contracts declare `assistant: write` so the owner assistant can propose tasks through
  its existing approval flow.
- Reminder: a worker tick notifies the assignee (in-app + push) when `due_at` passes, once per
  due time and assignee (`dedupKey task:<id>:due:<due ms>`; editing either reminds again).
  Offsets (SET-05) later.
- Web: a "Việc" block on Today, a "Thêm việc" action on each Today item, and a task list in the
  customer panel of the inbox. The existing conversation `followUpAt` stays as is and is shown in
  Today's follow-up queue; merging it into tasks is a later clean-up.

## 5. The "Hôm nay" screen

Route `/app/today`, first item of the business sidebar ("Hôm nay", with a count badge). Owner and
admin see the whole business; sales/care see only their own and unassigned customers (same rule
as `contacts.view_all`).

Queues, in this order (each item = customer, channel, one-line reason, time):

| Queue | Source |
|---|---|
| **Phàn nàn / cần người** | signal `mood = complaint` or `needs_human`, not answered by a person since the evaluation ran |
| **Chưa trả lời** | fact: `awaiting_since` older than 15 min (no LLM) |
| **Sắp chốt** | signal `stage = ready` judged within 7 days, no order/booking since |
| **Hỏi giá rồi im** | signal `stage = price_asked`, customer silent between 24 h and 14 days |
| **Đến hạn chăm lại** | signal `follow_up_at ≤ now` or conversation `followUpAt ≤ today` |
| **Việc của tôi** | open tasks due today or overdue |

Item actions: **Mở hội thoại** · **Soạn trả lời** (one LLM call only on click; the draft opens in
the inbox composer, never sent automatically) · **Thêm việc** · **Bỏ qua** (hidden until a new
customer message; needs `contacts.edit`, with an undo on the toast) · **Đánh giá lại** · change
stage (locks it). The sidebar badge reads a counts-only endpoint (`GET /today/counts`).

Header: counts per queue, "Làm mới" with remaining evaluations, and a line when the cap is used
up ("Đã hết lượt đánh giá hôm nay — các mục chỉ dựa trên dữ liệu có sẵn"). "Làm mới" stops
starting evaluations after about 45 s and says how many are left.

Desktop and phone layouts both; empty state per queue.

## 6. Morning briefing and complaint alert

- **Briefing:** each business, at 08:00 local (setting, can be off), owner and admins get one
  notification (in-app + push): "Hôm nay: 3 phàn nàn, 8 sắp chốt, 5 cần chăm lại, 2 việc quá
  hạn" → `/app/today`. Counts only; **no LLM call**. Skipped when everything is zero.
- **Complaint alert:** when an evaluation newly sets `mood = complaint`, notify the owner and the
  conversation's assignee at once (dedup per conversation per day).
- New notification types `today.briefing`, `brain.complaint`, `task.due`.

## 7. Architecture

- New module **`brain`** (tier 3: reads `conversation` and `crm` facades, `AI_LLM_GATEWAY`,
  `BillingFacade`, `NOTIFICATION_FACADE`), created with `pnpm gen module brain`, added to
  `ARCHITECTURE.md §3`. Owns `conversation_signals`, `signal_jobs`, `signal_runs`,
  `signal_usage`, the Today query API and the briefing tick.
- `crm` gains `tasks` (tier unchanged; links stored as ids).
- Migration **0072** (additive, RLS like every tenant table). Data export (SET-10) includes
  signals and tasks; deleting a conversation deletes its signals, while deleting a contact
  only clears the signal's `contact_id` (the signal follows its conversation, which survives a
  contact delete).
- **ADR-030** records: idle-only LLM evaluation with a cap (and why not per turn / not rules),
  signals per conversation (customer-level roll-up later), tasks in crm, autonomy deferred to its
  first consumer.
- Docs: `docs/02` (new BRN ids, CRM-04 partly done), `docs/03` (Today screen), `docs/05`, the
  `brain` and `crm` `MODULE.md`.

## 8. Testing

- Domain: job scheduling/back-off, skip rules, cap reservation and release, stage lock, queue
  membership rules (unit).
- Evaluation with a fake gateway: incremental input built from note + new messages, invalid JSON
  retry, run metering.
- API: role visibility on Today and tasks, manual evaluate under/over cap, tenant isolation (RLS
  test like other tables).
- Web: Today page queues, actions, cap banner, task create/complete; screenshots desktop + phone.
- Measure real token use on dev for ~20 conversations and report it.

## 9. Delivery

One branch, one PR (`feat/business-brain-today`): migration + brain module + tasks + Today +
briefing/alerts + docs + ADR-030. Estimated ~1–1.5 weeks of agent work.
