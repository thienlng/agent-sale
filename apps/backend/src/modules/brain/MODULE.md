# brain

**Purpose:** Business Brain v1 (spec `docs/superpowers/specs/2026-11-11-business-brain-today-design.md`, ADR-030): one AI judgement per conversation (stage, intent, mood, needs-a-person, follow-up, rolling note), evaluated when a conversation goes idle or on request, within a daily cap; the complaint alert.

**Owned tables:** `conversation_signals`, `signal_jobs`, `signal_runs`, `signal_usage`, `brain_settings` (schema `packages/db/src/schema/brain.ts`, migration 0072). Outbox position: row `brain.signals` in `analytics_checkpoints` (the consumer-keyed checkpoint table; 0072 added none for the brain).

**Public API (`api/`):**
- `BRAIN_FACADE` → `signalsFor(ws, convIds)`, `evaluateNow(ws, convId, 'manual'|'refresh')` → `{status: ok|capped|nothing_new|disabled, signal}`, `usage(ws)` → `{day, used, limit}`, `settings(ws)`.
- `BRAIN_RUNNER.tick()` — worker, every 15 s: outbox pass → reset capped jobs whose day came → claim ≤ 5 due jobs (`FOR UPDATE SKIP LOCKED`, 2-minute lease) → evaluate.
- HTTP (`packages/contracts/src/brain/`): `GET|PATCH /conversations/{id}/signals`, `POST /conversations/{id}/signals/evaluate`, `GET|PUT /brain/settings`, `GET /brain/usage`.
- Events: none published.

**Events consumed:** `conversation.message.received.v1` (outbox, transaction horizon like analytics; a fresh install starts at the current horizon). Only customer messages (not `echo`) schedule.

**Uses:** `conversation` (`signalContext`), `crm` (`getContact`), `ai` (`AI_LLM_GATEWAY`, `conversationSummary`), `billing` (`entitlements` → `brain.evaluations.daily`), `notification`, `workspace` (`accountOf`, members), `account` (`listForUser`, ownership).

**Invariants:**
- An LLM call only on idle (no customer message for `idle_minutes`, default 45, 30–120), manual or refresh triggers; never per turn, no keyword rules. Tier `basic`, 600 output tokens, 20 s, one retry on invalid output; prompt `packages/ai-core/prompts/brain-signals@1.md`.
- A customer message upserts the job: `run_after = max(existing, at + idle)`. Skips (job dropped, no call): manual mode, test conversation, not open (resolved/spam), no customer message after `evaluated_until`.
- Cap per business per day (Asia/Ho_Chi_Minh): reserved atomically before the call (`… on conflict do update … where count < limit`), released when the call fails (error/timeout, not an invalid answer). Plan without the key → 200; `null` → unlimited. Capped job waits until the next local midnight, then runs again.
- Each model call writes one `signal_runs` row. Invalid twice → outcome `invalid`, signals unchanged.
- Write rules: `stage_locked` keeps the stored stage; `evaluated_until` = time of the last covered message; `dismissed_until_message_after` cleared only when a newer customer message was covered.
- Complaint alert only on the transition to `mood = complaint`: account owner(s) + assignee, `dedupKey brain.complaint:<conv>:<day>`, in-app + push.

**Do not:** read other modules' tables (the conversation's messages come through `signalContext`); send names, phones or addresses to the model in the fact line; move CRM status from signals (phase 2).

**Test:** `pnpm --filter @agent-sales/backend test -- brain` (+ `test/brain-store.integration.spec.ts` with `test:integration`)
