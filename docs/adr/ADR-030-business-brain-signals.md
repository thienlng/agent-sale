# ADR-030: Business Brain signals: idle-only LLM evaluation under a daily cap, per conversation; tasks in crm

- Status: Proposed
- Date: 2026-11-11
- Decision makers: thienlng (owner decisions in chat, 2026-11-11; spec
  [Business Brain v1 and Today](../superpowers/specs/2026-11-11-business-brain-today-design.md))

## Context

The owner wants one screen to open every morning, **Hôm nay** (`/app/today`): what needs doing
today across every conversation of the business, and why. That needs two primitives Rapiz did not
have: a judgement of each conversation (stage, intent, mood, whether a person is needed, when to
follow up) and one object for "something someone must do" (CRM-04 tasks).

A judgement of a conversation needs a language model; plain facts (waiting since, who spoke last,
has an order, follow-up date) are already in the database. The model call costs tokens on every
business, including free ones, so the owner set the cost as a hard constraint: bounded, visible,
and switchable to "only when I click". Phase 2 of the roadmap (autonomy levels, the follow-up
agent acting on its own) builds on the same primitives but is not designed yet.

## Decision

1. **Signals come only from an LLM evaluation run when a conversation goes idle, under a daily
   cap.** A new tier-3 module `brain` consumes `conversation.message.received.v1` from the outbox
   (own checkpoint, like analytics). A customer message upserts one `signal_jobs` row per
   conversation with `run_after = max(existing, at + idle)` (default 45 min, settable 30–120);
   bot and staff messages do not schedule. A worker tick claims due jobs and makes **one** call
   on the `basic` tier (JSON output, `maxOutputTokens` 600, 20 s timeout, one retry on invalid
   JSON) whose input is incremental: the previous rolling `note` (or the stored conversation
   summary on a first run), the messages after `evaluated_until` (≤ 40 / 8 000 chars) and one
   fact line. Every call writes a `signal_runs` row (tokens, tier, model, outcome, trigger).
   - **Cap:** entitlement `brain.evaluations.daily` per business per day in Asia/Ho_Chi_Minh
     (200 on every plan, `null` = unlimited for internal shops), reserved atomically in
     `signal_usage` before the call and released on failure. A capped job is kept as `capped`
     and becomes `pending` again the next day, a few minutes after local midnight (behind the
     day's fresh jobs); one whose customer last wrote more than a day ago is then dropped.
     **Deviation from the billing pattern:** the limit is read from `BillingFacade.entitlements`
     instead of `BillingFacade.limit`, because `limit` reads a key the plan does not define as 0
     and plans created before this key exist; a plan without the key gets the default (200), a
     key set to `null` means unlimited. Adding the key to every plan row makes the fallback
     unused but it stays as the safe default.
   - **Manual controls:** `POST /conversations/{id}/signals/evaluate` (**Đánh giá lại**) and
     `POST /today/refresh` (**Làm mới**, ≤ 20 conversations with unevaluated customer messages,
     highest priority first) run now and count toward the cap. In **manual mode**
     (`brain_settings.mode = 'manual'`, "Chỉ khi tôi bấm") idle jobs are dropped and only these
     buttons evaluate.
   - A member's manual stage change sets `stage_locked`; later evaluations keep the stored stage.
   - Never on test/playground conversations; reply drafts (`POST /conversations/{id}/reply-draft`)
     are one call on click, count toward the cap and are never sent automatically.
2. **Signals are stored per conversation.** `conversation_signals` has one row per conversation
   (PK `(workspace_id, conversation_id)`), with the customer as a nullable link. Many
   conversations have no customer (a visitor who never left a phone, a comment thread), and the
   Today queues act on a conversation (open it, draft a reply). A customer-level roll-up across
   their conversations is a later read model, not a second source of truth. Deleting a
   conversation deletes its signals; deleting a customer only clears the link.
3. **Tasks are owned by `crm`.** `tasks` (CRM-04) belongs to the customer domain as `docs/04` and
   `docs/05` already planned: links to a customer (same-workspace key, a deleted customer deletes
   its tasks), a conversation and an opaque subject (`subject_type` + `subject_id`, e.g. an order
   or booking) are ids only, so `crm` does not depend on commerce or lodging. `brain` reads tasks
   through `CRM_FACADE` for the Today queue and the briefing. A due reminder (`task.due`, once per
   task) runs on a worker tick; reminder offsets (SET-05) come later.
4. **Autonomy is deferred to its first consumer.** v1 only observes and suggests: signals do not
   change CRM status, no message is sent, no task is done by the AI. `tasks.assignee_kind`
   (`member` | `ai`) exists so phase 2 does not need a migration, but `ai` is unused. Autonomy
   levels are designed with the follow-up agent in phase 2, against a real action.
5. **No new queue infrastructure.** Jobs are Postgres rows leased with `FOR UPDATE SKIP LOCKED`
   and a 2-minute lease, driven by worker ticks (15 s), the pattern `assistant_jobs` and the data
   export already use; no BullMQ queue. The morning briefing (counts only, no LLM call, skipped at
   zero) and the complaint alert (on a transition to `mood = complaint`, deduplicated per
   conversation per day) are notifications (`today.briefing`, `brain.complaint`).

## Consequences

- Token spend per business is bounded by the cap and visible (Settings shows "Đã dùng 37/200";
  Today shows the remaining evaluations and a banner when they run out). Expected size, to be
  measured on dev: 1–2 k input and 150–300 output tokens per evaluation.
- Signals lag a conversation by the idle wait (≥ 30 min). The **Chưa trả lời** queue is a plain
  fact (`awaiting_since` > 15 min) so urgent unanswered messages never wait for an evaluation.
- When the cap is used up, Today still works from facts and older signals.
- Six new tenant tables with forced RLS (migration 0073, additive). The data export (SET-10)
  includes `tasks.csv` (crm) and `conversation_signals.csv` (brain); the operational tables
  (`signal_jobs`, `signal_runs`, `signal_usage`, `brain_settings`) are not exported, like
  `ai_runs` and the analytics projections. `exportTable()` gains a `key` option because
  `conversation_signals` has no `id` column.
- `ai_runs` stays bot-only; brain cost reporting reads `signal_runs`.
- The conversation's own `followUpAt` stays and feeds the follow-up queue; merging it into tasks is
  a later clean-up.

## Alternatives considered

- **Evaluate on every turn (piggyback on the bot's reply).** Rejected: it spends tokens on every
  message of every conversation, most of them mid-conversation where the judgement changes again
  a minute later, and it only covers conversations the bot answers (not staff-only or bot-off
  conversations). Evaluating once the conversation settles gives the same answer at a fraction of
  the cost.
- **Keyword or rule-based signals** ("giá", "bao nhiêu" → price asked). Rejected by the owner:
  Vietnamese chat is too varied for rules to be trusted, and wrong labels on the Today screen cost
  more trust than they save tokens. Facts that really are data are read directly instead.
- **Signals per customer.** Rejected for v1: many conversations have no customer, and a customer
  with several conversations would need a merge rule before there is a consumer for it.
- **Tasks in `brain` or a new `task` module.** Rejected: tasks are CRM-04, linked to customers,
  and the assistant and the inbox already reach crm; a separate module adds a boundary without a
  separate owner.
- **A BullMQ delayed job per message.** Rejected: one row per conversation whose `run_after`
  moves is simpler to reschedule, cap and inspect than delayed jobs to cancel and re-add, and the
  existing lease pattern already runs in the worker.
