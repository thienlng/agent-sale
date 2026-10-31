# Agent harness v2 — a Hermes-grade agent loop in the Rapiz core — design

Date: 2026-10-31 · Status: designed with the owner in chat (sections 1–4 approved) · Branch `feat/agent-harness-v2` from `feat/bot-tools-catalog-search` @ a2f5b94 (PR #94)

## 1. Problem and decision

The sales bot feels rigid compared with Hermes, the agent the owner uses daily. In Rapiz, Hermes (`services/hermes`, Python) is only the dev pipe to ChatGPT: every call creates an `AIAgent` with all tools disabled. The agent loop was rebuilt in TypeScript (PR #94) and kept too tight: 4 rounds, tool calls emulated as JSON in the prompt for the Hermes pipe, one JSON envelope per turn (`{outcome, reply, sources, imageIds ≤ 3}`), one retry, history cut at 20 turns, a number guardrail that replaces whole answers with a fallback.

Decisions taken with the owner on 2026-10-31:
- The agent core stays in TypeScript, in the same process as tenant data (Node cannot host Python; a Hermes-side loop would need network tool calls and a second system). We port Hermes' harness techniques instead of embedding Hermes.
- The ChatGPT pipe stays Hermes for development; production will use the OpenAI API. Not re-discussed here.
- Output is free text, as in Hermes. No JSON envelope, no hard caps beyond Meta's own limits. Behaviour is tuned later from real use.
- The number guardrail is removed from the reply path (the owner will revisit "what is a wrong price" later). The grounding module and its tests stay in the repo, unused by the reply path.
- New customer messages during a running turn: **interrupt** (Hermes' default `busy_input_mode`), carrying the interrupted turn's tool work forward.
- Message batching: no extra wait. The worker is woken by Postgres LISTEN/NOTIFY as soon as an event is stored (owner request 2026-10-31), with a slow safety poll; messages already stored when a turn starts are answered together, later ones interrupt.

Reference implementation: `/home/kenknight/Workspace/NetClaw_1.1.0/hermes-agent` (`agent/conversation_loop.py`, `agent/tool_executor.py`, `agent/tool_dispatch_helpers.py`, `agent/iteration_budget.py`, `agent/prompt_caching.py`, `agent/transports/codex.py`, `agent/context_compressor.py`) and booking-agent (`src/booking_agent/runtime/*`, `dispatcher.py`).

## 2. Architecture

```
Customer message → Dispatch (conversation module)
                     woken by LISTEN/NOTIFY (5 s safety poll), claim the conversation, interrupt a running turn on a new message
                   → Context (ai module)
                     fixed system prompt per bot + per-turn data in the last user message + history (compressed)
                   → Agent loop (ai module)
                     ≤ 10 rounds, time budget with wrap-up notice, interrupt check
                       ↔ Model call (packages/ai-core): error classes, retries with backoff, fallback model,
                         per-call timeout/abort, prompt cache key; Hermes pipe with native tool calls
                       ↔ Tools (ai module): repair, parallel read-only, sequential writes, result caps
                   → Delivery (conversation module)
                     final text → splitReply bubbles; send_message calls delivered as they happen
```

Six units, one responsibility each; contracts in section 9.

## 3. Agent loop (ai module, `application/agent-loop.ts`, replaces `tool-loop.ts`)

- **Rounds:** at most 10 per turn (constant `AGENT_MAX_ROUNDS = 10`; per-bot settings are out of scope until experiments ask for them). A round = one model call plus the tools it requested.
- **Time budget:** 120 s per turn (constant `AGENT_BUDGET_MS = 120_000`). When 80 % is spent, the next tool result message gets the notice `[System: time is almost up — answer the customer now with what you have.]` (Hermes' wrap-up). After the budget, no new model call starts; the turn ends with what was already sent (or the fallback message if nothing was).
- **Per-call timeout:** `clamp(remainingBudget / 2, 15 s, 60 s)`, passed as `timeoutMs` plus an `AbortSignal`.
- **After the last round:** one call with `toolChoice: 'none'`; tool calls in that answer → fallback message, reason `tool_loop_limit`.
- **Interrupt:** before every model call and after every tool batch the loop asks `shouldInterrupt()`. True → abort the in-flight call, stop, return `{ interrupted: true, carry }` where `carry` is the loop's follow-up messages (assistant tool calls + tool results). Messages already delivered through `send_message` stay delivered. Dispatch starts a new turn with all customer messages and passes `carry` so earlier lookups are reused (section 7).
- **Stop:** a human takeover or a deactivated bot also interrupts, but no new turn starts.
- **Events:** the loop emits steps `{kind: 'model_call'|'tool'|'wrap_up'|'interrupted'|'retry'|'limit', name?, ok?, ms}` for the test chat (section 8). Never shown to customers.

## 4. Tools (ai module)

Tool set per bot (as in PR #94 plus two):

| Tool | Read-only | Notes |
|---|---|---|
| `search_products`, `product_details` | yes | unchanged from PR #94 |
| `send_message({ text?: string, imageIds?: string[] })` | no | at least one of the two; text ≤ 2 000 chars; `imageIds` ≤ 3, ids from product details / image lists returned earlier in the turn or focus products; unknown ids are dropped and reported in the result. Delivered immediately (section 7). Result `{"status":"sent","delivered":n}` or `{"error":…}` |
| `handoff({ reason: string })` | no | marks the conversation for staff (same effect as today's handoff outcome); the loop ends after the current batch; the shop's hand-over message is sent as today |
| `action_n`, `confirm_pending_action`, `cancel_pending_action` | no | unchanged rules from PR #94 (never confirm a call stored in the same turn; comment replies have no confirmation) |

Execution (from Hermes `tool_executor` / `conversation_loop`):
- **Name repair:** exact → case-insensitive → `-`/space ↔ `_` → unique Levenshtein ≤ 2 match among the turn's tools. Otherwise `{"error":"unknown_tool","available":[…]}`.
- **Argument repair:** strip code fences; fix trailing commas, single quotes, unquoted keys; `__invalidJson` input after repair → `{"error":"invalid_arguments","detail":…}` (Zod message only, never values).
- **Mixed batches:** invalid calls get error results, valid calls run. Three consecutive batches with only invalid calls → stop with fallback, reason `invalid_tools`.
- **Concurrency:** read-only calls of a batch run in parallel (max 8); write calls run sequentially in the order requested, after the read-only ones; results are returned in call order.
- **Result cap:** tool result content is cut at 12 000 chars with the suffix `…[truncated]`.
- **Errors:** an executor throw → `{"error":"tool_failed"}` to the model; the log line has the tool name and error class only (rule 07).

## 5. Model call (packages/ai-core)

- **Hermes pipe with native tools:** bridge contract v2 — `POST /v1/generate` accepts `tools: [{name, description, parameters}]`, `toolChoice`, assistant messages with `toolCalls`, `tool` messages; returns `toolCalls: [{id, name, arguments}]`, `stopReason`. The bridge calls the ChatGPT/Codex Responses transport with function tools and never executes tools. If the transport cannot carry native tools, the bridge reports `nativeTools: false` on `/health`, and the backend keeps the existing `EmulatedToolsProvider` for Hermes (acceptable fallback; reason recorded in the PR).
- **Error classes:** `rate_limit`, `overloaded`, `timeout`, `network`, `context_too_long`, `auth`, `invalid_request`, `content_filter`, `aborted`, `unknown` — `classifyLlmError(e)`, `LlmCallError.kind`.
- **Retries:** retryable = `rate_limit`, `overloaded`, `timeout`, `network`, `unknown` with HTTP 5xx; up to 3 retries, jittered exponential backoff (base 1 s, ×2, cap 15 s, full jitter), `Retry-After` honoured (capped at the remaining budget). Empty or unparseable model output gets one retry. Not retried: `auth`, `invalid_request`, `content_filter`, `context_too_long`, `aborted`.
- **Fallback model:** the tier's configured fallback (already in `LlmGateway`) after retries are exhausted. Not configured by default.
- **Timeout/abort:** `GenerateRequest.timeoutMs` and `signal` honoured by every provider.
- **Prompt caching:** `GenerateRequest.promptCacheKey = ${botId}:${conversationKey}`. OpenAI-compatible sends `prompt_cache_key`; Hermes passes it to the Codex transport as `prompt_cache_key` when the transport accepts it; Anthropic sets `cache_control: {type:'ephemeral'}` on the last system block and the last two user/tool messages (≤ 4 breakpoints).

## 6. Context and compression (ai module)

- **Stable system prompt:** per bot, byte-identical across turns: identity, pronouns, style, rules, tool guidance (prompt `sales-agent@13` retail, `@14` hotel = `@13` + the lodging section of `@12`). Everything that changes per turn — business profile, matched FAQs, situations, focus products, pending action, the current date/time — goes into the last user message.
- **Prompt @13 content:** look up before answering; never promise to check later; one idea per line; may use `send_message` to send pictures (≤ 3 per call, several calls allowed) or a message while still working; customer pronoun rule from @11; never mention data, tools, systems, the app; orders: collect details then `handoff`; no JSON envelope.
- **Compression** (`application/context-compression.ts`, `application/history-summarizer.ts`): when history exceeds 24 000 chars, keep the last 12 turns verbatim and replace older turns with `<earlier_conversation_summary>…</earlier_conversation_summary>` in one user message. The summary is produced by the bot's tier with a fixed prompt (keep products discussed, quantities, names, phone numbers, addresses, decisions; Vietnamese) and stored per conversation in a new table `conversation_summaries (workspace_id, conversation_id, covered_until timestamptz, summary text, updated_at)` (ai module, forced RLS, additive migration). Later turns summarise only the turns newer than `covered_until` that fall out of the window, merged with the stored summary.

## 7. Dispatch and delivery (conversation module)

- **Wake-up (LISTEN/NOTIFY):** an additive migration adds an `AFTER INSERT` trigger on `channel_webhook_events` (and on the fanpage comment ingress table if it has its own queue) that runs `pg_notify('rapiz_ingress', NEW.id::text)`; the notification is delivered on commit, whoever inserts. The agent entry (`apps/backend/src/entries/agent.ts`) keeps one dedicated listening connection (postgres.js `sql.listen('rapiz_ingress', …)`) and runs `tick()` immediately on a notification (coalesced: one tick in flight, one queued). The interval poll becomes a safety net every 5 000 ms (`INGRESS_SAFETY_POLL_MS`); while the listener is down (connection lost) the poll falls back to 300 ms and the listener reconnects with backoff (1 s → 30 s). Payload is only the row id (no tenant data in notifications).
- **Batching:** no extra wait; customer messages already stored when a turn starts are answered together.
- **Interrupt:** the turn's `shouldInterrupt()` = a newer customer message arrived in this conversation (or takeover/bot off). On interrupt, the processor re-runs immediately with all customer messages and the `carry` messages; at most 3 re-runs per burst, then the turn runs to completion.
- **`send_message` delivery:** synchronous from the tool executor through the existing reserve → deliver → record path (idempotency key `bot:<event>:s<n>` / `:s<n>:img`); text → `splitReply` bubbles; images → album with the existing retry and fall-back-to-single-pictures logic; 800 ms between sends. A takeover stops further sends.
- **Final text:** after the loop, the final answer text (if non-empty) is cut by `splitReply` (unchanged rules, ≤ 4 bubbles) and sent like today (keys `bot:<event>`, `:t2`…). Empty final text with ≥ 1 `send_message` is fine. Nothing sent at all → the fallback message.
- **Outcome:** `handoff` if the handoff tool ran; `answered` if anything was sent; otherwise `fallback`.
- **Comment replies** (fanpage): same loop; `send_message` is not offered (one public reply per comment); final text is the reply.

## 8. Response shape and test chat

`PlaygroundResponse` / `AiFacade.reply` adds (old fields kept: `reply` = all sent texts joined by `\n`, `images` = all sent images):
```ts
messages: { text: string; images: { id: string; url: string; label: string }[]; via: 'send_message'|'final' }[];
steps: { kind: string; name?: string; ok?: boolean; ms?: number }[];
interrupted?: boolean;
```
In the playground (no channel), `send_message` calls are collected instead of delivered. The test chat renders each message as Messenger would (bubbles via `splitReply`, album under its message) and a collapsed "Các bước bot đã làm" list from `steps`.

## 9. Contracts between units

- **C1 ai-core:** `GenerateRequest.promptCacheKey?`, `timeoutMs?`, `signal?`; `classifyLlmError`, `LlmCallError`, `LlmErrorKind`; gateway retries/fallback (section 5).
- **C2 Hermes bridge v2:** request/response fields of section 5; `/health` → `{ nativeTools: boolean }`.
- **C3 Agent loop:** `runAgentLoop({ base, tools: {name, readOnly}[], generate, execute, shouldInterrupt?, carry?, maxRounds?, budgetMs?, onStep?, now? })` → `{ res, followUps, trusted, productIds, modelCalls, outcome: 'done'|'interrupted'|'limit'|'invalid_tools'|'budget', steps }`.
- **C4 Output:** `send_message`/`handoff` executors receive a `MessageSink { send(msg: {text?, images[]}): Promise<{ delivered: number }> }` injected by the caller (Meta processor → deliver; playground → collect); `AiFacade.reply(ws, botId, input, { conversationId, isTest, sink?, shouldInterrupt?, carry? })`.
- **C5 Compression:** `compressHistory(turns, { maxChars, keepLast, summarize, stored? })`; storage port `ConversationSummaryRepository { get(ws, conversationId); put(ws, conversationId, { coveredUntil, summary }) }`.
- **C6 Dispatch:** channel `rapiz_ingress`, safety poll 5 000 ms (300 ms while the listener is down), interrupt re-run limit 3, `bot:<event>:s<n>` keys.

## 10. Removed

JSON reply envelope and `responseFormat` on the reply path; `FinalReply`/`ModelReply` parsing, format retry and prose salvage on the reply path; the 4-round loop; the 3-images-per-turn cap; the number guardrail on the reply path (module kept, unused).

## 11. Testing and acceptance

- Unit tests per unit: name/argument repair, mixed batches and the 3-strike stop, parallel read-only vs sequential writes and result order, result cap, wrap-up notice at 80 %, per-call timeout, interrupt with carry, error classification and retry/backoff (fake timers), `Retry-After`, fallback model, prompt cache key per provider, compression thresholds and incremental summary, `send_message` delivery and idempotency keys, takeover stops sends, NOTIFY wake-up (integration test: insert → tick within 500 ms) and listener-down fallback poll.
- Bridge: Python tests for the v2 contract (fake transport), plus one live probe recorded in the PR.
- Evals (`pnpm --filter @agent-sales/backend eval --live`, gpt-6.1-sol): the existing suite adapted to free text (checks on delivered messages, not an envelope) plus new cases: several products presented each with its own pictures; "ktra xong chưa" never answered with a promise to check; a customer message arriving mid-turn (interrupt) gets an answer covering both messages; a long conversation compresses and still remembers the phone number given early.
- Acceptance QA: an agent drives the playground HTTP API through scripted TinyMind and Villas conversations and reports PASS/FAIL per scenario with transcripts. No Messenger sends.
- `pnpm check` green.

## 12. Out of scope

Embeddings; a create-order tool; replacing the ChatGPT pipe; per-shop rate limits; analytics on `messaging_seen`; moving the ingress queue to Redis/BullMQ.
