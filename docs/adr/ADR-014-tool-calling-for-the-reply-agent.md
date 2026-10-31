# ADR-014: Tool calling for the reply agent

- Status: Proposed
- Date: 2026-10-30
- Decision makers: thienlng

## Context

Until now the server guessed the products of a customer turn before the model ran: it split the last customer messages and the bot's previous reply into words, ran up to 14 `ILIKE` searches and injected the top 5 products as `<catalog>` plus a fixed overview of the 15 newest products. A real buyer test of the TinyMind shop (59 bot-visible products) on 2026-10-30 failed because of it: the product name was cut off the search string, so "Thú gỗ xếp thăng bằng" was never searched; the bot then recommended the wrong product, claimed a product with photos had none, lost a found product on the next turn, refused an order and handed off to staff when the customer was rude. `docs/06-ai-engine.md` §3 already specified tools (the full catalog is never put into the prompt) but the code diverged. The owner's API actions (T-055) used a second, bespoke mechanism (`call_action` outcomes in the model's JSON).

## Decision

The model asks for catalog data through tools, and the server only executes them.

- **One tool loop** (`apps/backend/src/modules/ai/application/tool-loop.ts`) for catalog tools and action tools. Maximum 4 tool rounds per customer turn (then one call with tools forbidden; a provider that still calls tools gives the fallback with guardrail `tool_loop_limit`) and 3 action executions, unchanged. A turn that needs no product data still costs one model call.
- **Catalog tools** (`search_products`, `product_details`), executed through `CatalogFacade` (`searchBotCatalog`, `getBotProductsByIds`, `countBotCatalog`). `search_products` with a query returns up to 8 ranked rows and the details of the top 3; without a query it returns the compact index (cap 300 rows, above it the categories). Workspace and bot scope come from the server, never from tool arguments; tool results never contain URLs, only image ids.
- **Actions as tools**: each enabled action is a tool `action_<n>`; `confirm_pending_action` and `cancel_pending_action` exist while a confirmation waits. `requiresConfirm` actions store the pending call and return a read-back; confirmation runs the stored arguments. The model's JSON no longer has `call_action`, `confirm_action` or `cancel_action`.
- **Focus products**: each `ai_runs` row records the product ids whose details the model received (`product_ids`); the last 3 runs of the conversation (playground: last 30 minutes) give up to 3 focus products whose details go into the last user message, so follow-ups need no search.
- **Final reply** is `outcome: answer | unknown | handoff`, `reply`, `sources`, `imageIds` (up to 3 images are sent). Grounding trusts every tool result.
- **Prompts** `sales-agent@11` (all industries except hotel) and `@12` (hotel) replace @9 and @10 as runtime defaults.
- **Providers** (`packages/ai-core`): native function calling for the OpenAI-compatible and Anthropic providers; Hermes (ADR-010, no tools inside the runtime) and `tools: 'emulated'` servers use an emulated JSON tool protocol in `emulated-tools.ts`, so callers always see `ToolCall`s.
- **Ranking** is keyword search: accent-folded terms, pg_trgm `word_similarity` with a 0.3 floor, plus a compact browse index. No embeddings yet.

## Options considered

1. Keep server-side guessing and make it smarter (more words, longer history): rejected. The server does not understand the conversation; every fix moves the failure to the next phrasing.
2. Put the whole catalog in every prompt: rejected for cost and latency with hundreds of products; it contradicts docs/06.
3. Embedding retrieval before the model: deferred; it would still run before the model decides what it needs, and needs an index and a model route.
4. Native tool calling only: rejected because Hermes, the provider in use, has no tools; the emulated protocol keeps one code path.

## Consequences

- Product turns cost two model calls (search, then answer) instead of one; follow-ups on focus products cost one. Evals record model calls and latency per case.
- Prompts @9 and @10 stay in the repository for history but are no longer selectable by default; their snapshot tests were replaced by @11/@12 ones.
- Hermes tool calls depend on the model following the emulated JSON protocol; malformed tool JSON degrades to a text reply, which the existing output retry and fallback handle.
- The bot cannot create orders: it collects the details and hands off. A `create_order_draft` tool is a separate feature.
- Migration adds `ai_runs.product_ids` (jsonb, default `[]`), backward compatible.
- Removed `getBotProducts`, `listBotCatalog` and `botProductSearches`; `<catalog>` and `<catalog_overview>` no longer exist.
- Supersedes the every-turn context injection of the catalog. Design: `docs/superpowers/specs/2026-10-30-bot-tool-calling-design.md`.
