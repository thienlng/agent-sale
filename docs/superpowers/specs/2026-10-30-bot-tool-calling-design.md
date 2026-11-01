# Bot tool calling: catalog lookup on demand and actions as tools — design

Date: 2026-10-30 · Status: approved in chat by the owner (approach "Cách 3", actions migrated too, up to 3 images)

## 1. Problem

A real buyer test of TinyMind (retail, 59 bot-visible products) on 2026-10-30 failed badly: the bot recommended the wrong product, said a product with 5 photos had no photo, found a product and lost it on the next turn, refused to create the order because "the data has no such product", handed off to staff when the customer said "ngáo à", and talked about "dữ liệu ở lượt này" and "quyền kiểm tra app".

Root cause (reproduced): every turn the server guesses the products *before* the model runs. `PlaygroundService` joins the last two customer messages and the bot's previous reply into one string; `botProductSearches` splits it into words and keeps only the first 14 search entries (`MAX_SEARCHES`), punctuation included ("roi.", "vay."). The product name lives in the bot's previous reply, at the end of the string, so it is cut. Each entry is an `ILIKE` on `search_text` returning 5 rows, and the top 5 products by word count go into `<catalog>`, plus a fixed `<catalog_overview>` of the 15 newest products. Images may only be sent for those 5 products. For "Oke dk rồi. Thế tạo đơn cho too nhé. Tôi mua 4 bộ" the searched words were "trong, app, nhap, danh, sach, roi, ma, sao, lai, keu, vay, oke, roi" — none from "Thú gỗ xếp thăng bằng".

Server-side guessing is the wrong design: the model understands the conversation, the server does not. `docs/06-ai-engine.md` §3 already specifies tools (`search_products`, "the full catalog is never put into the prompt"); the code diverged.

## 2. Decisions (owner, 2026-10-30)

1. The model decides when it needs catalog data and asks for it through **tools**. Turns that need no product data cost one model call, as today.
2. **Native function calling** where the provider supports it (OpenAI-compatible, Anthropic). **Hermes** (the provider in use, ChatGPT subscription bridge, ADR-010) gets an **emulated** tool protocol inside `packages/ai-core`, so callers see the same `ToolCall`s. Hermes itself still runs with no tools (ADR-010 unchanged).
3. No embeddings yet: keyword search (accent-insensitive, typo-tolerant trigram) plus a compact full index for browsing.
4. The owner's API **actions** (docs/actions.md) move to the same tool mechanism in this change (one mechanism, not two).
5. A reply that presents a specific product sends **up to 3 images** proactively.

## 3. Architecture

```
PlaygroundService.reply/playground
  ├─ builds context: profile, FAQ hits, situations, focus products (≤3, see §6)
  ├─ ToolLoop (new, apps/backend/src/modules/ai/application/tool-loop.ts)
  │    tools = catalog tools (§5) + one tool per enabled action + confirm/cancel (§7)
  │    gateway.generate({messages, tools, responseFormat: FinalReply})
  │      ├─ native provider: tools/tool_calls in the provider API
  │      └─ Hermes: EmulatedTools wrapper (§4) → JSON protocol in text
  │    while response.toolCalls: execute (server-side, validated, scoped) → tool messages → generate
  │    max 4 tool rounds per customer turn, max 3 action executions (unchanged limit)
  └─ guardrails (decide) on the final reply; trusted text += every tool result
```

The model never sees URLs, secrets or other tenants' data; every tool runs with the bot's workspace and catalog scope from the server, never from model arguments.

## 4. ai-core: tools in the gateway

- `ChatMessage` gains `toolCalls?: ToolCall[]` (assistant messages that called tools); `role: 'tool'` messages carry `toolCallId` and `name`.
- `ToolDefinition.input` stays a Zod schema; providers convert it with `z.toJSONSchema`.
- `GenerateRequest.toolChoice?: 'auto' | 'none'` (`none` forces a final answer when the round budget is spent).
- **OpenAI-compatible provider:** maps `tools` → `tools: [{type:'function', function:{name, description, parameters}}]`, assistant `toolCalls` → `tool_calls`, tool messages → `{role:'tool', tool_call_id, content}`, response `message.tool_calls` → `ToolCall[]` (arguments JSON-parsed; unparseable arguments become a tool error result, never a crash). Structured output (`response_format`) is sent together with tools. Option `tools: 'native' | 'emulated'` (default `native`) for self-hosted servers without function calling.
- **Anthropic provider:** maps to `tools` / `tool_use` / `tool_result` content blocks.
- **Emulated tools** (`packages/ai-core/src/emulated-tools.ts`), a provider wrapper used for Hermes and for `tools: 'emulated'`:
  - appends a `<tools>` section to the system message: each tool's name, description and JSON schema, and the protocol: *to use tools, answer only `{"tool_calls":[{"name":…, "arguments":{…}}]}`; otherwise answer in the reply format*;
  - `responseFormat` becomes the union `{tool_calls:[…]} | <original schema>`;
  - assistant messages with `toolCalls` are rendered as that JSON; tool messages become user messages `<tool_result name="…" id="…">…</tool_result>`;
  - parses the text: a valid `tool_calls` object → `toolCalls` (ids generated), `stopReason: 'tool_use'`, `text: ''`; anything else is returned unchanged as text.
- `fake` provider: scripted responses may contain `toolCalls`, for tests and fake-mode evals.
- **Customer images across rounds:** `images` stay attached to the customer's message. Native providers send them as image parts of that message on every round. In emulated mode the bridge only attaches images to the last message, so the wrapper sends them with each round (the last message is then a tool result): the model keeps seeing the photo while it searches.

## 5. Catalog tools

Defined in the ai module (`application/catalog-tools.ts`), executed through a new `CatalogFacade`:

| Tool | Input | Result to the model |
|---|---|---|
| `search_products` | `query?: string` (keywords the model chooses, any language), `maxPriceVnd?: number`, `inStockOnly?: boolean` | **With `query`:** up to 8 rows ranked by relevance, and full details (as `product_details`) for the top 3. **Without `query`:** the compact index of every bot-visible active product (cap 300 rows; above the cap: `{tooMany:true,total,categories:[…]}` and the model must search). |
| `product_details` | `ids: string[]` (1–3 ids from earlier results) | Full details per product. Ids outside the bot's scope are reported as `not_found`. |

- **Compact row:** `id, name, category, fromVnd, toVnd, inStock, summary` (description with `Nguồn:`/URL lines removed, whitespace collapsed, first 200 chars), `imageCount`.
- **Details:** compact row fields plus `description` (same cleanup, first 1 500 chars), `instructions` (owner's bot instructions), `variants [{sku, name, priceVnd, available}]`, `images [{id, label}]` (ids `p:<productId>:<n>`, max 5 per product; never URLs). Accommodations keep today's lodging shape (`catalogKind`, `accommodation`, `availability: 'unverified'`, gallery images with captions).
- **Ranking (commerce, SQL):** the query is folded (`foldVietnamese`), punctuation removed, split into terms (max 8, length ≥ 2). Score per product = Σ over terms of `word_similarity(term, search_text)` (pg_trgm, existing GIN index) with a bonus when the whole folded query is a substring of the name; category terms count at half weight. Rows below a similarity floor (0.3) are dropped. Scoped by workspace (RLS), `status='active'`, `visible_to_bot`, and the bot's `catalog_mode` selection. Deterministic order on ties (name, id).
- `CatalogFacade` changes: `searchBotCatalog(ws, scope, {query?, maxPriceVnd?, inStockOnly?, limit})`, `getBotProductsByIds(ws, scope, ids)`, `countBotCatalog(ws, scope)`. `getBotProducts` / `listBotCatalog` / `botProductSearches` are removed, and so are `<catalog>` / `<catalog_overview>` in every-turn context.

## 6. Focus products (memory across turns)

- Each ai run records the product ids whose **details** the model received (via `product_details` or the top-3 details of `search_products`) and the ids it sent images of: new column `ai_runs.product_ids jsonb not null default '[]'` (migration, backward compatible).
- At the start of a turn, the last 3 runs of the same conversation (playground: the stable playground id, only runs from the last 30 minutes) give up to 3 **focus products** (most recent first). Their details are included in the last user message as `<focus_products>` — small, so follow-ups ("tạo đơn 4 bộ", "gửi ảnh đi", "size 2 tuổi được không") need no tool call.
- Products that left the bot's scope or became inactive are silently skipped.

## 7. Actions as tools

- Each enabled action becomes a tool `action_<n>` (stable index per request; the name→action map lives server-side), description = action name + description, input schema built from the declared params (string/number/boolean, required flags). The model never sees URLs, headers or secrets (as today).
- `requiresConfirm` actions: the tool does **not** run; it stores the pending call (`facade.setPending`) and returns `{status:"awaiting_customer_confirmation", readBack:{…args}}`; the model's final reply must read the parameters back and ask for agreement (unchanged behaviour, `askedConfirmation` + `readback` kept for the guardrails).
- When a pending call exists, two more tools are offered: `confirm_pending_action` (runs the stored arguments, never the model's) and `cancel_pending_action`. `<pending_action>` context (with `askedMinutesAgo`) stays in the last user message.
- Idempotency keys, the 3-execution limit, transient-error re-pending, `action_runs` audit and the "never claim success without a result" rule are unchanged; `runActionLoop`'s logic moves into the action tool executors, and `ModelReply` loses `call_action` / `confirm_action` / `cancel_action`, `actionId`, `args`.
- Action results (`data`) remain trusted grounding text; failures return `{ok:false,errorCode}`.

## 8. Final reply and prompts

- Final output schema (`FinalReply`): `outcome: 'answer' | 'unknown' | 'handoff'`, `reply`, `sources`, `imageIds` (max 3). Parsing, retry and prose salvage keep their current rules.
- New prompts `sales-agent@11` (successor of @9, all industries except hotel) and `sales-agent@12` (successor of @10, hotel: @11 + the lodging section). Changes:
  - catalog knowledge comes only from tool results and `<focus_products>`; any question about products, prices, stock, suitability or pictures must be answered from them — search before saying the shop lacks something; try other keywords or browse the index before concluding "không có";
  - when presenting one or more specific products, send up to 3 images from their `images` (prefer the product being recommended); never claim there is no picture when its details list images;
  - an irritated or insulting customer is not a handoff: apologise once, check again and correct; handoff only when the customer asks for a person, reports an order/payment problem, or needs a staff decision (or a situation says so), and phone numbers keep today's rule;
  - never mention data, turns, blocks, tools, systems, "app" or permissions to the customer; speak as a shop assistant;
  - orders: the bot cannot create orders itself (no order tool exists yet): collect product, quantity, name, phone and address, read them back, then hand off with outcome "handoff" so staff create the order. (A real `create_order_draft` tool is a separate feature.)
- Runtime defaults: `@11` for non-hotel bots, `@12` for hotel bots (replaces the @9/@10 choice in `PlaygroundService`); @9/@10 stay in the repo for history.

## 9. Images

The allowlist of a turn = images of every product whose details reached the model this turn (tool results + focus products) + matching image-library items (unchanged rule). `resolveImageIds` still validates ids and caps at 3. Images still follow only a grounded `answered` decision.

## 10. Guardrails and limits

- Trusted grounding text = profile, FAQ hits, situations, focus products, every tool result JSON, action data, customer text (as today for read-backs).
- Max 4 tool rounds per customer turn (a 5th request ends with `toolChoice:'none'` asking for the final answer; if the provider still calls tools → the existing fallback with guardrail `tool_loop_limit`). Max 3 action executions (unchanged).
- Tool argument validation failures return a structured error to the model (`{error:"invalid_arguments"}`), counted as a round.
- Latency: a product turn costs 2 model calls (search with top-3 details, then answer); follow-ups on focus products cost 1. The eval report records model calls and latency per case.

## 11. Testing and evals

- ai-core unit tests: OpenAI and Anthropic tool mapping (request and response, malformed arguments), emulated protocol (prompt section, union schema, parsing, history rendering), fake provider tool scripts.
- commerce: ranking integration test on Postgres (accents, typos such as "thu go xep thang bang", "xuong rong", category terms, scope `selected`, inactive and hidden products excluded, index cap).
- ai unit tests: tool loop (rounds limit, invalid args, tool errors), action tools (confirm flow, cancel, pending expiry rule, idempotency key, 3-execution limit — the existing action-loop tests are ported, none deleted without an equivalent), focus products, image allowlist from tool results, grounding with tool results.
- Evals (`apps/backend/evals`): fake-mode cases gain scripted tool calls; new live cases reproducing the TinyMind conversation of 2026-10-30 (2-year-old + stacking toys → a suitable product with images; customer photo of the balancing stacker; "tìm lại đi" after an insult → no handoff; "tạo đơn 4 bộ" → keeps the product, collects order details; no mention of data/turns/app), plus every existing TinyMind/Villas case. Gate: critical cases 100% live on the Hermes provider before the PR is ready.

## 12. Docs

ADR-014 "Tool calling for the reply agent" (deviation from the every-turn context injection; emulated tools for Hermes). Update `docs/06-ai-engine.md` §3, `docs/actions.md`, `apps/backend/src/modules/ai/MODULE.md`, `apps/backend/src/modules/commerce/MODULE.md`, `docs/05-data-model.md` (`ai_runs.product_ids`), `apps/backend/evals/README.md` (tool scripts in fake mode).

## 13. Out of scope

Embeddings / semantic search; a `create_order_draft` tool; native tool calling inside the Hermes runtime; streaming.
