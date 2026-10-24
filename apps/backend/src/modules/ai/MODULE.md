# ai

**Purpose:** the bot's reply pipeline (today: the dashboard playground), the runtime LLM gateway built from the platform's LLM configuration, the back-office API that manages that configuration, and `ai_runs` metering.

**Owned tables:** `ai_runs` (tenant, forced RLS), `llm_providers` and `llm_tier_routes` (global, `app_system` only) — migration 0003; schema in `packages/db/src/schema/ai.ts`.

**Public API (`api/`):**

- `AI_FACADE` → `AiFacade.playground(workspaceId, botId, input)` — one grounded test reply.
- HTTP: `POST /bots/{botId}/playground` (workspace-scoped); `/admin/llm/providers…` and `/admin/llm/tiers…` (`@PlatformAdmin()`). Contracts: `packages/contracts/src/ai/`.
- Events: none yet.

**Events consumed:** none. Uses the `bot`, `knowledge` and `workspace` facades.

**Invariants:**

- LLM calls go through `packages/ai-core` providers only, via `LlmRuntime`; the tier → provider/model mapping comes from the database, never from env or code.
- API keys are sealed with `SecretBox` before they are stored and are never returned (only `apiKeyHint`).
- Every admin write calls `LlmRuntime.invalidate()`; other processes pick changes up within 10 s.
- A tier without a usable route is `AI_UNAVAILABLE` (503) in production; elsewhere the deterministic `dev-fake` provider answers.
- Facts in a reply must come from the retrieved sources: FAQs with unfilled placeholders are never sent; a figure whose amount (unit included) is not in the sources or bot settings turns the reply into the fallback message. Customer text vouches only for non-money figures.
- Fallback and handoff replies are never model text: the bot's message, or a built-in one when it is empty.
- A provider that cannot be built (bad key, wrong `SECRETS_ENCRYPTION_KEY`) is skipped and logged; its routes run on their fallback.
- Every LLM turn writes one `ai_runs` row (playground: `is_test = true`).

**Do not:** call provider SDKs outside `packages/ai-core`; log prompts, replies or API keys; read `bots`/`knowledge_items` tables directly (use the facades).

**Test:** `pnpm --filter @agent-sales/backend test -- ai` · integration: `test/ai.integration.spec.ts`
