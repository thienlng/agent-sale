# bot

**Purpose:** bots of a workspace — name, industry, active flag, behaviour settings (mission, greeting, pronouns, fallback/handoff messages, creativity, model tier, placeholder values) — industry seed packs, the onboarding readiness checklist, and the HTTP surface for FAQs (`/bots/{botId}/faqs`).

**Owned tables:** `bots` (tenant, forced RLS — migration 0002; schema in `packages/db/src/schema/bot.ts`).

**Public API (`api/`):** `BOT_FACADE` → `getBot(workspaceId, botId)` returning `BotView` (settings with the greeting's placeholders filled). Contracts: `packages/contracts/src/bot/`.

**Events consumed:** none. Uses the `knowledge` facade (seed + FAQ CRUD after an ownership check).

**Invariants:**
- New bots are inactive and get their industry pack (`domain/packs.ts`): default settings + seed FAQs whose answers use `{{placeholders}}` (e.g. `{{store.address}}`). Seeds never ship vague non-answers.
- Settings updates are partial; the merged result must still satisfy contracts `BotSettings`. Placeholder values merge key by key; an empty string removes one.
- Readiness = mission ≥ 20 chars, ≥ 1 FAQ, no missing placeholders, ≥ 1 channel (always false until M3).
- FAQ routes 404 when the bot is not in the workspace — knowledge is only called after that check.
- Pack content is tenant seed data in the tenant's language (not UI copy), hence in `domain/packs.ts` rather than `packages/i18n`.

**Do not:** let knowledge depend on bot; call LLMs here (that is the `ai` module).

**Test:** `pnpm --filter @agent-sales/backend test -- bot`

**Training workspace:** exposes workspace-scoped training-material CRUD/history through `TRAINING_FACADE` after verifying bot ownership. See `docs/training-workspace.md`.
