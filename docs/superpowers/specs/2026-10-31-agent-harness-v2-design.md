# Agent harness v2 — Hermes-grade loop in the Rapiz core — design

Date: 2026-10-31 · Status: approved in chat by the owner ("Ổn đấy… làm xong trong hôm nay", parallel subagents with QA acceptance)
Base: branch `feat/agent-harness-v2` from `feat/bot-tools-catalog-search` @ a2f5b94 (PR #94: catalog tools, action tools, tool loop v1, focus products, prompts @11/@12).

## Why

The bot feels rigid: the TypeScript loop (PR #94) has 4 rounds, emulates tool calls in JSON for the Hermes pipe, forces ONE JSON envelope per turn (`{outcome, reply, sources, imageIds≤3}`), retries once, cuts history at 20 turns. Hermes (`/home/kenknight/Workspace/NetClaw_1.1.0/hermes-agent`) does all of this well. The core stays in TypeScript inside Rapiz (same process as tenant data; Hermes stays only the dev pipe to ChatGPT — owner decision, production = OpenAI API). We port Hermes' harness techniques.

## Global rules

- Rules: `AGENTS.md`, `.agents/rules/*.md`, `docs/ARCHITECTURE.md`. English in code/docs. Conventional Commits, valid scopes, end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, never `--no-verify`, stage only your files. Never delete or skip a test to go green; replace with an equivalent.
- No Messenger sends while testing (Meta restricted the TinyMind Page for bursts). Use unit tests, fake providers, the eval runner, the playground HTTP API.
- Tenancy: tools get workspace/bot/conversation only from the server-side binding; the model never names them.
- Each stream works ONLY in its own worktree and its own files (below). Cross-stream contracts are fixed here; do not change another stream's files.

## Contracts (fixed — all streams code against these)

### C1. ai-core `GenerateRequest` additions (stream S2 owns `packages/ai-core/src/gateway.ts`)
```ts
promptCacheKey?: string;     // stable per conversation: `${botId}:${conversationKey}`
timeoutMs?: number;          // per-call timeout chosen by the loop
signal?: AbortSignal;        // hard stop (interrupt)
```
`LlmErrorKind = 'rate_limit'|'overloaded'|'timeout'|'network'|'context_too_long'|'auth'|'invalid_request'|'content_filter'|'aborted'|'unknown'`; `export function classifyLlmError(e: unknown): LlmErrorKind` and `export class LlmCallError extends Error { kind: LlmErrorKind }` exported from ai-core.

### C2. Hermes provider native tools (stream S1 owns `services/hermes/**`, `packages/ai-core/src/providers/hermes.ts`, `emulated-tools.ts` wiring in `apps/backend/src/modules/ai/infrastructure/llm/sdk-provider-factory.ts`)
Bridge contract v2: `POST /v1/generate` body adds `tools: [{name, description, parameters}]`, `toolChoice`, and messages may contain assistant `toolCalls` and `tool` results; response adds `toolCalls: [{id, name, arguments(string JSON)}]` and `stopReason`. The bridge never executes tools. If native tools cannot work through the ChatGPT/Codex transport, S1 keeps the emulated wrapper and reports why (that is an acceptable outcome).

### C3. Tool loop v2 (stream S3 owns `apps/backend/src/modules/ai/application/tool-loop.ts` + new `tool-repair.ts`, `tool-budget.ts`)
```ts
export interface LoopTool { name: string; readOnly: boolean; maxResultChars?: number }
export interface LoopEvent { kind: 'model_call'|'tool_call'|'tool_result'|'wrap_up'|'stopped'|'retry'; at: number; name?: string; ok?: boolean; ms?: number; detail?: string }
export function runToolLoop(input: {
  base: GenerateRequest; tools: readonly LoopTool[];
  generate(req: GenerateRequest): Promise<GenerateResponse>;
  execute(call: ToolCall): Promise<{ content: string; trusted: string; productIds?: string[] }>;
  maxRounds?: number;      // default 10
  budgetMs?: number;       // default 90_000; at 80% append a wrap-up notice to the last tool message
  shouldStop?(): Promise<boolean>; // checked before every model call; true → stop (kind 'stopped')
  onError?(call: ToolCall, error: unknown): void;
  onEvent?(e: LoopEvent): void;
  now?(): number;
}): Promise<{ res: GenerateResponse; messages: ChatMessage[]; trusted: string[]; productIds: string[];
  modelCalls: number; limitHit: boolean; stopped: boolean; stopReason?: 'rounds'|'invalid_tools'|'budget'|'interrupted' }>;
```
Behaviour: tool-name repair (case, `-`/`_`/space, Levenshtein ≤ 2 to a known name), argument repair (trailing commas, single quotes, unquoted keys, code fences, `__invalidJson`), mixed batch (bad calls get `{"error":…}`, good ones run), 3 consecutive invalid-only batches → stop `invalid_tools`, read-only tools in parallel (max 8, results in call order), non-read-only sequential, result truncation (`maxResultChars`, default 12 000, with a "[truncated]" marker), per-call `timeoutMs = max(15_000, min(60_000, (budgetRemaining)/2))`, after `maxRounds` one final call with `toolChoice:'none'` (tool calls then → limitHit `rounds`).

### C4. Free output protocol (stream S4 owns `playground.service.ts`, `reply-context.ts`, `decide-reply.ts`, new `output-tools.ts`, prompts `sales-agent@13.md`/`@14.md`, `packages/contracts/src/ai/**`, web `apps/web/src/features/ai/**`)
Tools offered every turn (plus catalog + action tools):
- `send_message({ text: string (1–2000), imageIds?: string[] (≤ 10, ids from product details/images lists) })` — readOnly:false. Server checks numbers against trusted text (existing `ungroundedFigures`); violation → not queued, result `{"error":"ungrounded_figure","figures":[…]}` so the model rewrites; else queued, result `{"status":"queued","index":n}`. Image ids validated against the turn's allowlist; unknown ids dropped and reported.
- `handoff({ reason: string, message?: string })` — readOnly:false; marks the turn for human takeover; optional last message (grounded like send_message).
- Final model text with no tool call: if non-empty it is one more message (same grounding). No JSON envelope, no `responseFormat`.
`PlaygroundResponse` / `AiFacade.reply` result adds (keep old fields for compatibility, `reply` = messages' texts joined by `\n`, `images` = all images):
```ts
messages: { text: string; images: { id: string; url: string; label: string }[] }[];
steps: { kind: string; name?: string; ok?: boolean; ms?: number }[];   // hidden from customers; test chat shows them collapsed
```
`outcome`: `handoff` if the handoff tool was called; `answered` if ≥1 message; else `fallback`. Hotel bots use @14 (= @13 + lodging section of @12). Prompt @13: agent style — look things up before answering, never promise to check later, one product per message with its pictures when presenting several, free number of messages, pronoun rule from @11, no talk about data/tools/system.

### C5. Model-call robustness (stream S2 owns `packages/ai-core/src/**` except hermes.ts/emulated-tools.ts)
Gateway: classify errors; retry retryable kinds (`rate_limit`, `overloaded`, `timeout`, `network`, `unknown` 5xx) up to 3 times with jittered exponential backoff (base 1 s, cap 15 s, honour `Retry-After`), not `auth`/`invalid_request`/`content_filter`/`context_too_long`/`aborted`; then the tier fallback model if configured. Per-call `timeoutMs`/`signal` honoured by every provider. OpenAI-compatible sends `prompt_cache_key` when `promptCacheKey` is set; Anthropic adds `cache_control: {type:'ephemeral'}` on the last system block and the last 2 user/tool messages (≤ 4 breakpoints).

### C6. Context compression (stream S5 owns new `apps/backend/src/modules/ai/domain/context-compression.ts` + `application/history-summarizer.ts`)
```ts
export function needsCompression(turns: ChatMessage[], maxChars: number): boolean;
export async function compressHistory(turns: ChatMessage[], opts: { maxChars: number; keepLast: number;
  summarize(text: string): Promise<string> }): Promise<ChatMessage[]>;
// older turns → one assistant-visible summary message "<earlier_conversation_summary>…</…>", last `keepLast` turns verbatim
```
Default `maxChars` 24 000, `keepLast` 12. The summarizer uses the bot's tier with a short fixed prompt (Vietnamese facts kept: products, quantities, names, phone, address, decisions). Wiring into the reply path is done by the integrator (S4 leaves a clearly marked hook `historyFor(turns)` in `reply-context.ts`).

### C7. Dispatch (stream S6 owns `apps/backend/src/modules/conversation/**`)
- Debounce/burst: when a customer message arrives, wait 1 200 ms of quiet (max 4 000 ms burst window) before replying, folding the burst into one turn (Hermes/booking-agent). Configurable constants.
- Interrupt: pass `shouldStop` = "a newer customer message exists or a human took over" through `AiFacade.reply` options (`{ conversationId, isTest, shouldStop? }`); when stopped, nothing is sent and the newer message drives the next turn.
- Delivery of `messages[]` in order: each message → its text bubbles (`splitReply`) then its images (album with the existing retry/fallback-to-single logic), 800 ms pacing between sends; stop on takeover/new customer message; failures recorded per send as today.
- Outbox: the existing reserve → deliver → record path with idempotency keys is kept (it is already durable per send); key per message index: `bot:<event>:m<i>` / `:m<i>:img`.

## Acceptance (QA)
Per stream: task reviewer (spec + quality). Final: integrator merges S1–S6, wires C6 hook + `promptCacheKey` + `shouldStop`, `pnpm check` green, live evals (`--live`, Hermes gpt-6.1-sol) all critical cases green including new ones (multi-product turn sends one message per product with its images; "ktra xong chưa" never answered with a promise; ungrounded price is rewritten, not sent), then an acceptance QA agent drives the playground HTTP API with scripted TinyMind and Villas conversations and reports PASS/FAIL per scenario.
