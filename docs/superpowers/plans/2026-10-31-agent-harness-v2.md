# Agent Harness v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the rigid reply pipeline with a Hermes-grade agent loop in the Rapiz TypeScript core: free-text answers, optional `send_message`/`handoff` tools, 10 rounds with a time budget, tool-call repair and parallel reads, classified retries, prompt caching, history compression, interrupt on new customer messages, and LISTEN/NOTIFY wake-up.

**Architecture:** Units with fixed contracts (spec §9): ai-core (model call robustness + Hermes native tools), ai module (agent loop, tool runner, output tools, context/compression, prompts), conversation module (interrupt, sink delivery), entries/db (NOTIFY wake-up), web (test chat). Wave 1 builds independent units in parallel worktrees; wave 2 integrates the reply path, the conversation processor and the web in parallel against Task 0's contracts; wave 3 adapts evals and docs; the controller runs the gate, live evals and acceptance QA.

**Tech Stack:** TypeScript (NestJS, Fastify, Vitest, Testcontainers), postgres.js, Drizzle, Zod 4, Python 3.11+ (Hermes bridge, unittest), React (TanStack Query).

**Spec:** `docs/superpowers/specs/2026-10-31-agent-harness-v2-design.md` — the authority; section numbers (§n) refer to it. Hermes reference code: `/home/kenknight/Workspace/NetClaw_1.1.0/hermes-agent` (read only, never modify).

## Global Constraints

- Each task works in its own git worktree given by the controller, branched from `feat/agent-harness-v2`; touch only the files your task lists. Never push, never merge, never modify `/home/kenknight/Workspace/NetClaw_1.1.0/**`.
- Rules: `AGENTS.md`, `.agents/rules/*.md`, `docs/ARCHITECTURE.md` (modules talk through `api/` facades; shared infra in `apps/backend/src/common`; LLM calls only through `packages/ai-core`). English in code/docs; Vietnamese only in prompts' example phrases and `packages/i18n` vi files.
- Conventional Commits with valid scopes (`ai`, `ai-core`, `conversation`, `db`, `backend`, `web`, `docs`, `repo`); every commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; never `--no-verify`; stage only your own files. Never delete or skip a test to go green — replace it with an equivalent of the new behaviour.
- No sends to Messenger, ever (the TinyMind Page was restricted for bursts). No `--live` evals by implementers.
- Logs: tool name and error class only — never arguments, customer text, tokens or URLs with secrets.
- Constants (verbatim from the spec): `AGENT_MAX_ROUNDS = 10`; `AGENT_BUDGET_MS = 120_000`; wrap-up at 80 % of the budget with the text `[System: time is almost up — answer the customer now with what you have.]`; per-call timeout `clamp(remaining / 2, 15_000, 60_000)`; max 8 parallel read-only tools; tool result cap 12 000 chars with suffix `…[truncated]`; 3 consecutive invalid-only batches stop the turn; retries: up to 3, jittered exponential backoff base 1 000 ms ×2 cap 15 000 ms, `Retry-After` honoured; `send_message` text ≤ 2 000 chars, `imageIds` ≤ 3; 800 ms between sends; interrupt re-run limit 3; compression at 24 000 chars keeping the last 12 turns; NOTIFY channel `rapiz_ingress`; safety poll 5 000 ms (300 ms while the listener is down); listener reconnect backoff 1 000 → 30 000 ms.
- Build changed packages before dependents: `pnpm --filter @agent-sales/contracts build`, `pnpm --filter @agent-sales/ai-core build`, `pnpm --filter @agent-sales/shared build`, `pnpm --filter @agent-sales/db build`.
- Do not run `pnpm check` (the controller runs the gate). Run the focused commands your task lists. On the loaded host, rerun a web test file that times out at 5 s with `--testTimeout=30000` and say so.

---

## Wave 0 — contracts (sequential, first)

### Task 0: Shared contracts

**Files:**
- Modify: `packages/ai-core/src/gateway.ts` (types only)
- Modify: `packages/contracts/src/ai/*.ts` (the file defining `PlaygroundResponse`)
- Create: `apps/backend/src/modules/ai/api/reply-options.ts` and export it from `apps/backend/src/modules/ai/api/index.ts`
- Test: `packages/contracts` existing tests must stay green; add one schema test for the new response fields.

**Produces (exact):**
```ts
// packages/ai-core/src/gateway.ts — additions
export interface GenerateRequest { /* existing… */ promptCacheKey?: string; timeoutMs?: number; signal?: AbortSignal }
export type LlmErrorKind = 'rate_limit' | 'overloaded' | 'timeout' | 'network' | 'context_too_long'
  | 'auth' | 'invalid_request' | 'content_filter' | 'aborted' | 'unknown';
export class LlmCallError extends Error {
  constructor(readonly kind: LlmErrorKind, message: string, readonly retryAfterMs?: number, readonly status?: number) { super(message); }
}
// packages/contracts — PlaygroundResponse gains (optional for backward compatibility):
messages?: { text: string; images: { id: string; url: string; label: string }[]; via: 'send_message' | 'final' }[];
steps?: { kind: string; name?: string; ok?: boolean; ms?: number }[];
interrupted?: boolean;
// apps/backend/src/modules/ai/api/reply-options.ts
export interface OutgoingMessage { text?: string; images: { id: string; url: string; label: string }[] }
export interface MessageSink { send(message: OutgoingMessage): Promise<{ delivered: number }> }
export interface ReplyOptions {
  conversationId: string | null; isTest: boolean;
  sink?: MessageSink;                         // absent → messages are collected (playground)
  shouldInterrupt?: () => Promise<boolean>;    // checked by the agent loop
  carry?: import('@agent-sales/ai-core').ChatMessage[]; // follow-ups of an interrupted turn
}
/** What AiFacade.reply returns: the public DTO plus, on interrupt, the loop's follow-up messages to carry into the re-run. */
export type ReplyResult = import('@agent-sales/contracts').PlaygroundResponse & { carry?: import('@agent-sales/ai-core').ChatMessage[] };
```
`AiFacade.reply`'s options parameter type becomes `ReplyOptions` and its return type `Promise<ReplyResult>` (existing callers pass `{ conversationId, isTest }` and read DTO fields, which still type-checks).

- [ ] Step 1: add the types; add a contracts test that `PlaygroundResponse.parse` accepts a response with `messages`, `steps`, `interrupted` and one without them.
- [ ] Step 2: build contracts + ai-core; `cd apps/backend && npx tsc --noEmit -p .`; `cd apps/web && npx tsc --noEmit -p .`.
- [ ] Step 3: commit `feat(ai): add harness v2 contracts`.

---

## Wave 1 — independent units (parallel worktrees, after Task 0)

### Task 1: Hermes bridge with native tool calls (§5)

**Files:** `services/hermes/runtime.py`, `services/hermes/bridge.py`, `services/hermes/test_bridge.py`, `services/hermes/README.md`, `packages/ai-core/src/providers/hermes.ts` (+ `hermes.test.ts`), `apps/backend/src/modules/ai/infrastructure/llm/sdk-provider-factory.ts`.

**Interfaces:** Consumes Task 0 `GenerateRequest` (`tools`, `toolChoice`, `promptCacheKey`, `timeoutMs`, `signal`). Produces bridge contract v2 (§5) and `HermesProvider` returning native `toolCalls`.

- [ ] Step 1: read `hermes-agent/agent/transports/codex.py` and how `AIAgent` builds a Responses request with tools (`run_agent.py`, `agent/conversation_loop.py`); decide how to issue ONE model call with function tools without running Hermes' loop (e.g. the transport/client call the agent uses, with `tools` and `tool_choice`, returning the raw output items). Write the finding in the report.
- [ ] Step 2: Python tests first (`test_bridge.py`, fake transport): request with `tools` → transport receives function tools in Responses format; output `function_call` items → response `toolCalls: [{id, name, arguments}]`, `stopReason: 'tool_use'`; history with assistant `toolCalls` and `tool` results → `function_call` / `function_call_output` items; `prompt_cache_key` forwarded when given; `/health` → `{"nativeTools": true}`; the bridge never executes a tool.
- [ ] Step 3: implement; run `cd services/hermes && /home/kenknight/Workspace/NetClaw_1.1.0/booking-agent/.venv/bin/python -m unittest -v`.
- [ ] Step 4: TS tests (`hermes.test.ts`, fake fetch): tools/toolChoice/promptCacheKey/timeout forwarded; `toolCalls` parsed (arguments JSON-parsed, unparseable → `{ __invalidJson: true }` via the shared constant); signal aborts the fetch.
- [ ] Step 5: factory: wrap Hermes in `EmulatedToolsProvider` only when the bridge `/health` says `nativeTools !== true` (check once at provider creation with a 2 s timeout; on failure assume emulated). Test both branches.
- [ ] Step 6: one LIVE probe of the dev bridge (`127.0.0.1:8788`, key from env, model `gpt-6.1-sol`) with a single tool `get_time` and the prompt "What time is it? Use the tool." — record whether a native `toolCalls` came back. Do NOT send anything to Meta. If native tools cannot work, keep emulation, report why, and still commit the parts that work (bridge v2 passes through without tools).
- [ ] Step 7: commits `feat(ai-core): call ChatGPT with native tools through the Hermes bridge` (split Python / TS if cleaner).

### Task 2: Model-call robustness in ai-core (§5)

**Files:** `packages/ai-core/src/gateway.ts` (logic, not Task 0's types), create `packages/ai-core/src/llm-errors.ts`, `packages/ai-core/src/retry.ts`, modify `packages/ai-core/src/providers/openai-compatible.ts`, `anthropic.ts` (+ tests). Not `hermes.ts`, not `emulated-tools.ts`.

**Produces:** `classifyLlmError(e: unknown): LlmErrorKind`; gateway `generate` with retries/backoff/fallback; providers honour `timeoutMs`/`signal` and `promptCacheKey`.

- [ ] Step 1: tests for `classifyLlmError`: HTTP 429 → `rate_limit` (with `retry-after` seconds → `retryAfterMs`); 500/502/503/529 → `overloaded`; `AbortError` from a signal → `aborted`; timeout error → `timeout`; `ECONNRESET`/`fetch failed` → `network`; 401/403 → `auth`; 400 with "context length"/"maximum context" → `context_too_long`; other 400/404/422 → `invalid_request`; content-filter/refusal → `content_filter`; anything else → `unknown`. Also a `LlmCallError` passes its kind through.
- [ ] Step 2: tests for the gateway (fake providers, fake timers): retries `rate_limit`/`overloaded`/`timeout`/`network`/`unknown` up to 3 times with delays drawn from full jitter on `min(15_000, 1_000 × 2^n)` (inject `random`); honours `retryAfterMs` (capped by the request's `timeoutMs` if set); never retries `auth`/`invalid_request`/`content_filter`/`context_too_long`/`aborted`; after retries the tier fallback is tried once; `hooks.record` called once per successful response; an empty text with no tool calls is retried once.
- [ ] Step 3: provider tests: OpenAI-compatible sends `prompt_cache_key` when `promptCacheKey` is set and passes `signal`/`timeout` to the SDK call; Anthropic adds `cache_control: { type: 'ephemeral' }` to the last system block and the last two user/tool messages (≤ 4 breakpoints total) and passes `signal`/`timeout`.
- [ ] Step 4: implement; `pnpm --filter @agent-sales/ai-core exec vitest run` + `tsc --noEmit`; build ai-core; `cd apps/backend && npx vitest run src/modules/ai` (must stay green).
- [ ] Step 5: commit `feat(ai-core): classify model errors, retry with backoff and cache prompts`.

### Task 3: Agent loop and tool runner (§3, §4)

**Files:** create `apps/backend/src/modules/ai/application/agent-loop.ts`, `tool-runner.ts`, `domain/tool-repair.ts`; tests `__tests__/agent-loop.spec.ts`, `tool-runner.spec.ts`, `tool-repair.spec.ts`. Do not modify `playground.service.ts` or delete `tool-loop.ts` (Task 6 does).

**Produces (exact):**
```ts
// domain/tool-repair.ts
export function repairToolName(name: string, known: readonly string[]): string | null;
export function repairArguments(input: unknown): { ok: true; value: unknown } | { ok: false; detail: string };
// application/tool-runner.ts
export interface RunnableTool { name: string; readOnly: boolean; schema: import('zod').ZodType;
  run(input: unknown): Promise<{ content: string; trusted?: string; productIds?: string[] }> }
export async function runToolBatch(calls: ToolCall[], tools: readonly RunnableTool[],
  opts: { onError?(name: string, e: unknown): void; maxParallel?: number; maxResultChars?: number })
  : Promise<{ results: { call: ToolCall; content: string; ok: boolean }[]; trusted: string[]; productIds: string[]; allInvalid: boolean }>;
// application/agent-loop.ts
export const AGENT_MAX_ROUNDS = 10; export const AGENT_BUDGET_MS = 120_000;
export const WRAP_UP_NOTICE = '[System: time is almost up — answer the customer now with what you have.]';
export interface AgentStep { kind: 'model_call'|'tool'|'wrap_up'|'interrupted'|'limit'|'invalid_tools'|'budget'; name?: string; ok?: boolean; ms?: number }
export async function runAgentLoop(input: {
  base: GenerateRequest; tools: readonly RunnableTool[];
  generate(req: GenerateRequest): Promise<GenerateResponse>;
  shouldInterrupt?: () => Promise<boolean>; carry?: ChatMessage[];
  isTerminal?(call: ToolCall): boolean;          // e.g. handoff: finish after this batch
  maxRounds?: number; budgetMs?: number; now?: () => number; onStep?(s: AgentStep): void; onToolError?(name: string, e: unknown): void;
}): Promise<{ res: GenerateResponse | null; followUps: ChatMessage[]; trusted: string[]; productIds: string[];
  modelCalls: number; outcome: 'done'|'interrupted'|'limit'|'invalid_tools'|'budget'; steps: AgentStep[] }>;
```
Behaviour exactly per spec §3–§4: name repair order (exact → case-insensitive → `-`/space↔`_` → unique Levenshtein ≤ 2); argument repair (code fences, trailing commas, single quotes, unquoted keys; `__invalidJson` → try the raw string if present, else invalid); invalid → `{"error":"unknown_tool","available":[…]}` / `{"error":"invalid_arguments","detail":"<zod message>"}`; read-only calls run in parallel (≤ 8) first, writes sequentially in requested order, results in call order; content cut at 12 000 chars + `…[truncated]`; executor throw → `{"error":"tool_failed"}` and `onToolError(name, e)`; 3 consecutive `allInvalid` batches → outcome `invalid_tools`; `carry` messages appended after `base.messages`; before each model call: `shouldInterrupt()` → outcome `interrupted` (abort the in-flight call via an `AbortController` passed as `signal` when interrupted during a call — poll `shouldInterrupt` every 500 ms while a call runs); per call `timeoutMs = clamp((budget − elapsed)/2, 15_000, 60_000)`; at ≥ 80 % elapsed the next tool result batch's last message gets `\n\n` + `WRAP_UP_NOTICE` (once); budget exhausted → no new call, outcome `budget`; after `maxRounds` rounds with tool calls → one call with `toolChoice: 'none'`; tool calls still → outcome `limit`; `isTerminal` call in a batch → run the batch, then stop with outcome `done` and `res` = that response.
- [ ] Steps: write the three spec files first covering every bullet above (fake `generate`, fake clock via `now`, fake tools with delays to prove parallelism/order); run `cd apps/backend && npx vitest run src/modules/ai/__tests__/agent-loop.spec.ts src/modules/ai/__tests__/tool-runner.spec.ts src/modules/ai/__tests__/tool-repair.spec.ts` (RED → GREEN); backend `tsc`; commit `feat(ai): add a Hermes-style agent loop and tool runner`.

### Task 4: History compression and summary storage (§6)

**Files:** create `apps/backend/src/modules/ai/domain/context-compression.ts`, `application/history-summarizer.ts`, `domain/ports/conversation-summary.repository.ts`, `infrastructure/persistence/conversation-summary.drizzle.ts` (+ in-memory), `packages/db/migrations/0037_conversation_summaries.sql`, schema in `packages/db/src/schema/ai.ts`, docs `docs/05-data-model.md`; tests (unit + one integration in `apps/backend/test/ai.integration.spec.ts` style).

**Produces:**
```ts
export const COMPRESS_AT_CHARS = 24_000; export const KEEP_LAST_TURNS = 12;
export function needsCompression(turns: readonly ChatMessage[], maxChars?: number): boolean;
export async function compressHistory(turns: readonly ChatMessage[], opts: {
  summarize(text: string, previous: string | null): Promise<string>;
  stored: { coveredUntilIndex: number; summary: string } | null; maxChars?: number; keepLast?: number;
}): Promise<{ turns: ChatMessage[]; summary: { coveredUntilIndex: number; summary: string } | null }>;
export interface ConversationSummaryRepository {
  get(ws: WorkspaceId, conversationId: string): Promise<{ coveredUntil: Date; summary: string } | null>;
  put(ws: WorkspaceId, conversationId: string, value: { coveredUntil: Date; summary: string }): Promise<void>;
}
export function createHistorySummarizer(generate: (req: GenerateRequest) => Promise<GenerateResponse>, opts: { workspaceId: WorkspaceId; tier: ModelTier }): (text: string, previous: string | null) => Promise<string>;
```
Migration: `create table if not exists conversation_summaries (workspace_id uuid not null references workspaces(id), conversation_id uuid not null, covered_until timestamptz not null, summary text not null, updated_at timestamptz not null default now(), primary key (workspace_id, conversation_id))` + enable/force RLS + tenant policy copied from an existing ai table (read `0003_ai.sql`). The summarizer prompt (English instruction, Vietnamese output) keeps products, quantities, names, phone numbers, addresses and decisions, ≤ 1 500 chars.
- [ ] Steps: tests first (threshold; keeps the last 12 verbatim; summary message format `<earlier_conversation_summary>…</earlier_conversation_summary>` as one user message at the start; incremental: only turns after `coveredUntilIndex` that fall out of the window are summarised together with `previous`; summarizer request uses the given tier and no tools); integration test for the repository incl. cross-workspace isolation; implement; run focused tests + backend tsc; commit `feat(ai): compress long conversations into a stored summary`.

### Task 5: LISTEN/NOTIFY wake-up (§7)

**Files:** `packages/db/migrations/0038_ingress_notify.sql`, create `apps/backend/src/common/db/ingress-listener.ts` (+ test), modify `apps/backend/src/entries/agent.ts`, env docs (`.env.example`: `DATABASE_LISTEN_URL` optional, defaults to `DATABASE_SYSTEM_URL`; note it must be a direct, non-PgBouncer connection), `docs/10-operations-and-deployment.md`, `docs/meta-inbox.md`.

**Produces:** `startIngressListener({ url, channel: 'rapiz_ingress', onNotify(): void, onState(up: boolean): void, backoff: { minMs: 1_000, maxMs: 30_000 } }): { stop(): Promise<void> }`; agent entry: tick on notify (coalesced: at most one in flight + one queued), safety poll 5 000 ms while the listener is up, 300 ms while it is down.
Migration: `create or replace function rapiz_notify_ingress() returns trigger … perform pg_notify('rapiz_ingress', new.id::text); return new; …` + `create trigger … after insert on channel_webhook_events for each row execute function rapiz_notify_ingress()`; also on the fanpage comment ingress table if comments use a separate queue (check `apps/backend/src/modules/channel/application/fanpage-comment-inbox.ts` / its store; if they share `channel_webhook_events`, nothing more).
- [ ] Steps: integration test (Testcontainers Postgres): listener started, insert a row → `onNotify` within 500 ms; payload contains only the id; stopping the DB connection → `onState(false)` and reconnect after backoff (simulate with `pg_terminate_backend`); unit test for the coalescing scheduler (fake timers: 5 notifications while a tick runs → exactly one extra tick; poll interval switches 5 000 ↔ 300 on state). Implement; run focused tests + backend tsc; commit `feat(backend): wake the agent worker with LISTEN/NOTIFY`.

---

## Wave 2 — integration (parallel worktrees, after wave 1 is merged into `feat/agent-harness-v2`)

### Task 6: Reply path on the agent loop (§3, §4, §6, §8, §10) — ai module

**Files:** rewrite `apps/backend/src/modules/ai/application/playground.service.ts` (split into `reply-context.ts` / new `reply-pipeline.ts` to stay < 400 lines), create `application/output-tools.ts`, prompts `packages/ai-core/prompts/sales-agent@13.md`, `@14.md`, delete `tool-loop.ts`, remove the envelope path (`FinalReply` parsing, `completeFinal`, prose salvage, `decide()` grounding call) from the reply path (keep `domain/grounding.ts` + its tests), update `apps/backend/src/modules/ai/__tests__/*` (port every behaviour test to the new path; delete only tests of removed behaviour and say which in the report), `apps/backend/src/modules/ai/MODULE.md`, `docs/06-ai-engine.md`.

**Consumes:** Task 0 `ReplyOptions`/`MessageSink`/`OutgoingMessage`, Task 2 `promptCacheKey`/retries, Task 3 `runAgentLoop`/`RunnableTool`, Task 4 compression + repository, existing catalog/action tools (adapt them to `RunnableTool`, readOnly: catalog yes, actions no).

**Behaviour:** tools per turn = catalog (2) + `send_message` (not for fanpage comment replies) + `handoff` + actions; `send_message` executor validates text/imageIds (unknown ids dropped and listed), resolves images from the turn's allowlist (focus products + product details/images seen this turn + library images), calls `options.sink?.send(...)` or collects; `handoff` is terminal; final text (non-empty) → one more message `via:'final'` (delivered by the caller, not the sink — the Meta processor sends it with `splitReply`; the playground just returns it); outcome per §7; `promptCacheKey = ${botId}:${conversationId ?? playgroundConversationId(botId)}`; system prompt byte-stable (move date/time and all per-turn blocks into the last user message); compression via Task 4 with the stored summary; `ai_runs` records modelCalls/latency/productIds as before; response adds `messages`, `steps`, `interrupted`, keeps `reply`/`images`; on interrupt it also returns `carry` = the loop's `followUps` (`ReplyResult`). Prompt @13 per §6 (write it from @11, delete the JSON-format and envelope rules, add tool guidance: search before answering, never promise to check later, one idea per line, `send_message` for pictures ≤ 3 per call and several calls allowed, `handoff` when the customer asks for a person / an order is ready / a staff decision is needed); @14 = @13 + the "Lodging facts and decisions" section of @12 verbatim.
- [ ] Steps: update/port tests first (fake LLM returning tool calls then text; assert messages, sink calls, steps, handoff, interrupt passthrough, cache key, no `responseFormat`, prompt snapshot for @13); implement; `cd apps/backend && npx vitest run src/modules/ai src/modules/commerce` + tsc + eslint on touched files + `pnpm arch`; commits `feat(ai): answer through the agent loop with free text and optional send_message` (+ `docs(ai): …`).

### Task 7: Conversation processor — sink delivery and interrupt (§7) — conversation module

**Files:** `apps/backend/src/modules/conversation/application/jobs/meta-inbox.processor.ts` (split helpers into `jobs/reply-delivery.ts` if > 400 lines), `fanpage-comment.processor.ts` (pass options without sink), tests in `apps/backend/src/modules/conversation/__tests__/`, `docs/meta-inbox.md`.

**Consumes:** Task 0 `ReplyOptions`, `MessageSink`, `PlaygroundResponse.messages`/`interrupted`.

**Behaviour:** build a sink per turn: `send({text, images})` → text through `splitReply` bubbles + images through the existing album/retry/fallback, keys `bot:<event>:s<n>` (text bubbles `:s<n>`, `:s<n>:t2`…, images `:s<n>:img`), 800 ms pacing, returns delivered count, stops (returns 0) after a takeover or a newer customer message; `shouldInterrupt` = a newer inbound customer message exists in this conversation after the turn's last folded message, or the bot no longer holds the conversation; on `interrupted` → re-run immediately with all customer messages and `carry = result.carry` (Task 0 `ReplyResult.carry`; Task 6 fills it with the loop's `followUps` on interrupt), max 3 re-runs per event, then let the run finish; the final message (`via:'final'`) is sent as today (`bot:<event>`, `:t2`…); nothing sent at all → fallback message as today.
- [ ] Steps: tests first with a fake `ai.reply` that calls the sink and/or returns `interrupted` (sends and keys, pacing with fake timers, stop on takeover, interrupt re-run with carry, re-run cap, fanpage comments get no sink); implement; `cd apps/backend && npx vitest run src/modules/conversation` + tsc + eslint; commit `feat(conversation): deliver agent messages as they are sent and interrupt on new messages`.

### Task 8: Test chat shows messages and steps (§8) — web

**Files:** `apps/web/src/features/ai/components/test-chat.tsx` (+ new `test-chat-steps.tsx`), tests, `packages/i18n/src/messages/{vi,en}/*.json` (the file with `playground.*`).

**Consumes:** Task 0 `PlaygroundResponse.messages`/`steps`/`interrupted`.

**Behaviour:** when `messages` is present render each message in order (text via `splitReply` bubbles, images as an album under its message), else fall back to today's `reply` rendering; a collapsed "Các bước bot đã làm" / "What the bot did" disclosure listing steps (`kind`, `name`, ok/failed, ms); `interrupted` shows a small note. Accessible (button with `aria-expanded`).
- [ ] Steps: tests first (two messages with images render in order; steps collapsed by default, expand shows names; legacy response still renders); implement; `cd apps/web && npx vitest run src/features/ai --testTimeout=30000` + tsc + eslint + `pnpm --filter @agent-sales/web build`; commit `feat(web): show agent messages and steps in the test chat`.

---

## Wave 3 — evals and docs (after wave 2 is merged)

### Task 9: Evals, ADR and docs

**Files:** `apps/backend/src/modules/ai/evals/{case,runner,checks}.ts`, `apps/backend/evals/**`, `apps/backend/evals/README.md`, create `docs/adr/ADR-015-agent-harness-v2.md` (+ index), `docs/06-ai-engine.md` (final pass).
- Fake mode: scripted model turns (`fake_turns: [{tool_calls:[…]}, {text:"…"}]`); checks run on the delivered messages (joined text, total images, message count); keep every existing case, translating `fake_reply` into `fake_turns`.
- New checks: `messages_min`, `images_per_message_max`, `not_matches` already exists.
- New cases (critical): several products each sent with its own pictures (`messages_min: 2`, every message with ≥ 1 image); "ktra xong chưa" after a promise turn → `not_matches: ["kiểm tra (lại|xem)", "để em (xem|kiểm tra)"]` and contains a product fact; a long conversation (> 24 000 chars) still recalls the phone number given in the first turns.
- ADR-015: supersedes the "Hermes has no tools / bot output is a JSON envelope" parts of ADR-010/ADR-014; records the owner decisions of 2026-10-31.
- [ ] Steps: implement; `cd apps/backend && npx vitest run src/modules/ai/__tests__/evals.spec.ts src/modules/ai/__tests__/eval-checks.spec.ts`; fake CLI `pnpm --filter @agent-sales/backend eval`; commit `test(ai): evaluate agent replies by delivered messages` and `docs(ai): record agent harness v2`.

### Controller gate (not a subagent task)
Merge, `pnpm check`, migrate the dev DB (backup first), restart dev servers, live evals on gpt-6.1-sol (critical 100 %), acceptance QA agent through the playground HTTP API (TinyMind + Villas scripts, PASS/FAIL with transcripts), final whole-branch review, push, PR.
