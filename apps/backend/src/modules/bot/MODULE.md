# bot

**Purpose:** bots of a workspace — name, industry, active flag, behaviour settings (mission, greeting, pronouns, fallback/handoff messages, creativity, model tier, theme colour, reply hours, business profile, reply style, placeholder values) — industry seed packs, the onboarding readiness checklist, and the HTTP surface for FAQs (`/bots/{botId}/faqs`).

**Owned tables:** `bots` (tenant, forced RLS — migration 0002; schema in `packages/db/src/schema/bot.ts`).

**Public API (`api/`):** `BOT_FACADE` → `getBot(workspaceId, botId)` returning `BotView` (settings with the greeting's placeholders filled), and `withinReplySchedule(schedule, now)` — the reply-hours check (Vietnam time) used by the Meta inbox processor. Settings changes are recorded in the training history with field-level before/after values; `POST /bots/{botId}/training-history/{historyId}/restore` puts settings (via `update`) or training items (via the knowledge facade) back. Contracts: `packages/contracts/src/bot/`.

**Deleting a bot (T-074):** `DELETE /bots/{botId}` (`bots.manage`, 204) is a soft delete: `bots.deleted_at` is stamped, `is_active` is cleared and a `bot.deleted` audit event (actor, bot name) is written in the same transaction. Every read goes through `findById`/`list`, which skip deleted rows, so a deleted bot is 404 everywhere (get, readiness, FAQs, training, playground, `getBot`). Knowledge, training history and conversations keep their rows. Modules above `bot` hook in through `BOT_LIFECYCLE` (`BotLifecycle.onDeleted`): `channel` registers a handler that unbinds the bot from its pages and `conversation` one that clears `conversations.bot_id` (ADR-012 §4), run _before_ the delete so a failure leaves the bot intact and the call can be retried. Pages without a bot fall back to staff replies.

**Events consumed:** none. Uses the `knowledge` facade (seed + FAQ CRUD after an ownership check) and the `workspace` facade (selected-business industry lookup before creation).

**Invariants:**

- Creation requires a supported workspace industry and an exactly matching requested industry. Mismatch or unsupported legacy values return `VALIDATION_FAILED` before a bot or seed is written. The bot update contract does not change industry; existing legacy bots remain readable and editable without silently rewriting their pack.
- New bots are inactive and get their industry pack (`domain/packs.ts`): default settings + a placeholder-free greeting + only placeholder-free seed FAQs (for example the spa booking answer); business facts live in the profile. Seeds never ship vague non-answers.
- Settings updates are partial; the merged result must still satisfy contracts `BotSettings`. Placeholder values merge key by key; an empty string removes one.
- Business profile (T-137): `settings.profile` is `{ fields, notes }` — keyed facts per industry (contracts `PROFILE_FIELDS` / `profileFieldsFor`, each value capped, `mapsUrl` https only) and up to 3000 characters of notes. A settings update merges `profile`: `fields` key by key (an empty string removes a key, unsent keys stay) and `notes` only when sent; other settings updates leave it untouched. A stored profile missing `fields` or `notes` is defaulted on read. Reply style is `replyLength` (`veryShort` | `short` | `detailed`, default `short`), `tone` (`friendly` | `formal`, default `friendly`) and `allowEmoji` (default false). Rows stored before these keys existed read back with the defaults (`Bot.rehydrate`). `BotView` exposes all four. `placeholders` stays as before. Values are data for the model, never instructions.
- Readiness (T-143) = mission ≥ 20 chars, ≥ 1 answerable FAQ (no unfilled placeholder in its answer), business profile complete (`profile` check: displayName, address, hotline and hours filled; `mapsUrl` optional; `detail` is the number of the industry's profile fields still empty), ≥ 1 channel (always false until M3). It no longer asks to fill placeholders; `missingPlaceholders` in the response is read-only and deprecated. The greeting still has its placeholders filled in `getBot` for old greetings.
- FAQ routes 404 when the bot is not in the workspace — knowledge is only called after that check.
- Pack content is tenant seed data in the tenant's language (not UI copy), hence in `domain/packs.ts` rather than `packages/i18n`.

**Do not:** let knowledge depend on bot; call LLMs here (that is the `ai` module).

**Test:** `pnpm --filter @agent-sales/backend test -- bot`

**Training workspace:** exposes workspace-scoped training-material CRUD/history through `TRAINING_FACADE` after verifying bot ownership. See `docs/training-workspace.md`.
