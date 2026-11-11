# brain

**Purpose:** Business Brain v1 (spec `docs/superpowers/specs/2026-11-11-business-brain-today-design.md`, ADR-030): one AI judgement per conversation (stage, intent, mood, needs-a-person, follow-up, rolling note), evaluated when a conversation goes idle or on request, within a daily cap; the complaint alert.

**Owned tables:** `conversation_signals`, `signal_jobs`, `signal_runs`, `signal_usage`, `brain_settings` (schema `packages/db/src/schema/brain.ts`, migration 0072). Outbox position: row `brain.signals` in `analytics_checkpoints` (the consumer-keyed checkpoint table; 0072 added none for the brain).

**Public API (`api/`):**
- `BRAIN_FACADE` → `signalsFor(ws, convIds)`, `evaluateNow(ws, convId, 'manual'|'refresh')` → `{status: ok|capped|nothing_new|disabled, signal}`, `usage(ws)` → `{day, used, limit}`, `settings(ws)`.
- `BRAIN_RUNNER.tick()` — worker, every 15 s: outbox pass → reset capped jobs whose day came → claim ≤ 5 due jobs (`FOR UPDATE SKIP LOCKED`, 2-minute lease) → evaluate.
- `BRAIN_RUNNER.tick()` also runs the morning briefing pass at most once a minute.
- `BRAIN_EXPORT` — `conversation_signals.csv` of the workspace data export (SET-10), keyed by `conversation_id`.
- HTTP (`packages/contracts/src/brain/`): `GET|PATCH /conversations/{id}/signals`, `POST /conversations/{id}/signals/evaluate`, `GET|PUT /brain/settings`, `GET /brain/usage`, `GET /today`, `POST /today/refresh`, `POST /today/items/{conversationId}/dismiss`, `POST /conversations/{id}/reply-draft`.

**Today (spec §5, `application/today.query.ts`, rules in `domain/today.ts`):** candidates = signals flagged for Today (`todaySignals`) + `ConversationFacade.todayCandidates` (waiting ≥ 15 min, reminder due by the end of the local day). Queues in order, first match only: `attention` (complaint or needs a person, open, no staff message after `evaluated_until`), `unanswered` (open, waiting ≥ 15 min), `ready`, `price_silent` (`price_asked`, last customer message ≥ 24 h ago), `follow_up` (signal follow-up ≤ now or conversation reminder before the local midnight), `tasks` (`CRM_FACADE` open tasks due before the local midnight, mine + unassigned for every role). Spam is never listed. Without `contacts.view_all` only conversations assigned to the viewer or unassigned. ≤ 20 items per queue, `count` is the full number. Dismiss writes `dismissed_until_message_after = now` (a blank signal row when none exists); the item is hidden while `lastInboundAt ≤` it. Refresh: Today's conversations in queue order, then those with a pending idle job, whose last customer message is after `evaluated_until`; ≤ 20 per call, 3 at a time, stops at the cap.

**Reply draft (`application/reply-draft.service.ts`):** one tier-`basic` call (prompt `brain-reply-draft@1`, 600 tokens, 20 s) from the signal note, the last 20 messages and the persona of the conversation's bot (pronouns, tone, length, emoji, language; no free text of the bot). Reserves one evaluation of the day (released when the call fails), records a `signal_runs` row (trigger `manual`); never sends. `RATE_LIMITED` when the cap is used up.

**Morning briefing (`application/briefing.ts`):** once a minute from the tick; for each active business (`WorkspaceFacade.listActiveIds`) with the briefing on and the local hour equal to `briefing_hour` (default 8), `claimBriefing` sets `last_briefing_day` atomically (insert-or-update where older), then each active owner/admin gets `today.briefing` (in-app + push, `/app/today`, title from `notification` i18n `today.briefing.*`, non-zero counts only) unless all their counts are zero. No model call.
- Events: none published.

**Events consumed:** `conversation.message.received.v1` (outbox, transaction horizon like analytics; a fresh install starts at the current horizon). Only customer messages (not `echo`) schedule.

**Uses:** `conversation` (`signalContext`, `todayCandidates`, `get`), `crm` (`getContact`, `countOpenTasks`, `listOpenTasks`), `ai` (`AI_LLM_GATEWAY`, `conversationSummary`), `bot` (`getBot`, persona of a reply draft), `billing` (`entitlements` → `brain.evaluations.daily`), `notification`, `workspace` (`accountOf`, members, `listActiveIds`), `account` (`listForUser`, ownership), `identity` (`displayName` of assignees).

**Invariants:**
- An LLM call only on idle (no customer message for `idle_minutes`, default 45, 30–120), manual or refresh triggers; never per turn, no keyword rules. Tier `basic`, 600 output tokens, 20 s, one retry on invalid output; prompt `packages/ai-core/prompts/brain-signals@1.md`.
- A customer message upserts the job: `run_after = max(existing, at + idle)`. Skips (job dropped, no call): manual mode, test conversation, not open (resolved/spam), no customer message after `evaluated_until`.
- Cap per business per day (Asia/Ho_Chi_Minh): reserved atomically before the call (`… on conflict do update … where count < limit`), released when the call fails (error/timeout, not an invalid answer). Plan without the key → 200; `null` → unlimited. Capped job waits until the next local midnight, then runs again.
- Each model call writes one `signal_runs` row. Invalid twice → outcome `invalid`, signals unchanged.
- Write rules: `stage_locked` keeps the stored stage; `evaluated_until` = time of the last covered message; `dismissed_until_message_after` cleared only when a newer customer message was covered.
- Complaint alert only on the transition to `mood = complaint`: account owner(s) + assignee, `dedupKey brain.complaint:<conv>:<day>`, in-app + push.

**Do not:** read other modules' tables (the conversation's messages come through `signalContext`); send names, phones or addresses to the model in the fact line; move CRM status from signals (phase 2).

**Test:** `pnpm --filter @agent-sales/backend test -- brain` (+ `test/brain-store.integration.spec.ts` with `test:integration`)
