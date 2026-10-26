# ai

**Purpose:** the bot's reply pipeline (today: the dashboard playground), the runtime LLM gateway built from the platform's LLM configuration, the back-office API that manages that configuration, and `ai_runs` metering.

**Owned tables:** `ai_runs` (tenant, forced RLS), `llm_providers` and `llm_tier_routes` (global, `app_system` only) — migration 0003; schema in `packages/db/src/schema/ai.ts`.

**Public API (`api/`):**

- `AI_FACADE` → `AiFacade.playground(workspaceId, botId, input)` — one grounded test reply; `reply(...)` (channels) returns the same shape, including `images`.
- HTTP: `POST /bots/{botId}/playground` (workspace-scoped); `/admin/llm/providers…` (incl. `GET|POST|DELETE /admin/llm/providers/{id}/hermes-login`: ChatGPT device-code sign-in of a `hermes` provider, proxied to the bridge's `/v1/auth/*`; bridge down = `{state:"unreachable"}`; gated by `HERMES_SUBSCRIPTION_LOGIN`, default off in production: GET returns `{state:"disabled"}`, POST/DELETE 403 `FORBIDDEN`; logout is local only), `GET /admin/llm/providers/{id}/models` (bridge `/v1/models`) and `/admin/llm/tiers…` (`@PlatformAdmin()`). Contracts: `packages/contracts/src/ai/`.
- Events: none yet.

**Events consumed:** none. Uses the `bot`, `knowledge`, `workspace`, `commerce` and `action` facades.

**Invariants:**

- LLM calls go through `packages/ai-core` providers only, via `LlmRuntime`; the tier → provider/model mapping comes from the database, never from env or code.
- API keys are sealed with `SecretBox` before they are stored and are never returned (only `apiKeyHint`).
- Every admin write calls `LlmRuntime.invalidate()`; other processes pick changes up within 10 s.
- A tier without a usable route is `AI_UNAVAILABLE` (503) in production; elsewhere the deterministic `dev-fake` provider answers.
- Facts in a reply must come from the retrieved sources: FAQs with unfilled placeholders are never sent; a figure whose amount (unit included) is not in the sources or bot settings turns the reply into the fallback message. Customer text vouches only for non-money figures.
- Fallback replies are never model text: the bot's message, or a built-in one when it is empty. A handoff reply is the bot's handoff message, optionally preceded by one short model sentence (apology, phone confirmation; <= 200 chars, no ungrounded figure).
- `outcome: fallback` means "no grounded answer" and does not switch the conversation to human mode; only `handoff` does (the caller acts on it). Default fallback wording must promise nothing the system does not do: it asks for more detail or a phone number so staff can help (the number then triggers a handoff).
- A customer phone number makes the model answer `handoff` with a one-sentence confirmation (staff see the conversation in human mode); the lead-in guard accepts a figure the customer wrote themselves, phone numbers compared ignoring spaces, dots and dashes. Model output that is not the expected JSON (code fence or prose around it is tolerated, the schema is not relaxed) is retried once; if it is still invalid the fallback is sent with guardrail `invalid_output:<empty|not_json|schema>` (a category, never text).
- Situations (`<shop_situations>`, built by `domain/situations.ts`: enabled scenarios only, grouped under General / After-an-order headers, incl. their "Khi" trigger) take priority over the generic handoff rule in the prompt (`sales-agent@8` (customer images via optional `images` on the request, Hermes provider only; pictures to send via `imageIds`)). The same prompt makes the bot answer every question of the latest customer turn in one reply, never greet when an earlier assistant message exists, and, for a foreign-language customer, promise no follow-up (the conversation stays in bot mode).
- Bot-sent pictures: the model gets only ids and labels of a per-turn allowlist (max 10: retrieved products' `imageUrls`, id `p:<productId>:<index>`, and image-library items matching the query, id `m:<itemId>`; `domain/image-allowlist.ts`) and returns `imageIds`; the server drops ids outside the allowlist, dedupes, caps at 3 and resolves them to `images: {url, label}[]` (answered outcomes only). No URL is ever in the model context or taken from model output.
- Bot API actions (T-055, `application/action-loop.ts`): a bot with enabled actions gets an `<actions>` block (id, name, description, params, response fields, `confirm`; never a URL, header or secret) and, when a confirmation waits, `<pending_action>`; a bot without actions gets neither and runs the single-turn pipeline unchanged. The model's outcomes `call_action` / `confirm_action` / `cancel_action` are resolved by the server: at most 3 executions per customer turn (a 4th request gives the fallback with guardrail `action_loop_limit`); an unknown, disabled or foreign `actionId` is treated as `unknown`; a call whose action `requiresConfirm` is only stored (`setPending`) and the model's reply is the confirmation question; `confirm_action` runs the STORED arguments (never the model's), clears the pending call, then asks the model again; with nothing pending it is the fallback. The result goes back as `<action_result>{ok,statusCode,data}</action_result>` (failures: `{ok:false,errorCode}` only; `<` is escaped so data cannot close the tag) and is data, not instructions. Figures in the `data` of a result of the current turn count as grounded; nothing else changes in the guardrails. All rounds are metered as ONE `ai_runs` row (tokens and latency summed). The response lists `actions: {name, ok, statusCode}[]`. Idempotency key `bot:<eventId>:<actionId>` (channel event id passed in the `reply` context; `:<n>` for repeated calls of one action in a turn), else `conv:<conversationId>:<actionId>:<turn-hash>`; the playground uses a stable per-bot UUID as conversation id so confirmations work in the test chat.
- A provider that cannot be built (bad key, wrong `SECRETS_ENCRYPTION_KEY`) is skipped and logged; its routes run on their fallback.
- Every LLM turn writes one `ai_runs` row (playground: `is_test = true`).

**Do not:** call provider SDKs outside `packages/ai-core`; log prompts, replies or API keys; read `bots`/`knowledge_items` tables directly (use the facades).

**Test:** `pnpm --filter @agent-sales/backend test -- ai` · integration: `test/ai.integration.spec.ts`
